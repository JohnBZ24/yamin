import { Feather } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { HOLD_TO_RECORD, useVoiceComposer } from '../hooks/use-voice-composer';
import { radius, space, type } from '../theme/tokens';
import { useLayout } from '../theme/use-layout';
import { useTokens } from '../theme/use-tokens';

const SUGGESTIONS = [
  'What am I supposed to follow up on?',
  'Who did I talk to about pricing?',
  'What is blocked right now?',
];

const STAGE_LABEL: Record<string, string> = {
  idle: '',
  reading: 'Working out what you meant…',
  uploading: 'Saving audio…',
  transcribing: 'Transcribing…',
  thinking: 'Yamin is thinking…',
};

/** Drag far enough UP to go hands-free; the finger can then be lifted. */
const LOCK_DY = -70;
/** Drag far enough LEFT to throw the take away. */
const CANCEL_DX = -70;

/** What the finger is currently promising to do when it lets go. */
type SwipeIntent = 'send' | 'lock' | 'cancel';

/**
 * Capture. Two ways in, deliberately:
 *  - the mic to record (the product's real input)
 *  - type a note (works on any desktop without mic permission — and is what
 *    makes the app demoable when the audio path isn't the thing being shown)
 *
 * Built on expo-audio: expo-av, which the previous version used, is not part of
 * SDK 57 at all — it's absent from the SDK 57 reference and its docs page 404s.
 *
 * The record/transcribe/classify/save state machine lives in
 * useVoiceComposer; this component only renders it.
 */
export function Composer({
  token,
  onOptimistic,
  onAsk,
  showSuggestions,
}: {
  token: string;
  onOptimistic: (note: {
    fileUuid: string;
    rawText: string;
    audioUrl: string | null;
  }) => void;
  onAsk: (question: string, intent: 'ask' | 'chitchat') => void;
  showSuggestions: boolean;
}) {
  const { colors } = useTokens();
  const { isNarrow } = useLayout();
  const {
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
    locked,
    lockRecording,
    cancelRecording,
  } = useVoiceComposer({ token, onOptimistic, onAsk });

  // What releasing the finger right now would do. Rendered as the hint text so
  // the gesture is discoverable instead of something you have to be told about.
  const [intent, setIntent] = useState<SwipeIntent>('send');
  // Follows the finger. A shared value so the drag runs on the UI thread and
  // does not re-render the composer on every touch move.
  const micOffset = useSharedValue({ x: 0, y: 0 });

  const hasText = text.trim().length > 0;

  if (busy) {
    return <ComposerBusyBar label={STAGE_LABEL[stage]} />;
  }

  return (
    <View style={styles.wrap}>
      {showSuggestions && !hasText && !isRecording && (
        <SuggestionChips suggestions={SUGGESTIONS} onPick={submitText} />
      )}

      <View
        style={[
          styles.bar,
          isNarrow && styles.barNarrow,
          {
            backgroundColor: colors.surface,
            borderColor: isRecording ? colors.danger : colors.border,
          },
        ]}
      >
        {isRecording ? (
          <RecordingIndicator
            durationMs={recorderState.durationMillis ?? 0}
            pulseStyle={pulseStyle}
            locked={locked}
            intent={intent}
          />
        ) : (
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => submitText()}
            returnKeyType="send"
            placeholder="Tell Yamin something, or ask it anything…"
            placeholderTextColor={colors.textSubtle}
            style={[styles.input, type.body, { color: colors.text }]}
            {...({ outlineStyle: 'none' } as object)}
          />
        )}

        <ComposerActions
          hasText={hasText}
          isRecording={isRecording}
          locked={locked}
          micOffset={micOffset}
          onSend={() => submitText()}
          onStartRecording={startRecording}
          onFinishRecording={finishRecording}
          onLock={lockRecording}
          onCancel={cancelRecording}
          onIntentChange={setIntent}
        />
      </View>
    </View>
  );
}

