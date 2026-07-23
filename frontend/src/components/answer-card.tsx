import { Feather } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { AskResponse } from '../lib/api';
import { radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

export type AnswerEntry = {
  id: string;
  question: string;
  createdAt: string;
  /** null while the request is still in flight. */
  result: AskResponse | null;
  error?: string;
};

/**
 * An asked question rendered as a turn in the same conversation as the notes,
 * rather than in a separate panel above the feed. Deliberately shaped like
 * NoteCard — your words on the right, Yamin's on the left — so one column reads
 * as a single history instead of two unrelated surfaces.
 *
 * The sources are not decoration; they are the reason to trust the answer. The
 * backend refuses to answer without retrieved context, so an answer here always
 * traces back to something you actually said.
 */
export function AnswerCard({ entry, index }: { entry: AnswerEntry; index: number }) {
  const { colors } = useTokens();

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 6) * 40).springify().damping(20)}
      style={styles.group}
    >
      {/* What you asked */}
      <View style={styles.right}>
        <View style={[styles.mine, { backgroundColor: colors.brand }]}>
          <View style={styles.askRow}>
            <Feather name="search" size={13} color={colors.onBrandMuted} />
            <Text style={[type.body, { color: colors.onBrand, flex: 1 }]}>
              {entry.question}
            </Text>
          </View>
          <Text style={[type.mono, { color: colors.onBrandMuted, alignSelf: 'flex-end' }]}>
            {new Date(entry.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
      </View>

      {/* What Yamin answered */}
      <View style={styles.left}>
        <View
          style={[
            styles.theirs,
            { backgroundColor: colors.brandSurface, borderColor: colors.brandBorder },
          ]}
        >
          <View style={styles.brandRow}>
            <Feather name="zap" size={12} color={colors.brandText} />
            <Text style={[type.label, { color: colors.brandText }]}>Yamin</Text>
          </View>

          {entry.error ? (
            <Text style={[type.body, { color: colors.dangerText }]}>{entry.error}</Text>
          ) : !entry.result ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.brandText} />
              <Text style={[type.body, { color: colors.textMuted }]}>
                Searching your memory…
              </Text>
            </View>
          ) : (
            <>
              <Text style={[type.body, { color: colors.text }]}>
                {entry.result.answer}
              </Text>

              {entry.result.sources.length > 0 && (
                <View style={[styles.sources, { borderTopColor: colors.brandBorder }]}>
                  <Text style={[type.label, { color: colors.textSubtle }]}>
                    From {entry.result.sources.length} memor
                    {entry.result.sources.length === 1 ? 'y' : 'ies'}
                  </Text>
                  {entry.result.sources.slice(0, 3).map((s, i) => (
                    <Animated.View
                      key={s.fileUuid}
                      entering={FadeIn.delay(i * 60)}
                      style={styles.sourceRow}
                    >
                      <Text style={[type.mono, { color: colors.brandText }]}>
                        [{i + 1}]
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={[type.small, { color: colors.textMuted, flex: 1 }]}
                      >
                        {s.summary ?? 'Voice note'}
                      </Text>
                      <Text style={[type.mono, { color: colors.textSubtle }]}>
                        {Math.round(s.similarity * 100)}%
                      </Text>
                    </Animated.View>
                  ))}
                </View>
              )}
            </>
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
  mine: {
    maxWidth: '85%',
    padding: space.lg,
    borderRadius: radius.lg,
    borderTopRightRadius: 4,
    gap: space.sm,
  },
  askRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  theirs: {
    maxWidth: '92%',
    padding: space.lg,
    borderRadius: radius.lg,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    gap: space.sm,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sources: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    gap: space.sm,
  },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
