import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { VoiceNote } from '../lib/api';
import { radius, space, type } from '../theme/tokens';
import { useLayout } from '../theme/use-layout';
import { useTokens } from '../theme/use-tokens';

/** Playback via expo-audio's useAudioPlayer (expo-av is gone in SDK 57). */
function AudioBubble({ url }: { url: string }) {
  const { colors } = useTokens();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  return (
    <Pressable
      onPress={() => (status.playing ? player.pause() : player.play())}
      style={[styles.audio, { backgroundColor: colors.onBrandSubtle }]}
    >
      <Feather
        name={status.playing ? 'pause' : 'play'}
        size={13}
        color={colors.onBrand}
      />
      <View style={styles.wave}>
        {/* Deterministic bar heights — Math.random() here would reshuffle the
            waveform on every re-render. Fixed-length constant, never
            reordered/filtered, so an index key is safe here. */}
        {[9, 15, 7, 18, 11, 16, 8, 13, 6, 14].map((h, i) => (
          <View
            key={i}
            style={{
              width: 2,
              height: h,
              borderRadius: 1,
              backgroundColor: status.playing
                ? colors.onBrand
                : colors.onBrandMuted,
            }}
          />
        ))}
      </View>
    </Pressable>
  );
}

/**
 * Two-tap delete: Alert.alert is a no-op on react-native-web, so the confirm
 * step lives in the button itself — first tap arms it, second tap deletes,
 * and it quietly disarms after a few seconds if the user walks away.
 */
function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const { colors } = useTokens();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const press = async () => {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  if (busy) {
    return <ActivityIndicator size={12} color={colors.onBrandMuted} />;
  }

  return (
    <Pressable onPress={press} hitSlop={8} style={styles.deleteBtn}>
      {armed && (
        <Text style={[type.mono, { color: colors.onBrand }]}>tap to delete</Text>
      )}
      <Feather
        name={armed ? 'x-circle' : 'trash-2'}
        size={13}
        color={armed ? colors.onBrand : colors.onBrandMuted}
      />
    </Pressable>
  );
}

export function NoteCard({
  note,
  index,
  onDelete,
}: {
  note: VoiceNote;
  index: number;
  onDelete?: () => Promise<void>;
}) {
  const { colors } = useTokens();
  const { mineMax, theirsMax } = useLayout();

  const tone =
    note.status === 'processed'
      ? { bg: colors.successSurface, fg: colors.successText, label: 'Remembered' }
      : note.status === 'failed'
        ? { bg: colors.dangerSurface, fg: colors.dangerText, label: 'Failed' }
        : { bg: colors.warningSurface, fg: colors.warningText, label: 'Thinking' };

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 6) * 40).duration(180)}
      style={styles.group}
    >
      {/* What you said */}
      <View style={styles.right}>
        <View
          style={[styles.mine, { maxWidth: mineMax, backgroundColor: colors.brand }]}
        >
          {note.audioUrl ? <AudioBubble url={note.audioUrl} /> : null}
          <Text style={[type.body, { color: colors.onBrand, flexShrink: 1 }]}>
            {note.rawText || '…'}
          </Text>
          <View style={styles.mineFoot}>
            {onDelete ? <DeleteButton onDelete={onDelete} /> : null}
            <Text style={[type.mono, { color: colors.onBrandMuted }]}>
              {new Date(note.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>
      </View>

      {/* What Yamin understood */}
      <View style={styles.left}>
        <View
          style={[
            styles.theirs,
            {
              maxWidth: theirsMax,
              backgroundColor: colors.surface,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <View style={styles.head}>
            <View style={styles.brandRow}>
              <Feather name="zap" size={12} color={colors.brandText} />
              <Text style={[type.label, { color: colors.brandText }]}>Yamin</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: tone.bg }]}>
              <Text style={[type.label, { color: tone.fg, fontSize: 9 }]}>
                {tone.label}
              </Text>
            </View>
          </View>

          <Text style={[type.body, { color: colors.text, flexShrink: 1 }]}>
            {note.summary ?? 'Working through what you said…'}
          </Text>

          {note.nodes && note.nodes.length > 0 && (
            <View style={[styles.tags, { borderTopColor: colors.borderSubtle }]}>
              {note.nodes.map((n) => (
                <View
                  key={n.id ?? `${n.type}-${n.name}`}
                  style={[
                    styles.tag,
                    {
                      backgroundColor: colors.brandSurface,
                      borderColor: colors.brandBorder,
                    },
                  ]}
                >
                  <Text style={[type.mono, { color: colors.textSubtle }]}>
                    {n.type}
                  </Text>
                  <Text style={[type.mono, { color: colors.brandText }]}>
                    {n.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm, marginBottom: space.xl },
  right: { flexDirection: 'row', justifyContent: 'flex-end' },
  left: { flexDirection: 'row', justifyContent: 'flex-start' },
  // maxWidth is supplied per-render from useLayout(), in pixels. It used to be
  // '85%'/'92%' here, which Yoga could resolve against an indefinite parent and
  // collapse to min-content — that is what rendered messages one word per line.
  mine: {
    flexShrink: 1,
    minWidth: 0,
    padding: space.lg,
    borderRadius: radius.lg,
    // Squared corner on the sender's side — the standard chat "tail" cue.
    borderTopRightRadius: 4,
    gap: space.sm,
  },
  theirs: {
    flexShrink: 1,
    minWidth: 0,
    padding: space.lg,
    borderRadius: radius.lg,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    gap: space.sm,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mineFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: space.md,
  },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  audio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    borderTopWidth: 1,
    paddingTop: space.md,
    marginTop: space.xs,
  },
  tag: {
    flexDirection: 'row',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
});
