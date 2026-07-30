import { Feather } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '../hooks/use-session';
import { ConversationSummary } from '../lib/api';
import { useChats, useDeleteChat } from '../lib/queries';
import { radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/**
 * Every conversation the user has had with Yamin, newest activity first.
 * Tapping one reopens it in /chat, ready to continue.
 */
export default function ChatsScreen() {
  const { colors } = useTokens();
  const router = useRouter();
  const { ready, token } = useSession();
  const { data: chats, error, isPending } = useChats(token);
  const deleteChat = useDeleteChat(token);

  if (!ready) return null;
  if (!token) return <Redirect href="/" />;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <Text style={[type.title, { color: colors.text }]}>Your chats</Text>
        <Pressable
          onPress={() => router.push('/chat')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
        >
          <Feather name="edit" size={18} color={colors.text} />
        </Pressable>
      </View>

      {error ? (
        <View style={styles.empty}>
          <Text style={[type.small, { color: colors.dangerText }]}>
            {(error as any).message ?? 'Could not load your chats'}
          </Text>
        </View>
      ) : isPending ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(chat) => chat.conversationUuid}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="message-circle" size={26} color={colors.textSubtle} />
              <Text style={[type.heading, { color: colors.text }]}>No chats yet</Text>
              <Text
                style={[type.small, { color: colors.textSubtle, textAlign: 'center' }]}
              >
                Ask Yamin something and the conversation will be kept here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ChatRow
              chat={item}
              onOpen={() =>
                router.push({ pathname: '/chat', params: { c: item.conversationUuid } })
              }
              onDelete={() => deleteChat.mutate(item.conversationUuid)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * One conversation, with a two-tap delete.
 *
 * Two taps rather than a confirm dialog because `Alert.alert` is a no-op in
 * react-native-web, so a dialog would make the web build silently delete with no
 * confirmation at all. The first tap arms and labels itself, the second deletes,
 * and it disarms on its own if the user moves on — see the same pattern in
 * note-card.tsx.
 */
function ChatRow({
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
        styles.row,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: armed ? colors.danger : colors.borderSubtle,
        },
      ]}
    >
      <Feather name="message-circle" size={16} color={colors.textMuted} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[type.bodyMedium, { color: colors.text }]}>
          {chat.title}
        </Text>
        <Text style={[type.mono, { color: colors.textSubtle }]}>
          {chat.turnCount} turn{chat.turnCount === 1 ? '' : 's'} ·{' '}
          {new Date(chat.lastAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </Text>
      </View>

      <Pressable
        // Stops the row's own onPress from firing, which would navigate into the
        // chat the user is trying to delete.
        onPress={(event) => {
          event.stopPropagation();
          if (armed) onDelete();
          else setArmed(true);
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={armed ? 'Confirm delete chat' : 'Delete chat'}
        style={styles.deleteBtn}
      >
        {armed && (
          <Text style={[type.mono, { color: colors.dangerText }]}>tap to delete</Text>
        )}
        <Feather
          name={armed ? 'x-circle' : 'trash-2'}
          size={15}
          color={armed ? colors.dangerText : colors.textSubtle}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rowText: { flex: 1 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    minHeight: 56,
  },
  list: { padding: space.lg, gap: space.sm, maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xxxl,
  },
});
