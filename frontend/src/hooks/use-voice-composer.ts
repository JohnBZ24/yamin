import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useToast } from '../components/toast';
import { api, transcribe, type Intent } from '../lib/api';
import {
  hapticCancel,
  hapticLock,
  hapticRecordStart,
  hapticSend,
} from '../lib/haptics';
import {
  readRecording,
  transcribePart,
  type Recording,
} from '../lib/recording';
import { randomUuid } from '../lib/uuid';
import {
  IDLE_SCALE,
  METER_INTERVAL_MS,
  MIN_DURATION_MS,
  PEAK_SCALE,
  meterToLevel,
} from './voice-metering';

export type ComposerStage = 'idle' | 'reading' | 'uploading' | 'transcribing' | 'thinking';

/**
 * Bars in the stored waveform. Matches what the bubble draws — sending more
 * would be storing detail nobody can see, and the server caps it at 64 anyway.
 */
const PEAK_BUCKETS = 40;

/**
 * Squash however many level samples were taken into a fixed-length envelope.
 *
 * A 3-second note yields ~30 samples and a 3-minute one ~1800, but the bubble
 * is the same size either way, so the recording is divided into PEAK_BUCKETS
 * slices and each slice keeps its LOUDEST sample. Averaging would flatten
 * speech into a uniform bar of mush — the peak is what gives a waveform its
 * shape.
 *
 * Returns 0–100 integers: two significant digits is well beyond what a 2px-wide
 * bar can express, and integers keep the JSON small.
 */
function toEnvelope(samples: number[]): number[] | undefined {
  if (samples.length === 0) return undefined;

  const buckets = Math.min(PEAK_BUCKETS, samples.length);
  const envelope: number[] = [];

  for (let i = 0; i < buckets; i++) {
    const start = Math.floor((i * samples.length) / buckets);
    const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / buckets));
    let loudest = 0;
    for (let j = start; j < end; j++) {
      if (samples[j] > loudest) loudest = samples[j];
    }
    envelope.push(Math.round(loudest * 100));
  }

  // All-silent means metering never reported anything usable (an emulator with
  // no mic input, say). Sending a flat line would claim to be real data.
  return envelope.some((v) => v > 0) ? envelope : undefined;
}

/**
 * Hold-to-talk is natural under a thumb; under a mouse it's hostile — slip off
 * the button mid-sentence and the note is gone. So: touch-primary devices hold
 * the mic and release to send; a mouse-driven desktop clicks the mic to start
 * and gets explicit send/cancel buttons.
 *
 * `(pointer: coarse)` asks what the PRIMARY pointer is, which is the actual
 * question. Counting `maxTouchPoints` instead would put a touchscreen Windows
 * laptop — a desktop by every meaning that matters here — on hold-to-record.
 */
export const HOLD_TO_RECORD =
  Platform.OS !== 'web' ||
  (typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches);

/**
 * Presign, then PUT the recording straight to S3.
 *
 * Throws with a message that names what actually went wrong, because these
 * failures are otherwise indistinguishable from the outside and each needs a
 * different fix: a 503 here means the server has no AWS credentials, a 403
 * SignatureDoesNotMatch means the signed and sent Content-Type disagree, and a
 * network error means the request never reached S3 at all.
 */
