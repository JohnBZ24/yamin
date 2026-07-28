import { Feather } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { api, AskSource, ConverseResponse } from '../lib/api';
import { MarkdownText } from '../components/markdown-text';
import { useKeyboardOffset } from '../hooks/use-keyboard-offset';
import { useSession } from '../hooks/use-session';
import { randomUuid } from '../lib/uuid';
import { radius, space, type } from '../theme/tokens';
import { useLayout } from '../theme/use-layout';
import { useTokens } from '../theme/use-tokens';

type Turn = {
  id: string;
  question: string;
  result: Pick<ConverseResponse, 'answer' | 'sources'> & {
    kind?: ConverseResponse['kind'];
  } | null;
  error?: string;
};

const SUGGESTIONS = [
  'What do you know about me?',
  'Remind me in 10 minutes to stretch',
  'What is on my plate this week?',
];

/**
 * A focused conversation with Yamin's memory. Every turn is persisted
 * server-side under a conversation id, so navigating away loses nothing —
 * past chats live in /chats and reopen right here via the `c` route param.
 */
export default function ChatScreen() {
  const { colors } = useTokens();
  const router = useRouter();
  const { c } = useLocalSearchParams<{ c?: string }>();
  const { pad, columnWidth } = useLayout();
  const keyboardOffset = useKeyboardOffset();
  const { ready, token } = useSession();
  const [conversationUuid, setConversationUuid] = useState<string | null>(c ?? null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(!!c);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // `sending` covers the whole streamed turn — with streaming, result stops
  // being null after the first chunk, but the turn isn't done until the
  // stream closes.
  const busy = sending || turns.some((t) => t.result === null && !t.error);

  // Reopening a past conversation: fetch its turns once.
  useEffect(() => {
    if (!c || !token) return;
    let cancelled = false;
    api
      .chat(token, c)
      .then((records) => {
        if (cancelled) return;
        setTurns(
          records.map((r) => ({
            id: randomUuid(),
            question: r.question,
            result: { answer: r.answer, sources: r.sources },
          })),
        );
        setConversationUuid(c);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingHistory(false));
    return () => {
      cancelled = true;
    };
  }, [c, token]);

  // Lifting the input bar shortens the thread; keep the newest turn in view.
  useEffect(() => {
    if (keyboardOffset === 0) return;
    const frame = requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [keyboardOffset]);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || !token || busy) return;
    setDraft('');
    setSending(true);
    const id = randomUuid();
    setTurns((prev) => [...prev, { id, question: trimmed, result: null }]);
    try {
      // Streamed: the bubble fills in as the model writes, instead of a
      // spinner for the whole generation.
      await api.converseStream(
        token,
        { message: trimmed, conversationUuid: conversationUuid ?? undefined },
        (meta) => {
          // First turn of a fresh chat: adopt the server-issued conversation
          // id so every later turn lands in the same thread.
          setConversationUuid(meta.conversationUuid);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    result: { answer: '', sources: meta.sources, kind: meta.kind },
                  }
                : t,
            ),
          );
        },
        (chunk) => {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id && t.result
                ? {
                    ...t,
                    result: { ...t.result, answer: t.result.answer + chunk },
                  }
                : t,
            ),
          );
        },
      );
    } catch {
      // Streaming can fail where plain requests survive (stalled proxies,
      // aggressive networks). Fall back to the one-shot endpoint before
      // showing an error — the user cares about the answer, not the transport.
      try {
        const result = await api.converse(token, trimmed, conversationUuid ?? undefined);
        setConversationUuid(result.conversationUuid);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  result: {
                    answer: result.answer,
                    sources: result.sources,
                    kind: result.kind,
                  },
                }
              : t,
          ),
        );
      } catch (e: any) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, error: e.message ?? 'Could not reach Yamin' } : t,
          ),
        );
      }
    } finally {
      setSending(false);
    }
  };

  const startFresh = () => {
    setTurns([]);
    setConversationUuid(null);
    // Drop the `c` param so a reload doesn't resurrect the old thread.
    router.setParams({ c: undefined });
  };

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
        <Text style={[type.title, { color: colors.text }]}>Ask Yamin</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/chats')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Chat history"
          >
            <Feather name="clock" size={18} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={startFresh}
            hitSlop={10}
            disabled={turns.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Start a new chat"
          >
            <Feather
              name="edit"
              size={18}
              color={turns.length === 0 ? colors.textSubtle : colors.text}
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.feed,
          { paddingHorizontal: pad, paddingTop: pad },
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <View style={[styles.column, { width: columnWidth }]}>
          {loadingHistory ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          ) : turns.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="message-circle" size={26} color={colors.textSubtle} />
              <Text style={[type.heading, { color: colors.text }]}>
                Ask anything you have told Yamin
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => ask(s)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.suggestion,
                      {
                        borderColor: colors.border,
                        backgroundColor: pressed
                          ? colors.surfaceHover
                          : colors.surface,
                      },
                    ]}
                  >
                    <Text style={[type.small, { color: colors.textMuted }]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            turns.map((turn) => <ChatTurn key={turn.id} turn={turn} />)
          )}
        </View>
      </ScrollView>

      {/* paddingBottom instead of KeyboardAvoidingView — see useKeyboardOffset. */}
      <View
        style={[
          styles.inputBar,
          {
            borderTopColor: colors.borderSubtle,
            paddingHorizontal: pad,
            paddingTop: pad,
            paddingBottom: pad + keyboardOffset,
          },
        ]}
      >
        <View style={[styles.column, styles.inputRow, { width: columnWidth }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => ask(draft)}
            placeholder="Ask about anything you've told Yamin…"
            placeholderTextColor={colors.textSubtle}
            accessibilityLabel="Your question"
            style={[
              styles.input,
              type.body,
              {
                color: colors.text,
                backgroundColor: colors.surfaceSunken,
                borderColor: colors.border,
              },
            ]}
            {...({ outlineStyle: 'none' } as object)}
          />
          <Pressable
            onPress={() => ask(draft)}
            disabled={busy || !draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send question"
            style={[
              styles.send,
              {
                backgroundColor: colors.brand,
                opacity: busy || !draft.trim() ? 0.4 : 1,
              },
            ]}
          >
            <Feather name="arrow-up" size={18} color={colors.onBrand} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function ChatTurn({ turn }: { turn: Turn }) {
  const { colors } = useTokens();
  const { mineMax, theirsMax } = useLayout();
  const [showSources, setShowSources] = useState(false);

  return (
    <View style={styles.turn}>
      <Animated.View
        entering={FadeInUp.duration(180)}
        style={[styles.question, { maxWidth: mineMax, backgroundColor: colors.brand }]}
      >
        <Text style={[type.body, { color: colors.onBrand }]}>{turn.question}</Text>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.duration(180)}
        style={[
          styles.answer,
          {
            maxWidth: theirsMax,
            backgroundColor: colors.surface,
            borderColor: colors.borderSubtle,
          },
        ]}
      >
        <View style={styles.answerHead}>
          <Feather name="zap" size={12} color={colors.textMuted} />
          <Text style={[type.label, { color: colors.textMuted }]}>Yamin</Text>
          {turn.result?.kind === 'remembered' && (
            <View
              style={[styles.rememberedBadge, { backgroundColor: colors.successSurface }]}
            >
              <Feather name="check" size={10} color={colors.successText} />
              <Text style={[type.label, { color: colors.successText }]}>saved</Text>
            </View>
          )}
        </View>
        {turn.error ? (
          <Text style={[type.body, { color: colors.dangerText }]}>{turn.error}</Text>
        ) : turn.result === null || turn.result.answer === '' ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <>
            <MarkdownText>{turn.result.answer}</MarkdownText>
            {turn.result.sources.length > 0 && (
              <Pressable
                onPress={() => setShowSources((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel="Show the voice notes this answer came from"
                style={styles.sourcesToggle}
              >
                <Feather
                  name={showSources ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  color={colors.textSubtle}
                />
                <Text style={[type.mono, { color: colors.textSubtle }]}>
                  from {turn.result.sources.length} voice note
                  {turn.result.sources.length === 1 ? '' : 's'}
                </Text>
              </Pressable>
            )}
            {showSources &&
              turn.result.sources.map((source, i) => (
                <SourceRow key={source.fileUuid + i} index={i + 1} source={source} />
              ))}
          </>
        )}
      </Animated.View>
    </View>
  );
}

/** One cited voice note: [n] matches the [n] citations inside the answer. */
function SourceRow({ index, source }: { index: number; source: AskSource }) {
  const { colors } = useTokens();
  const when = new Date(source.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <View style={[styles.source, { borderLeftColor: colors.borderStrong }]}>
      <Text style={[type.mono, { color: colors.textSubtle }]}>
        [{index}] {when}
      </Text>
      <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={2}>
        {source.summary ?? 'Voice note'}
      </Text>
    </View>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  feed: { paddingBottom: space.xxl },
  // Width in pixels from useLayout(); percentages here collapsed on Android.
  column: { alignSelf: 'center', gap: space.lg },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxxl },
  suggestions: { gap: space.sm, marginTop: space.md, alignSelf: 'stretch' },
  suggestion: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  turn: { gap: space.sm },
  // maxWidth comes from useLayout() in pixels, not '%'.
  question: {
    alignSelf: 'flex-end',
    flexShrink: 1,
    minWidth: 0,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  answer: {
    alignSelf: 'flex-start',
    flexShrink: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
  },
  answerHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rememberedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    borderRadius: radius.pill,
    marginLeft: space.xs,
  },
  sourcesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: 2,
  },
  source: {
    borderLeftWidth: 2,
    paddingLeft: space.md,
    gap: 2,
  },
  inputBar: { borderTopWidth: 1, padding: space.lg },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 46,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
