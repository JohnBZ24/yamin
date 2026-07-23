import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { api, Entity } from '../lib/api';
import { radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

const TYPE_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  Person: 'user',
  Organization: 'briefcase',
  Project: 'layers',
  Task: 'check-square',
  Event: 'calendar',
  Location: 'map-pin',
  Topic: 'hash',
  Product: 'box',
  TimeReference: 'clock',
  Other: 'circle',
};

/**
 * The knowledge graph, made visible.
 *
 * The backend has always built this and the UI never showed it — the whole
 * point of Yamin is that it accumulates a picture of your world, so the user
 * should be able to see that picture growing.
 */
export function MemorySidebar({
  token,
  refreshKey,
  onClose,
}: {
  token: string;
  refreshKey: number;
  onClose?: () => void;
}) {
  const { colors } = useTokens();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.entity>> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    api
      .entities(token)
      .then((list) => !cancelled && setEntities(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  useEffect(() => {
    if (selected == null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api
      .entity(token, selected)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, selected]);

  const renderEntity = useCallback(
    ({ item: e }: { item: Entity }) => {
      const isOpen = selected === e.id;
      return (
        <View>
          <Pressable
            onPress={() => setSelected(isOpen ? null : e.id)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor:
                  isOpen || pressed ? colors.surfaceHover : 'transparent',
              },
            ]}
          >
            <Feather
              name={TYPE_ICON[e.type] ?? 'circle'}
              size={14}
              color={colors.brandText}
            />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={[type.smallMedium, { color: colors.text }]}
              >
                {e.name}
              </Text>
              <Text style={[type.mono, { color: colors.textSubtle }]}>
                {e.type}
              </Text>
            </View>
            {/* Salience: how many separate notes mention this. */}
            <View style={[styles.count, { backgroundColor: colors.surfaceSunken }]}>
              <Text style={[type.mono, { color: colors.textMuted }]}>
                {e.mentionCount}
              </Text>
            </View>
          </Pressable>

          {isOpen && detail && (
            <Animated.View
              entering={FadeIn}
              style={[styles.detail, { borderLeftColor: colors.brandBorder }]}
            >
              {detail.facts.length === 0 ? (
                <Text style={[type.small, { color: colors.textSubtle }]}>
                  No connections yet.
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
              <Text style={[type.mono, { color: colors.textSubtle }]}>
                in {detail.mentions.length} note
                {detail.mentions.length === 1 ? '' : 's'}
              </Text>
            </Animated.View>
          )}
        </View>
      );
    },
    [selected, detail, colors],
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.head, { borderBottomColor: colors.borderSubtle }]}>
        <Text style={[type.heading, { color: colors.text }]}>Memory</Text>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={entities}
        keyExtractor={(e) => String(e.id)}
        renderItem={renderEntity}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={[type.label, { color: colors.textSubtle }]}>
            {entities.length} thing{entities.length === 1 ? '' : 's'} Yamin knows
          </Text>
        }
        ListEmptyComponent={
          <Text style={[type.small, { color: colors.textSubtle }]}>
            Nothing yet. Tell Yamin about someone and they'll appear here.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
  },
  list: { padding: space.md, gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  count: {
    minWidth: 22,
    alignItems: 'center',
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  detail: {
    marginLeft: space.xl,
    paddingLeft: space.md,
    paddingBottom: space.md,
    borderLeftWidth: 2,
    gap: space.xs,
  },
});