async function uploadAudio(
  token: string,
  recording: Recording,
): Promise<{ audioUrl: string | null; fileUuid?: string }> {
  const { fileUuid, uploadUrl, downloadUrl, contentType } = await api.presign(
    token,
    recording.extension,
  );

  // Echo the Content-Type the backend chose rather than guessing one. S3 does
  // not verify it (only `host` is signed), but it is what the object gets
  // stored as — and notes are played back straight from that URL, so a wrong
  // type breaks playback on an upload that reported success.
  //
  // Native sends the bytes as a Uint8Array, NOT the File itself: expo/fetch
  // normalises a Blob-like body by overwriting Content-Type with the blob's own
  // `type`, and the recorder's type is not always the one we asked for. A typed
  // array is passed through untouched, so the header we set is the header sent.
  let status: number;
  let detail = '';
  try {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body:
        recording.platform === 'web'
          ? recording.blob
          : await recording.file.bytes(),
    });
    status = response.status;
    if (status < 200 || status >= 300) {
      // S3 explains itself in an XML body (SignatureDoesNotMatch, AccessDenied,
      // …). Throwing away that body leaves only a bare status code, which is
      // not enough to tell those apart.
      detail = await response.text().catch(() => '');
    }
  } catch (err: any) {
    // A network-level failure never reached S3 at all. On web that is usually
    // the bucket refusing the browser's CORS preflight; on a phone there is no
    // preflight, so say what actually happened instead of blaming CORS.
    throw new Error(
      recording.platform === 'web'
        ? 'the S3 bucket needs a CORS rule allowing PUT'
        : `could not reach storage (${err?.message ?? err})`,
    );
  }
  if (status < 200 || status >= 300) {
    const code = /<Code>([^<]+)<\/Code>/.exec(detail)?.[1];
    throw new Error(`storage rejected it (${status}${code ? ` ${code}` : ''})`);
  }

  return { audioUrl: downloadUrl, fileUuid };
}

/**
 * Owns the record → transcribe → classify → save/ask state machine for the
 * composer, so the component only has to render whatever this returns.
 */
