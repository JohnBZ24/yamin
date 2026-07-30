import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ConversationSummary, Entity, Reminder } from '../lib/api';
import {
  useChats,
  useDeleteChat,
  useEntities,
  useEntityDetail,
  useReminders,
} from '../lib/queries';
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
  onClose,
  onSignOut,
  selectedId,
  onSelectEntity,
}: {
  token: string;
  onClose?: () => void;
  onSignOut?: () => void;
  /**
   * Supplying these lifts entity selection to the parent, which is what the
   * wide layout does so the detail can be shown in its own column. Left out,
   * the sidebar owns the selection and expands the row inline — the only
   * option when there is no room for a third pane.
   */
  selectedId?: number | null;
  onSelectEntity?: (id: number | null) => void;
}) {
  const { colors } = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const controlled = onSelectEntity !== undefined;
  const [ownSelected, setOwnSelected] = useState<number | null>(null);
  const selected = controlled ? (selectedId ?? null) : ownSelected;
  const setSelected = controlled ? onSelectEntity : setOwnSelected;

  /**
   * No refreshKey prop any more. These used to be three fetches in an effect
   * keyed on a counter the feed screen incremented after every processed or
   * deleted note, threaded down through two components for the sole purpose of
   * making this effect run again. Invalidating the keys does the same job from
   * wherever the change actually happened.
   */
  const { data: entities = [] } = useEntities(token);
  const { data: recentChats = [] } = useChats(token, 4);
  const { data: reminders = [] } = useReminders(token, 4);
  const deleteChat = useDeleteChat(token);
  // Nothing is fetched while nothing is selected; expanding a row is what
  // enables this. When the parent owns selection it is also rendering the
  // detail itself, so there is nothing to fetch for here.
  const { data: detail } = useEntityDetail(token, controlled ? null : selected);

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
    // `detail` is undefined whenever the parent owns selection, so the inline
    // accordion below simply does not render in that mode — the detail column
    // is showing it instead.
    [selected, setSelected, detail, colors],
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
                  <RecentChatRow
                    key={chat.conversationUuid}
                    chat={chat}
                    onOpen={() => {
                      onClose?.();
                      router.push({
                        pathname: '/chat',
                        params: { c: chat.conversationUuid },
                      });
                    }}
                    onDelete={() => deleteChat.mutate(chat.conversationUuid)}
                  />
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
            Nothing yet. Tell Yamin about someone and they&apos;ll appear here.
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
              /**
               * Clear of the system navigation area. This sat flush against the
               * bottom of the screen, which on a Samsung with gesture navigation
               * is the home-swipe strip — so aiming for "Sign out" triggered the
               * home gesture instead. The inset is the height the OS reserves
               * there, and `space.md` keeps the tap target off the very edge even
               * on a device that reports no inset at all.
               */
              paddingBottom: insets.bottom + space.md,
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
 * A recent chat, with a two-tap delete.
 *
 * Two taps rather than a confirm dialog: `Alert.alert` is a no-op in
 * react-native-web, so a dialog would leave the web build deleting with no
 * confirmation at all. First tap arms and turns red, second deletes, and it
 * disarms itself if the user moves on — same pattern as note-card.tsx.
 */
function RecentChatRow({
  chat,
  onOpen,
  onDelete,
}: {
  chat: ConversationSummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTokens();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.chatRow,
        { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
      ]}
    >
      <Feather name="message-circle" size={13} color={colors.textSubtle} />
      <Text
        numberOfLines={1}
        style={[type.small, styles.chatTitle, { color: colors.textMuted }]}
      >
        {chat.title}
      </Text>
      <Pressable
        // Stops the row's own press from firing, which would open the very chat
        // the user is trying to delete.
        onPress={(event) => {
          event.stopPropagation();
          if (armed) onDelete();
          else setArmed(true);
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={armed ? 'Confirm delete chat' : 'Delete chat'}
      >
        <Feather
          name={armed ? 'x-circle' : 'trash-2'}
          size={13}
          color={armed ? colors.dangerText : colors.textSubtle}
        />
      </Pressable>
    </Pressable>
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
    // paddingBottom is supplied per-render from the safe-area inset.
    paddingTop: space.lg,
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
  // minWidth:0 lets a long title truncate instead of pushing the delete icon
  // off the row.
  chatTitle: { flex: 1, minWidth: 0 },
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
