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
import { api, transcribe } from '../lib/api';
import { randomUuid } from '../lib/uuid';

export type ComposerStage = 'idle' | 'reading' | 'uploading' | 'transcribing' | 'thinking';

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
 * Below this the recording is a container header with no usable frames — the
 * STT provider rejects it outright, so discard locally with a clear message
 * instead of a round-trip that can only fail.
 */
const MIN_DURATION_MS = 400;

/** The upload/transcribe path needs a real extension; the recorder tells us the container per platform. */
function extensionFor(uri: string, blobType: string): string {
  if (Platform.OS !== 'web') {
    const match = /\.[A-Za-z0-9]+$/.exec(uri);
    return match ? match[0].toLowerCase() : '.m4a';
  }
  // Web recordings come out of MediaRecorder: webm/opus on Chrome, mp4 on Safari.
  if (blobType.includes('mp4') || blobType.includes('aac')) return '.m4a';
  if (blobType.includes('ogg')) return '.ogg';
  if (blobType.includes('mpeg')) return '.mp3';
  if (blobType.includes('wav')) return '.wav';
  return '.webm';
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
  }) => void;
  onAsk: (question: string) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [stage, setStage] = useState<ComposerStage>('idle');
  const [micAllowed, setMicAllowed] = useState(false);
  // Flips on the press itself, before the recorder has actually started —
  // prepareToRecordAsync takes long enough that waiting for isRecording made
  // the button feel dead.
  const [recActive, setRecActive] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const isRecording = recActive || recorderState.isRecording;

  // The start is async. A fast release used to find isRecording still false,
  // bail silently, and then the recorder would start AFTER the release and run
  // forever — stop must first await whatever start it is racing against.
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const finishingRef = useRef(false);

  const pulse = useSharedValue(1);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      setMicAllowed(status.granted);
      if (status.granted) {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      }
    })();
  }, []);

  useEffect(() => {
    pulse.set(
      isRecording
        ? withRepeat(withTiming(1.18, { duration: 700 }), -1, true)
        : withTiming(1),
    );
  }, [isRecording, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.get() }],
  }));

  const busy = stage !== 'idle';

  const send = async (rawText: string, audioUrl: string | null, fileUuid?: string) => {
    // Not crypto.randomUUID(): it is secure-context-only and simply missing
    // over plain HTTP, which is how the app is reached from a phone on the LAN.
    const uuid = fileUuid ?? randomUuid();
    setStage('thinking');
    onOptimistic({ fileUuid: uuid, rawText, audioUrl });
    await api.submit(token, uuid, rawText);
    setStage('idle');
  };

  /**
   * One box, no mode switch: the server decides whether this is a question to
   * answer or something to keep, and it defaults to keeping when unsure — the
   * direction that never loses what you said.
   */
  const route = async (value: string, audioUrl: string | null, fileUuid?: string) => {
    setStage('reading');
    let intent: 'ask' | 'remember' = 'remember';
    try {
      ({ intent } = await api.classify(token, value));
    } catch {
      // Classifier unreachable — remembering is the recoverable default.
    }

    if (intent === 'ask') {
      setStage('idle');
      // The answer lands in the feed as its own turn; the box frees up now.
      onAsk(value);
      return;
    }

    await send(value, audioUrl, fileUuid);
  };

  const submitText = async (override?: string) => {
    const value = (override ?? text).trim();
    if (!value || busy) return;

    setText('');
    try {
      await route(value, null);
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

      await recorder.stop();
      const uri = recorder.uri;

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

      const blob = await (await fetch(uri)).blob();
      const extension = extensionFor(uri, blob.type ?? '');

      // Transcribe FIRST, then decide. Speaking a question is as natural as
      // typing one, and a question is not a memory — uploading its audio to S3
      // would leave an orphaned object and a row nobody wants. The upload now
      // happens only once we know this is something to keep.
      setStage('transcribing');
      const localName = `voice${extension}`;
      const { text: rawText } = await transcribe(
        token,
        Platform.OS === 'web'
          ? blob
          : { uri, name: localName, type: blob.type || 'audio/mp4' },
        localName,
      );

      if (!rawText?.trim()) {
        toast("I couldn't hear anything in that", 'error');
        setStage('idle');
        return;
      }

      setStage('reading');
      let intent: 'ask' | 'remember' = 'remember';
      try {
        ({ intent } = await api.classify(token, rawText));
      } catch {
        // Keeping it is the recoverable default.
      }

      if (intent === 'ask') {
        setStage('idle');
        onAsk(rawText);
        return;
      }

      setStage('uploading');
      const { fileUuid, uploadUrl, downloadUrl, contentType } =
        await api.presign(token, extension);

      let putRes: Response;
      try {
        putRes = await fetch(uploadUrl, {
          method: 'PUT',
          // Must match the ContentType the backend signed with, or S3 rejects
          // the PUT with a signature mismatch — so the backend tells us instead
          // of both sides guessing.
          headers: { 'Content-Type': contentType },
          body: blob,
        });
      } catch {
        // A network-level failure here surfaces as a bare "Failed to fetch".
        // On web the usual culprit is the bucket refusing the browser's CORS
        // preflight, which never reaches the request itself.
        throw new Error(
          'Audio upload failed before reaching storage — check your connection (on web: the S3 bucket needs a CORS rule allowing PUT)',
        );
      }
      if (!putRes.ok) {
        throw new Error(`Audio upload was rejected by storage (${putRes.status})`);
      }

      await send(rawText, downloadUrl, fileUuid);
    } catch (err: any) {
      toast(err.message ?? 'Something went wrong', 'error');
      setStage('idle');
    } finally {
      startPromiseRef.current = null;
      setRecActive(false);
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
    pulseStyle,
    submitText,
    startRecording,
    finishRecording,
  };
}
