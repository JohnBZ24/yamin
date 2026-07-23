import { Feather } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { HOLD_TO_RECORD, useVoiceComposer } from '../hooks/use-voice-composer';
import { radius, space, type } from '../theme/tokens';
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
  onAsk: (question: string) => void;
  showSuggestions: boolean;
}) {
  const { colors } = useTokens();
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
  } = useVoiceComposer({ token, onOptimistic, onAsk });

  const hasText = text.trim().length > 0;

  if (busy) {
    return <ComposerBusyBar label={STAGE_LABEL[stage]} />;
  }

  return (
    <View style={styles.wrap}>
      {showSuggestions && !hasText && (
        <SuggestionChips suggestions={SUGGESTIONS} onPick={submitText} />
      )}

      <View
        style={[
          styles.bar,
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
          onSend={() => submitText()}
          onStartRecording={startRecording}
          onFinishRecording={finishRecording}
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

function RecordingIndicator({
  durationMs,
  pulseStyle,
}: {
  durationMs: number;
  pulseStyle: React.ComponentProps<typeof Animated.View>['style'];
}) {
  const { colors } = useTokens();
  return (
    <View style={styles.recRow}>
      <Animated.View
        style={[styles.recDot, { backgroundColor: colors.danger }, pulseStyle]}
      />
      <Text style={[type.bodyMedium, { color: colors.danger }]}>
        {formatDuration(durationMs)}
        {HOLD_TO_RECORD ? ' — release to send' : ' — recording'}
      </Text>
    </View>
  );
}

function ComposerActions({
  hasText,
  isRecording,
  onSend,
  onStartRecording,
  onFinishRecording,
}: {
  hasText: boolean;
  isRecording: boolean;
  onSend: () => void;
  onStartRecording: () => void;
  onFinishRecording: (shouldSend: boolean) => void;
}) {
  const { colors } = useTokens();

  if (hasText && !isRecording) {
    return (
      <Pressable onPress={onSend} style={[styles.circle, { backgroundColor: colors.brand }]}>
        <Feather name="arrow-up" size={18} color={colors.onBrand} />
      </Pressable>
    );
  }

  if (HOLD_TO_RECORD) {
    return (
      <Pressable
        onPressIn={onStartRecording}
        onPressOut={() => onFinishRecording(true)}
        style={[
          styles.circle,
          { backgroundColor: isRecording ? colors.danger : colors.brand },
        ]}
      >
        <Feather name="mic" size={18} color={colors.onBrand} />
      </Pressable>
    );
  }

  if (isRecording) {
    return (
      <View style={styles.recActions}>
        <Pressable
          onPress={() => onFinishRecording(false)}
          style={[styles.circle, { backgroundColor: colors.surfaceSunken }]}
        >
          <Feather name="x" size={18} color={colors.textMuted} />
        </Pressable>
        <Pressable
          onPress={() => onFinishRecording(true)}
          style={[styles.circle, { backgroundColor: colors.brand }]}
        >
          <Feather name="arrow-up" size={18} color={colors.onBrand} />
        </Pressable>
      </View>
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
  input: { flex: 1, paddingVertical: space.md },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
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