function ComposerBusyBar({ label }: { label: string }) {
  const { colors } = useTokens();
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.bar,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <ActivityIndicator size="small" color={colors.brand} />
        <Text style={[type.bodyMedium, { color: colors.textMuted }]}>{label}</Text>
      </View>
    </View>
  );
}

function SuggestionChips({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  const { colors } = useTokens();
  return (
    <View style={styles.suggestions}>
      {suggestions.map((s) => (
        <Pressable
          key={s}
          onPress={() => onPick(s)}
          style={({ pressed }) => [
            styles.chip,
            {
              backgroundColor: pressed ? colors.surfaceHover : colors.surfaceSunken,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <Text style={[type.small, { color: colors.textMuted }]}>{s}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The live take: how long, and what letting go would do right now. */
function RecordingIndicator({
  durationMs,
  pulseStyle,
  locked,
  intent,
}: {
  durationMs: number;
  pulseStyle: React.ComponentProps<typeof Animated.View>['style'];
  locked: boolean;
  intent: SwipeIntent;
}) {
  const { colors } = useTokens();

  const hint = locked
    ? '🔒 hands-free — tap ↑ to send'
    : !HOLD_TO_RECORD
      ? 'recording'
      : intent === 'lock'
        ? 'release to go hands-free'
        : intent === 'cancel'
          ? 'release to cancel'
          : 'slide up to lock · ‹ slide to cancel';

  return (
    <View style={styles.recRow}>
      <Animated.View
        style={[styles.recDot, { backgroundColor: colors.danger }, pulseStyle]}
      />
      <Text
        numberOfLines={1}
        style={[
          type.bodyMedium,
          styles.recLabel,
          { color: intent === 'cancel' ? colors.dangerText : colors.danger },
        ]}
      >
        {formatDuration(durationMs)} — {hint}
      </Text>
    </View>
  );
}

function ComposerActions({
  hasText,
  isRecording,
  locked,
  micOffset,
  onSend,
  onStartRecording,
  onFinishRecording,
  onLock,
  onCancel,
  onIntentChange,
}: {
  hasText: boolean;
  isRecording: boolean;
  locked: boolean;
  micOffset: SharedValue<{ x: number; y: number }>;
  onSend: () => void;
  onStartRecording: () => void;
  onFinishRecording: (shouldSend: boolean) => void;
  onLock: () => void;
  onCancel: () => void;
  onIntentChange: (intent: SwipeIntent) => void;
}) {
  const { colors } = useTokens();

  const intentRef = useRef<SwipeIntent>('send');

  /**
   * The pan handlers are created ONCE (recreating them mid-gesture drops the
   * touch), so they must not close over anything that changes. This ref is
   * repointed at the current callbacks on every render and read through at
   * call time.
   *
   * Not optional: `startRecording` bails out unless `micAllowed` is true, and
   * that permission arrives asynchronously AFTER the first render — a handler
   * frozen at mount would have captured `micAllowed: false` and told the user
   * their microphone was off, forever.
   */
  const live = useRef({
    locked,
    onStartRecording,
    onFinishRecording,
    onLock,
    onCancel,
    onIntentChange,
  });
  live.current = {
    locked,
    onStartRecording,
    onFinishRecording,
    onLock,
    onCancel,
    onIntentChange,
  };

  const micStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: micOffset.value.x },
      { translateY: micOffset.value.y },
    ],
  }));

  /**
   * Hold to record; swipe up to keep recording hands-free; swipe left to throw
   * it away. Releasing without moving still sends, which is what the button did
   * before this existed — the gesture adds options rather than replacing one.
   *
   * PanResponder rather than react-native-gesture-handler: RN ships it, so this
   * needs no GestureHandlerRootView and no native rebuild to try.
   */
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,

        onPanResponderGrant: () => {
          intentRef.current = 'send';
          live.current.onIntentChange('send');
          micOffset.value = { x: 0, y: 0 };
          live.current.onStartRecording();
        },

        onPanResponderMove: (_event, gesture) => {
          // Up wins over left when the finger is diagonal: locking is the
          // recoverable outcome, cancelling destroys the take.
          const next: SwipeIntent =
            gesture.dy <= LOCK_DY
              ? 'lock'
              : gesture.dx <= CANCEL_DX
                ? 'cancel'
                : 'send';
          if (next !== intentRef.current) {
            intentRef.current = next;
            live.current.onIntentChange(next);
          }
          micOffset.value = {
            x: Math.min(0, Math.max(gesture.dx, CANCEL_DX * 1.4)),
            y: Math.min(0, Math.max(gesture.dy, LOCK_DY * 1.4)),
          };
        },

        onPanResponderRelease: () => {
          micOffset.value = { x: 0, y: 0 };
          const settled = intentRef.current;
          intentRef.current = 'send';
          live.current.onIntentChange('send');
          if (settled === 'lock') {
            // Written here rather than waiting for the re-render: this view
            // unmounts as soon as `locked` lands, and an unmount while holding
            // the responder fires onPanResponderTerminate — which would read a
            // stale `false` and cancel the recording the user just locked.
            live.current.locked = true;
            live.current.onLock();
            return; // finger is off, recorder keeps running
          }
          if (settled === 'cancel') {
            live.current.onCancel();
            return;
          }
          live.current.onFinishRecording(true);
        },

        // A call or notification stealing the touch must not leave the recorder
        // running forever with nobody able to stop it.
        onPanResponderTerminate: () => {
          micOffset.value = { x: 0, y: 0 };
          intentRef.current = 'send';
          live.current.onIntentChange('send');
          if (!live.current.locked) live.current.onCancel();
        },
      }),
    // Created once: rebuilding mid-gesture drops the touch. Everything mutable
    // is reached through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (hasText && !isRecording) {
    return (
      <Pressable onPress={onSend} style={[styles.circle, { backgroundColor: colors.brand }]}>
        <Feather name="arrow-up" size={18} color={colors.onBrand} />
      </Pressable>
    );
  }

  // Hands-free, or a desktop mid-recording: both need explicit send/cancel,
  // because in neither case is there a finger left holding the button down.
  if (isRecording && (locked || !HOLD_TO_RECORD)) {
    return (
      <View style={styles.recActions}>
        <Pressable
          onPress={() => onFinishRecording(false)}
          accessibilityRole="button"
          accessibilityLabel="Discard recording"
          style={[styles.circle, { backgroundColor: colors.surfaceSunken }]}
        >
          <Feather name="x" size={18} color={colors.textMuted} />
        </Pressable>
        <Pressable
          onPress={() => onFinishRecording(true)}
          accessibilityRole="button"
          accessibilityLabel="Send recording"
          style={[styles.circle, { backgroundColor: colors.brand }]}
        >
          <Feather name="arrow-up" size={18} color={colors.onBrand} />
        </Pressable>
      </View>
    );
  }

  if (HOLD_TO_RECORD) {
    return (
      <Animated.View
        {...pan.panHandlers}
        accessibilityRole="button"
        accessibilityLabel="Hold to record, slide up to keep recording hands-free"
        style={[
          styles.circle,
          micStyle,
          { backgroundColor: isRecording ? colors.danger : colors.brand },
        ]}
      >
        <Feather name="mic" size={18} color={colors.onBrand} />
      </Animated.View>
    );
  }

  return (
    <Pressable
      onPress={onStartRecording}
      style={[styles.circle, { backgroundColor: colors.brand }]}
    >
      <Feather name="mic" size={18} color={colors.onBrand} />
    </Pressable>
  );
}

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.xs,
  },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    minHeight: 56,
  },
  // Tighter gutters on a phone: 16px each side is a real slice of a 360dp screen.
  barNarrow: { paddingLeft: space.md },
  input: { flex: 1, minWidth: 0, paddingVertical: space.md },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
  // minWidth:0 lets the hint truncate instead of shoving the buttons off the bar.
  recLabel: { flexShrink: 1, minWidth: 0 },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  recActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  circle: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
