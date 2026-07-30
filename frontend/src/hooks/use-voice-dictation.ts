import { useEffect, useRef, useState } from 'react';
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
import { transcribe } from '../lib/api';
import {
  hapticCancel,
  hapticRecordStart,
  hapticSend,
} from '../lib/haptics';
import { readRecording, transcribePart } from '../lib/recording';
import {
  IDLE_SCALE,
  METER_INTERVAL_MS,
  MIN_DURATION_MS,
  PEAK_SCALE,
  meterToLevel,
} from './voice-metering';

/**
 * Speak a question instead of typing it.
 *
 * The chat screen had no microphone at all — only the home feed did — so
 * "I can't send a voice note here" was literally true rather than slow. This is
 * the narrower half of useVoiceComposer: record, transcribe, hand back the text.
 * No S3 upload and no classify step, because a question asked here is already
 * known to be a question; it never becomes a stored note with audio attached.
 */
export function useVoiceDictation({
  token,
  onText,
}: {
  token: string;
  /** The transcript, once the recording has been turned into words. */
  onText: (text: string) => void;
}) {
  const toast = useToast();
  const [transcribing, setTranscribing] = useState(false);
  const [micAllowed, setMicAllowed] = useState(false);
  // Flips on the press itself, before the recorder has actually started —
  // prepareToRecordAsync takes long enough that waiting for isRecording made
  // the button feel dead.
  const [recActive, setRecActive] = useState(false);

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

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      setMicAllowed(status.granted);
      if (status.granted) {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      }
    })();
  }, []);

  const metering = recorderState.metering;
  useEffect(() => {
    if (!isRecording) {
      pulse.set(withTiming(1, { duration: 200 }));
      return;
    }
    const level = meterToLevel(metering);
    pulse.set(
      withTiming(1 + level * (PEAK_SCALE - 1), { duration: METER_INTERVAL_MS * 1.4 }),
    );
  }, [isRecording, metering, pulse]);

  useEffect(() => {
    if (isRecording || transcribing) {
      idle.set(withTiming(1, { duration: 200 }));
      return;
    }
    idle.set(withRepeat(withTiming(IDLE_SCALE, { duration: 1600 }), -1, true));
  }, [isRecording, transcribing, idle]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.get() }],
  }));
  const idleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: idle.get() }],
  }));

  const startRecording = async () => {
    if (transcribing || recActive) return;
    if (!micAllowed) {
      toast('Microphone permission is off — type your question instead', 'error');
      return;
    }
    setRecActive(true);
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
    // Which step we are on, for the error message: a bare failure gives no way
    // to tell reading the file apart from transcribing it, and they fail for
    // entirely different reasons.
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

      await recorder.stop();
      const uri = recorder.uri;

      if (shouldSend) hapticSend();
      else hapticCancel();

      if (!shouldSend) return;
      if (!uri) throw new Error('Recording produced no audio');
      if (durationMs < MIN_DURATION_MS) {
        toast('Too short — hold the mic while you speak', 'error');
        return;
      }

      step = 'reading the recording';
      const recording = await readRecording(uri);
      const localName = `voice${recording.extension}`;

      setTranscribing(true);
      step = 'transcribing';
      const { text } = await transcribe(
        token,
        transcribePart(recording, localName),
        localName,
      );

      if (!text?.trim()) {
        toast("I couldn't hear anything in that", 'error');
        return;
      }

      onText(text.trim());
    } catch (err: any) {
      console.log(`[dictation] failed while ${step}:`, err?.message, err);
      toast(`Voice failed while ${step}: ${err?.message ?? 'unknown error'}`, 'error');
    } finally {
      startPromiseRef.current = null;
      setRecActive(false);
      setTranscribing(false);
      finishingRef.current = false;
    }
  };

  return {
    isRecording,
    transcribing,
    durationMs: recorderState.durationMillis ?? 0,
    pulseStyle,
    idleStyle,
    startRecording,
    finishRecording,
    cancelRecording: () => finishRecording(false),
  };
}
