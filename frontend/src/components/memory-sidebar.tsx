import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { api, ConversationSummary, Entity, Reminder } from '../lib/api';
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
  onSignOut,
}: {
  token: string;
  refreshKey: number;
  onClose?: () => void;
  onSignOut?: () => void;
}) {
  const { colors } = useTokens();
  const router = useRouter();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [recentChats, setRecentChats] = useState<ConversationSummary[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
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
    api
      .chats(token, 4)
      .then((list) => !cancelled && setRecentChats(list))
      .catch(() => {});
    api
      .reminders(token, 4)
      .then((list) => !cancelled && setReminders(list))
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

  const navigate = (path: '/chat' | '/graph') => {
    onClose?.();
    router.push(path);
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.head, { borderBottomColor: colors.borderSubtle }]}>
        <Text style={[type.heading, { color: colors.text }]}>Memory</Text>
        {onClose && (
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close sidebar"
          >
            <Feather name="x" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* The two other faces of the memory: interrogate it, or see its shape. */}
      <View style={[styles.nav, { borderBottomColor: colors.borderSubtle }]}>
        <Pressable
          onPress={() => navigate('/chat')}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat with Yamin"
          style={({ pressed }) => [
            styles.navBtn,
            {
              backgroundColor: pressed ? colors.surfaceHover : colors.brand,
            },
          ]}
        >
          <Feather name="message-circle" size={15} color={colors.onBrand} />
          <Text style={[type.smallMedium, { color: colors.onBrand }]}>New chat</Text>
        </Pressable>
        <Pressable
          onPress={() => navigate('/graph')}
          accessibilityRole="button"
          accessibilityLabel="Open the knowledge graph"
          style={({ pressed }) => [
            styles.navBtn,
            {
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceHover : 'transparent',
            },
          ]}
        >
          <Feather name="share-2" size={15} color={colors.text} />
          <Text style={[type.smallMedium, { color: colors.text }]}>Graph</Text>
        </Pressable>
      </View>

      <FlatList
        data={entities}
        keyExtractor={(e) => String(e.id)}
        renderItem={renderEntity}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {/* Yamin's own actions, not the user's notes. Shown because a
                reminder that fires and leaves no trace is indistinguishable
                from one that was never set. */}
            {reminders.length > 0 && (
              <View style={styles.chatsSection}>
                <View style={styles.chatsHead}>
                  <Text style={[type.label, { color: colors.textSubtle }]}>
                    Reminders
                  </Text>
                </View>
                {reminders.map((reminder) => (
                  <ReminderRow key={reminder.id} reminder={reminder} />
                ))}
              </View>
            )}

            {recentChats.length > 0 && (
              <View style={styles.chatsSection}>
                <View style={styles.chatsHead}>
                  <Text style={[type.label, { color: colors.textSubtle }]}>
                    Recent chats
                  </Text>
                  <Pressable
                    onPress={() => {
                      onClose?.();
                      router.push('/chats');
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="See all chats"
                  >
                    <Text style={[type.smallMedium, { color: colors.textMuted }]}>
                      All
                    </Text>
                  </Pressable>
                </View>
                {recentChats.map((chat) => (
                  <Pressable
                    key={chat.conversationUuid}
                    onPress={() => {
                      onClose?.();
                      router.push({
                        pathname: '/chat',
                        params: { c: chat.conversationUuid },
                      });
                    }}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.chatRow,
                      {
                        backgroundColor: pressed
                          ? colors.surfaceHover
                          : 'transparent',
                      },
                    ]}
                  >
                    <Feather
                      name="message-circle"
                      size={13}
                      color={colors.textSubtle}
                    />
                    <Text
                      numberOfLines={1}
                      style={[type.small, { color: colors.textMuted, flex: 1 }]}
                    >
                      {chat.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={[type.label, { color: colors.textSubtle }]}>
              {entities.length} thing{entities.length === 1 ? '' : 's'} Yamin knows
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={[type.small, { color: colors.textSubtle }]}>
            Nothing yet. Tell Yamin about someone and they'll appear here.
          </Text>
        }
      />

      {onSignOut && (
        <Pressable
          onPress={onSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          style={({ pressed }) => [
            styles.signOut,
            {
              borderTopColor: colors.borderSubtle,
              backgroundColor: pressed ? colors.surfaceHover : 'transparent',
            },
          ]}
        >
          <Feather name="log-out" size={14} color={colors.textMuted} />
          <Text style={[type.smallMedium, { color: colors.textMuted }]}>Sign out</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * One reminder. A sent one is history and a pending one is a promise, so they
 * are drawn differently — a single undifferentiated list would leave the user
 * unable to tell what is still coming.
 */
function ReminderRow({ reminder }: { reminder: Reminder }) {
  const { colors } = useTokens();
  const sent = reminder.status === 'sent';
  const failed = reminder.status === 'failed';

  const when = new Date(reminder.scheduledFor).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <View style={styles.chatRow}>
      <Feather
        name={failed ? 'alert-circle' : sent ? 'check' : 'clock'}
        size={13}
        color={failed ? colors.dangerText : sent ? colors.successText : colors.brandText}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[type.small, { color: colors.textMuted }]}
        >
          {reminder.title}
        </Text>
        <Text style={[type.mono, { color: colors.textSubtle }]}>
          {sent ? 'sent' : failed ? 'failed' : 'upcoming'} · {when}
        </Text>
      </View>
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
  nav: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
  },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderTopWidth: 1,
  },
  list: { padding: space.md, gap: space.xs },
  listHeader: { gap: space.md },
  chatsSection: { gap: 2 },
  chatsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
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
