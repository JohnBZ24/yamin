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

import { api, ConversationSummary } from '../lib/api';
import { useSession } from '../hooks/use-session';
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
  const [chats, setChats] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .chats(token)
      .then((list) => !cancelled && setChats(list))
      .catch((e) => !cancelled && setError(e.message ?? 'Could not load your chats'));
    return () => {
      cancelled = true;
    };
  }, [token]);

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
          <Text style={[type.small, { color: colors.dangerText }]}>{error}</Text>
        </View>
      ) : chats === null ? (
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
            <Pressable
              onPress={() =>
                router.push({ pathname: '/chat', params: { c: item.conversationUuid } })
              }
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? colors.surfaceHover : colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <Feather name="message-circle" size={16} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={[type.bodyMedium, { color: colors.text }]}
                >
                  {item.title}
                </Text>
                <Text style={[type.mono, { color: colors.textSubtle }]}>
                  {item.turnCount} turn{item.turnCount === 1 ? '' : 's'} ·{' '}
                  {new Date(item.lastAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.textSubtle} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
