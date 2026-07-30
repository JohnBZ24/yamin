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

import { VoiceNote } from '../lib/api';
import { radius, space, type } from '../theme/tokens';
import { useLayout } from '../theme/use-layout';
import { useTokens } from '../theme/use-tokens';

/**
 * Shown when a note has no measured envelope: anything recorded before peaks
 * existed. Deliberately flat and low — it reads as "no waveform available"
 * rather than impersonating one.
 */
const FLAT_WAVE = [6, 8, 6, 9, 7, 8, 6, 9, 7, 8];

const WAVE_MIN_HEIGHT = 3;
const WAVE_MAX_HEIGHT = 20;

/**
 * Bars actually drawn, however many are stored.
 *
 * Each bar is an unshrinkable 2px plus a 3px gap, so this is a hard floor on how
 * wide the player can get: 24 bars is ~117px. Rendering all 40 stored peaks came
 * to ~197px, which on a narrow phone exceeded the bubble's own maxWidth — and an
 * over-constrained column makes Yoga fall back to min-content for its other
 * children, which is what rendered the transcript one word per line.
 */
const MAX_BARS = 24;

/** Keep the loudest sample per slice, so downsampling preserves the shape. */
function downsample(values: number[], buckets: number): number[] {
  if (values.length <= buckets) return values;
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor((i * values.length) / buckets);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / buckets));
    let loudest = 0;
    for (let j = start; j < end; j++) {
      if (values[j] > loudest) loudest = values[j];
    }
    out.push(loudest);
  }
  return out;
}

/** Playback via expo-audio's useAudioPlayer (expo-av is gone in SDK 57). */
function AudioBubble({ url, peaks }: { url: string; peaks?: number[] | null }) {
  const { colors } = useTokens();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  /**
   * The real amplitude envelope, measured on the device while recording.
   *
   * This used to be a hardcoded ten-bar constant, identical on every note. A
   * waveform that does not correspond to its audio is worse than none: it looks
   * like information and carries none. These bars are the recording.
   */
  const bars = peaks?.length
    ? downsample(peaks, MAX_BARS).map(
        (p) =>
          WAVE_MIN_HEIGHT +
          (Math.max(0, Math.min(100, p)) / 100) * (WAVE_MAX_HEIGHT - WAVE_MIN_HEIGHT),
      )
    : FLAT_WAVE;

  /**
   * How far through the audio we are, 0–1, so the bars already played can be
   * distinguished from the ones still to come. Only meaningful once the player
   * knows the duration.
   */
  const progress =
    status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const playedBars = Math.round(progress * bars.length);

  return (
    <Pressable
      onPress={() => (status.playing ? player.pause() : player.play())}
      style={[styles.audio, { backgroundColor: colors.onBrandSubtle }]}
      accessibilityRole="button"
      accessibilityLabel={status.playing ? 'Pause audio' : 'Play audio'}
    >
      <Feather
        name={status.playing ? 'pause' : 'play'}
        size={13}
        color={colors.onBrand}
      />
      <View style={styles.wave}>
        {bars.map((height, i) => (
          <View
            // Fixed-length per note, never reordered or filtered, so the index
            // is a stable identity here.
            key={i}
            style={{
              width: 2,
              height,
              borderRadius: 1,
              // Fills as it plays. The progress is real now that the bars are,
              // so this reads as position rather than decoration.
              backgroundColor:
                i < playedBars ? colors.onBrand : colors.onBrandMuted,
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
  stageLabel,
  onDelete,
}: {
  note: VoiceNote;
  /**
   * What the worker is doing right now, when it has said. The pipeline runs
   * 5–20 seconds, and a single "Thinking" badge for all of it reads as a hang;
   * naming the step shows the work is real and makes a failure legible.
   * Absent for notes that are already done, and for a worker that predates the
   * progress events — hence the fallbacks below rather than a required prop.
   */
  stageLabel?: string;
  onDelete?: () => Promise<void>;
}) {
  const { colors } = useTokens();
  const { mineMax, theirsMax } = useLayout();

  const tone =
    note.status === 'processed'
      ? { bg: colors.successSurface, fg: colors.successText, label: 'Remembered' }
      : note.status === 'failed'
        ? { bg: colors.dangerSurface, fg: colors.dangerText, label: 'Failed' }
        : {
            bg: colors.warningSurface,
            fg: colors.warningText,
            label: stageLabel ? stageLabel.replace(/…$/, '') : 'Thinking',
          };

  return (
    // Not animated on entry. The feed is virtualised, so a row mounts every
    // time it scrolls back into view — a staggered fade-in would replay on every
    // pass, costing frames during the scroll that is already the expensive part.
    <View style={styles.group}>
      {/* What you said */}
      <View
        style={[styles.mine, { maxWidth: mineMax, backgroundColor: colors.brand }]}
      >
        {note.audioUrl ? (
          <AudioBubble url={note.audioUrl} peaks={note.peaks} />
        ) : null}
        <Text style={[type.body, { color: colors.onBrand }]}>
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

      {/* What Yamin understood */}
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

        <Text style={[type.body, { color: colors.text }]}>
          {note.summary ?? stageLabel ?? 'Working through what you said…'}
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
  );
}

const styles = StyleSheet.create({
  /**
   * Explicitly full-width, not left to `alignItems: stretch`.
   *
   * The bubbles below size themselves with `alignSelf` + `maxWidth`, which makes
   * their width `auto` — and Yoga resolves an auto cross-axis size against the
   * space the PARENT offers. Inside a virtualised list on Android that parent
   * width is not always definite by the time the row measures, and an auto width
   * with nothing to measure against falls back to min-content: the longest word.
   * That is the "messages render vertically, one word per line" bug. Stating the
   * width here gives the bubbles something real to resolve against.
   */
  group: { width: '100%', gap: space.sm, marginBottom: space.xl },
  // maxWidth is supplied per-render from useLayout(), in pixels — never '%',
  // which Yoga resolves against an indefinite parent and collapses to
  // min-content.
  //
  // The bubbles used to sit inside `flexDirection: 'row'` wrappers and carry
  // `flexShrink: 1` + `minWidth: 0`. Together those told Yoga the box was free
  // to shrink to zero width, and on Android it did exactly that — the text came
  // out one character per line, stacked downwards. There is no row now and no
  // shrink: alignSelf picks the side, maxWidth caps the measure, and the bubble
  // hugs its content in between.
  mine: {
    alignSelf: 'flex-end',
    padding: space.lg,
    borderRadius: radius.lg,
    // Squared corner on the sender's side — the standard chat "tail" cue.
    borderTopRightRadius: 4,
    gap: space.sm,
  },
  theirs: {
    alignSelf: 'flex-start',
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
    // Never wider than the bubble. Without this the fixed-width bars set a
    // min-content floor for the whole column, and the transcript beside them
    // got laid out one word per line to satisfy it.
    maxWidth: '100%',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    // The bars themselves cannot shrink, so the row that holds them clips
    // instead — losing the tail of a waveform is far better than reflowing the
    // message next to it.
    flexShrink: 1,
    overflow: 'hidden',
  },
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