export function useVoiceComposer({
  token,
  onOptimistic,
  onAsk,
}: {
  token: string;
  onOptimistic: (note: {
    fileUuid: string;
    rawText: string;
    audioUrl: string | null;
    peaks?: number[];
  }) => void;
  onAsk: (question: string, intent: 'ask' | 'chitchat') => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [stage, setStage] = useState<ComposerStage>('idle');
  const [micAllowed, setMicAllowed] = useState(false);
  // Flips on the press itself, before the recorder has actually started —
  // prepareToRecordAsync takes long enough that waiting for isRecording made
  // the button feel dead.
  const [recActive, setRecActive] = useState(false);
  /**
   * Hands-free: the user swiped up, so lifting their finger must NOT stop the
   * recording. While locked the only ways out are the explicit send and cancel
   * buttons, which is what makes a long note possible without holding the phone.
   */
  const [locked, setLocked] = useState(false);

  /**
   * Metering is what makes the recording indicator show YOUR voice rather than
   * a canned animation, so it is on from the start and the status is polled
   * fast enough to look live.
   */
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, METER_INTERVAL_MS);
  const isRecording = recActive || recorderState.isRecording;

  // The start is async. A fast release used to find isRecording still false,
  // bail silently, and then the recorder would start AFTER the release and run
  // forever — stop must first await whatever start it is racing against.
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const finishingRef = useRef(false);

  const pulse = useSharedValue(1);
  const idle = useSharedValue(1);

  /**
   * Every level sample of the take in progress, collected so the finished note
   * can carry a waveform that matches it. A ref, not state: this is appended to
   * ten times a second and nothing renders from it directly.
   */
  const samplesRef = useRef<number[]>([]);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      setMicAllowed(status.granted);
      if (status.granted) {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      }
    })();
  }, []);

  const busy = stage !== 'idle';

  /**
   * The indicator now tracks the microphone.
   *
   * This was `withRepeat(withTiming(1.18, { duration: 700 }), -1, true)` — a
   * fixed loop that ran at the same rate whether you were mid-sentence or had
   * already walked away. Driving it from the real level is the difference
   * between an animation that says "recording" and one that shows the app is
   * actually hearing you, which is the moment this stops feeling like a form.
   *
   * The timing is slightly longer than the poll interval so consecutive
   * samples blend into a continuous movement instead of stepping.
   */
  const metering = recorderState.metering;
  useEffect(() => {
    if (!isRecording) {
      pulse.set(withTiming(1, { duration: 200 }));
      return;
    }
    const level = meterToLevel(metering);
    // The same samples that drive the pulse become the stored waveform, so the
    // bars on the finished note are literally what the indicator was showing.
    samplesRef.current.push(level);
    pulse.set(
      withTiming(1 + level * (PEAK_SCALE - 1), { duration: METER_INTERVAL_MS * 1.4 }),
    );
  }, [isRecording, metering, pulse]);

  /**
   * Resting breath on the mic button. Signals "listening, ready" without a
   * label, and stops entirely once there is something real to show — a button
   * that keeps idling while it uploads is saying the wrong thing.
   */
  useEffect(() => {
    if (isRecording || busy) {
      idle.set(withTiming(1, { duration: 200 }));
      return;
    }
    idle.set(withRepeat(withTiming(IDLE_SCALE, { duration: 1600 }), -1, true));
  }, [isRecording, busy, idle]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.get() }],
  }));

  const idleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: idle.get() }],
  }));

  const send = async (
    rawText: string,
    audioUrl: string | null,
    fileUuid?: string,
    peaks?: number[],
  ) => {
    // Not crypto.randomUUID(): it is secure-context-only and simply missing
    // over plain HTTP, which is how the app is reached from a phone on the LAN.
    const uuid = fileUuid ?? randomUuid();
    setStage('thinking');
    onOptimistic({ fileUuid: uuid, rawText, audioUrl, peaks });
    await api.submit(token, uuid, rawText, peaks);
    setStage('idle');
  };

  /**
   * One box, no mode switch: the server decides whether this is a question to
   * answer from memory, something to keep, or something to just reply to. It
   * defaults to keeping when unsure — the direction that never loses what you
   * said.
   *
   * `prepareStore` runs ONLY on the remember lane, and that is the point: the
   * voice path puts its S3 upload in there, so a spoken question can no longer
   * leave an orphaned audio object behind. The invariant holds because the
   * callback is unreachable otherwise, not because two copies of this function
   * both remembered to check.
   */
  const route = async (
    value: string,
    prepareStore: () => Promise<{ audioUrl: string | null; fileUuid?: string }>,
    peaks?: number[],
  ) => {
    setStage('reading');
    let intent: Intent = 'remember';
    try {
      ({ intent } = await api.classify(token, value));
    } catch {
      // Classifier unreachable — remembering is the recoverable default.
    }

    if (intent === 'ask' || intent === 'chitchat') {
      setStage('idle');
      // The answer lands in the feed as its own turn; the box frees up now.
      onAsk(value, intent);
      return;
    }

    const { audioUrl, fileUuid } = await prepareStore();
    await send(value, audioUrl, fileUuid, peaks);
  };

  const submitText = async (override?: string) => {
    const value = (override ?? text).trim();
    if (!value || busy) return;

    setText('');
    try {
      await route(value, async () => ({ audioUrl: null }));
    } catch (err: any) {
      toast(err.message ?? 'Could not save that note', 'error');
      setStage('idle');
    }
  };

  const startRecording = async () => {
    if (busy || recActive) return;
    if (!micAllowed) {
      toast('Microphone permission is off — type your note instead', 'error');
      return;
    }
    setRecActive(true);
    setLocked(false);
    // A fresh envelope per take, or the second note inherits the first's shape.
    samplesRef.current = [];
    // Fired on the press, not after prepareToRecordAsync resolves. The whole
    // value of this is that it lands inside the ~100ms where a press still
    // feels connected to the finger that made it.
    hapticRecordStart();
    const starting = (async () => {
      await recorder.prepareToRecordAsync();
      recorder.record();
    })();
    startPromiseRef.current = starting;
    try {
      await starting;
    } catch (err: any) {
      startPromiseRef.current = null;
      setRecActive(false);
      toast(err.message ?? 'Could not start recording', 'error');
    }
  };

  const finishRecording = async (shouldSend: boolean) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    // Which step we are on, for the error message. A bare "unsupported data
    // implementation" toast names no step, so there is no way to tell reading
    // the file apart from uploading it — and they fail for entirely different
    // reasons.
    let step = 'stopping the recorder';
    try {
      try {
        await startPromiseRef.current;
      } catch {
        return; // start already failed and toasted
      }
      if (!recorder.isRecording) return;

      // Captured before stop() — recorderState lags the native value by up to
      // a poll interval, and after stop it resets.
      const durationMs = Math.max(
        recorderState.durationMillis ?? 0,
        (recorder.currentTime ?? 0) * 1000,
      );

      // Snapshotted before the samples can be reset by a following take.
      const envelope = toEnvelope(samplesRef.current);

      await recorder.stop();
      const uri = recorder.uri;

      // After stop(), so the two outcomes feel distinct in the hand: a send
      // confirms, a discard warns.
      if (shouldSend) hapticSend();
      else hapticCancel();

      if (!shouldSend) return;
      if (!uri) throw new Error('Recording produced no audio');
      if (durationMs < MIN_DURATION_MS) {
        toast(
          HOLD_TO_RECORD
            ? 'Too short — keep holding the mic while you speak'
            : 'Too short — click the mic, speak, then send',
          'error',
        );
        return;
      }

      step = 'reading the recording';
      const recording = await readRecording(uri);
      const { extension, mimeType } = recording;
      console.log(
        `[voice] uri=${uri} platform=${recording.platform} ext=${extension} mime=${mimeType}` +
          (recording.platform === 'native' ? ` size=${recording.file.size}` : ''),
      );

      // Transcribe FIRST, then decide. Speaking a question is as natural as
      // typing one, and a question is not a memory — uploading its audio to S3
      // would leave an orphaned object and a row nobody wants. The upload now
      // happens only once we know this is something to keep.
      setStage('transcribing');
      step = 'transcribing';
      const localName = `voice${extension}`;
      const { text: rawText } = await transcribe(
        token,
        transcribePart(recording, localName),
        localName,
      );

      if (!rawText?.trim()) {
        toast("I couldn't hear anything in that", 'error');
        setStage('idle');
        return;
      }

      // Same router as the typed path. The upload lives inside the callback so
      // it runs only when this really is something to keep.
      step = 'saving the note';
      await route(
        rawText,
        async () => {
          setStage('uploading');
          step = 'uploading the audio';

          // The transcript IS the note; the audio is a recording of it. So a
          // storage failure must never cost the user what they said — it drops
          // the attachment and says so, and the note is saved regardless. This
          // is the difference between "S3 is misconfigured" being an annoyance
          // and being data loss.
          try {
            return await uploadAudio(token, recording);
          } catch (err: any) {
            console.log('[voice] audio upload failed, keeping transcript:', err);
            toast(`Saved without audio — ${err?.message ?? 'upload failed'}`, 'error');
            return { audioUrl: null };
          }
        },
        envelope,
      );
    } catch (err: any) {
      console.log(`[voice] failed while ${step}:`, err?.message, err);
      toast(`Voice failed while ${step}: ${err?.message ?? 'unknown error'}`, 'error');
      setStage('idle');
    } finally {
      startPromiseRef.current = null;
      setRecActive(false);
      setLocked(false);
      finishingRef.current = false;
    }
  };

  return {
    text,
    setText,
    stage,
    busy,
    isRecording,
    recorderState,
    /** Tracks the live microphone level while recording. */
    pulseStyle,
    /** Resting breath, for the mic button when nothing is happening. */
    idleStyle,
    submitText,
    startRecording,
    finishRecording,
    /** Hands-free after a swipe up: a finger release no longer ends the take. */
    locked,
    lockRecording: () => {
      hapticLock();
      setLocked(true);
    },
    cancelRecording: () => finishRecording(false),
  };
}
