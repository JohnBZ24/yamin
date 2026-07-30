import { Feather } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useEntityDetail } from '../lib/queries';
import { DETAIL_WIDTH, radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/**
 * The third column, shown only on a wide screen.
 *
 * On a phone, tapping an entity expands it inline in the sidebar, because
 * there is nowhere else for it to go. Given a 1280px window there is — and the
 * inline accordion is the worse answer there, since it pushes the rest of the
 * list around every time you look at something.
 *
 * It reads through the same `useEntityDetail` key the sidebar uses, so opening
 * an entity that was already expanded costs no request.
 */
export function EntityDetailPane({
  token,
  entityId,
  onClose,
}: {
  token: string;
  entityId: number | null;
  onClose: () => void;
}) {
  const { colors } = useTokens();
  const { data: detail, isPending } = useEntityDetail(token, entityId);

  return (
    <View
      style={[
        styles.pane,
        { backgroundColor: colors.surface, borderLeftColor: colors.borderSubtle },
      ]}
    >
      {entityId == null ? (
        <View style={styles.placeholder}>
          <Feather name="mouse-pointer" size={22} color={colors.textSubtle} />
          <Text style={[type.small, styles.centred, { color: colors.textSubtle }]}>
            Pick something Yamin knows to see what it has learned about it.
          </Text>
        </View>
      ) : isPending || !detail ? (
        <View style={styles.placeholder}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <>
          <View style={[styles.head, { borderBottomColor: colors.borderSubtle }]}>
            <View style={styles.headText}>
              <Text numberOfLines={2} style={[type.heading, { color: colors.text }]}>
                {detail.entity.name}
              </Text>
              <Text style={[type.mono, { color: colors.textSubtle }]}>
                {detail.entity.type} · {detail.entity.mentionCount} mention
                {detail.entity.mentionCount === 1 ? '' : 's'}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close details"
            >
              <Feather name="x" size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {detail.entity.description ? (
              <Text style={[type.small, { color: colors.textMuted }]}>
                {detail.entity.description}
              </Text>
            ) : null}

            <Text style={[type.label, { color: colors.textSubtle }]}>Connections</Text>
            {detail.facts.length === 0 ? (
              <Text style={[type.small, { color: colors.textSubtle }]}>
                Nothing linked yet.
              </Text>
            ) : (
              detail.facts.map((f) => (
                <Text
                  key={`${f.type}-${f.direction}-${f.otherNodeName}`}
                  style={[type.small, { color: colors.textMuted }]}
                >
                  {f.direction === 'outgoing' ? '→ ' : '← '}
                  <Text style={{ color: colors.brandText }}>
                    {f.type.replace(/_/g, ' ').toLowerCase()}
                  </Text>{' '}
                  {f.otherNodeName}
                </Text>
              ))
            )}

            {detail.mentions.length > 0 && (
              <>
                <Text style={[type.label, { color: colors.textSubtle }]}>
                  Where it came up
                </Text>
                {detail.mentions.map((m, i) => (
                  <View
                    key={`${m.createdAt}-${i}`}
                    style={[styles.mention, { borderLeftColor: colors.borderStrong }]}
                  >
                    <Text style={[type.mono, { color: colors.textSubtle }]}>
                      {new Date(m.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                    <Text
                      numberOfLines={3}
                      style={[type.small, { color: colors.textMuted }]}
                    >
                      {m.summary ?? 'Voice note'}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { width: DETAIL_WIDTH, borderLeftWidth: 1 },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  centred: { textAlign: 'center' },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
    borderBottomWidth: 1,
  },
  headText: { flex: 1, gap: 2 },
  body: { padding: space.lg, gap: space.sm },
  mention: {
    borderLeftWidth: 2,
    paddingLeft: space.md,
    gap: 2,
  },
});
