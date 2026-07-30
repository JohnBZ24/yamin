import { Feather } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { KeyboardStickyView } from '../lib/keyboard-controller';
import Animated from 'react-native-reanimated';

import { api, AskSource, ConverseResponse } from '../lib/api';
import { MarkdownText } from '../components/markdown-text';
import { useKeyboardInset } from '../hooks/use-keyboard-inset';
import { useSession } from '../hooks/use-session';
import { useVoiceDictation } from '../hooks/use-voice-dictation';
import { queryKeys, useChatHistory } from '../lib/queries';
import { randomUuid } from '../lib/uuid';
import { bubbleWidth } from '../theme/bubble-width';
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
  const { bottomInset, keyboardVisible } = useKeyboardInset();
  const { ready, token } = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  /**
   * Past turns are the server's, live ones are this screen's.
   *
   * Reopening a conversation used to fetch it and copy the records into the
   * same `turns` state the streaming code appends to, which meant one array
   * held two kinds of thing with different owners. Keeping them apart and
   * concatenating at render time means revisiting a chat is served from cache
   * instantly, and the streaming path never has to be careful not to clobber
   * history.
   */
  const { data: history = [], isPending } = useChatHistory(token, c ?? null);
  const loadingHistory = !!c && isPending;
  const [liveTurns, setLiveTurns] = useState<Turn[]>([]);

  /**
   * The conversation this screen is writing to. The route param wins when
   * present; a chat started fresh has no param until the server issues an id
   * on the first streamed turn, which is what `adopted` holds.
   */
  const [adopted, setAdopted] = useState<string | null>(null);
  const conversationUuid = c ?? adopted;

  // Switching threads (including `startFresh`, which clears the param) must
  // not carry the previous thread's live turns across.
  useEffect(() => {
    setLiveTurns([]);
    setAdopted(null);
  }, [c]);

  const historyTurns = useMemo<Turn[]>(
    () =>
      history.map((r, i) => ({
        // Stable across renders: history is append-only and ordered, so the
        // position is a real identity. randomUuid() here would mint new keys
        // on every render and remount every bubble.
        id: `history:${i}`,
        question: r.question,
        result: { answer: r.answer, sources: r.sources },
      })),
    [history],
  );

  const turns = useMemo(
    () => [...historyTurns, ...liveTurns],
    [historyTurns, liveTurns],
  );

  // `sending` covers the whole streamed turn — with streaming, result stops
  // being null after the first chunk, but the turn isn't done until the
  // stream closes.
  const busy = sending || turns.some((t) => t.result === null && !t.error);

  // Lifting the input bar shortens the thread; keep the newest turn in view.
  useEffect(() => {
    if (!keyboardVisible) return;
    const frame = requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [keyboardVisible]);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || !token || busy) return;
    setDraft('');
    setSending(true);
    const id = randomUuid();
    setLiveTurns((prev) => [...prev, { id, question: trimmed, result: null }]);
    try {
      // Streamed: the bubble fills in as the model writes, instead of a
      // spinner for the whole generation.
      await api.converseStream(
        token,
        { message: trimmed, conversationUuid: conversationUuid ?? undefined },
        (meta) => {
          // First turn of a fresh chat: adopt the server-issued conversation
          // id so every later turn lands in the same thread.
          setAdopted(meta.conversationUuid);
          setLiveTurns((prev) =>
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
          setLiveTurns((prev) =>
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
        setAdopted(result.conversationUuid);
        setLiveTurns((prev) =>
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
        setLiveTurns((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, error: e.message ?? 'Could not reach Yamin' } : t,
          ),
        );
      }
    } finally {
      setSending(false);
      // This turn is now part of the conversation's server-side history, and
      // a brand-new chat has just appeared in the list — both the sidebar's
      // recent chats and the /chats screen are showing stale counts.
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatsAll });
      // A `remembered` turn ran the whole note pipeline server-side, so the
      // feed and the memory it writes to are stale too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes });
      void queryClient.invalidateQueries({ queryKey: queryKeys.entities });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders });
    }
  };

  /**
   * Speaking a question, which this screen simply could not do before — the mic
   * lived only on the home feed. The transcript is asked immediately rather than
   * dropped into the box to edit: it is already a finished sentence, and making
   * the user confirm it is a second step for nothing.
   */
  const dictation = useVoiceDictation({
    token: token ?? '',
    onText: (text) => void ask(text),
  });

  const startFresh = () => {
    // Dropping the `c` param is the whole operation: it disables the history
    // query and trips the effect above, which clears the live turns. It also
    // stops a reload resurrecting the old thread.
    router.setParams({ c: undefined });
  };

  if (!ready) return null;
  if (!token) return <Redirect href="/" />;

  return (
    // No bottom edge — the input bar below owns the bottom inset. See
    // useKeyboardInset.
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.canvas }]}
    >
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

      {/* Sticks to the real IME insets rather than inferring a lift from window
          geometry that edge-to-edge no longer changes — see useKeyboardInset. */}
      <KeyboardStickyView offset={{ closed: 0, opened: pad }}>
        <View
          style={[
            styles.inputBar,
            {
              borderTopColor: colors.borderSubtle,
              // Opaque so the thread does not show through the bar once the
              // keyboard lifts it off the bottom — same note as index.tsx.
              backgroundColor: colors.canvas,
              paddingHorizontal: pad,
              paddingTop: pad,
              paddingBottom: pad + bottomInset,
            },
          ]}
        >
          <View
            style={[styles.column, styles.inputRow, { width: columnWidth }]}
          >
            {dictation.isRecording || dictation.transcribing ? (
              <View style={styles.recRow}>
                <Animated.View
                  style={[
                    styles.recDot,
                    { backgroundColor: colors.danger },
                    dictation.pulseStyle,
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={[type.bodyMedium, styles.recLabel, { color: colors.danger }]}
                >
                  {dictation.transcribing
                    ? 'Transcribing…'
                    : `${formatDuration(dictation.durationMs)} — recording`}
                </Text>
              </View>
            ) : (
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
            )}

            {/*
              The mic is shown until there is something typed, at which point it
              becomes the send button — one control, whichever input the user
              actually reached for. Recording gets explicit discard/send, because
              there is no finger held down here to release.
            */}
            {dictation.isRecording ? (
              <>
                <Pressable
                  onPress={() => dictation.finishRecording(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Discard recording"
                  style={[styles.send, { backgroundColor: colors.surfaceSunken }]}
                >
                  <Feather name="x" size={18} color={colors.textMuted} />
                </Pressable>
                <Pressable
                  onPress={() => dictation.finishRecording(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Send recording"
                  style={[styles.send, { backgroundColor: colors.brand }]}
                >
                  <Feather name="arrow-up" size={18} color={colors.onBrand} />
                </Pressable>
              </>
            ) : draft.trim() ? (
              <Pressable
                onPress={() => ask(draft)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Send question"
                style={[
                  styles.send,
                  { backgroundColor: colors.brand, opacity: busy ? 0.4 : 1 },
                ]}
              >
                <Feather name="arrow-up" size={18} color={colors.onBrand} />
              </Pressable>
            ) : (
              <Animated.View style={dictation.idleStyle}>
                <Pressable
                  onPress={dictation.startRecording}
                  disabled={busy || dictation.transcribing}
                  accessibilityRole="button"
                  accessibilityLabel="Ask by voice"
                  style={[
                    styles.send,
                    {
                      backgroundColor: colors.brand,
                      opacity: busy || dictation.transcribing ? 0.4 : 1,
                    },
                  ]}
                >
                  <Feather name="mic" size={18} color={colors.onBrand} />
                </Pressable>
              </Animated.View>
            )}
          </View>
        </View>
      </KeyboardStickyView>
    </SafeAreaView>
  );
}

function ChatTurn({ turn }: { turn: Turn }) {
  const { colors } = useTokens();
  const { mineMax, theirsMax } = useLayout();
  const [showSources, setShowSources] = useState(false);

  return (
    <View style={styles.turn}>
      <View style={styles.rowRight}>
        {/*
          A plain View, and no `entering` animation — that is the fix, not a
          simplification.

          These two bubbles used to be Animated.Views with FadeInUp/FadeInDown.
          A Reanimated entering animation drives the view's own layout on the UI
          thread, and on Android's Fabric renderer it does that from a frame
          snapshot taken before the parent has settled. An auto-width box (which
          is what `maxWidth` alone gives you) then inherits that unsettled width
          — and a bubble asked to fit a 2-line message into ~40px renders it one
          character per line, stacked downwards. That is the "chat renders
          vertically" bug.

          The home feed never showed it because note-card/answer-card have no
          entry animation (they are under a virtualised list, where a staggered
          fade replays on every scroll pass). This screen kept it, which is why
          only the chat screen stayed broken.
        */}
        <View
          style={[
            styles.question,
            {
              width: bubbleWidth(turn.question, mineMax),
              backgroundColor: colors.brand,
            },
          ]}
        >
          <Text style={[type.body, { color: colors.onBrand }]}>{turn.question}</Text>
        </View>
      </View>

      <View style={styles.rowLeft}>
        <View
          style={[
            styles.answer,
            {
              // Definite, not `maxWidth`. Yamin's answers carry Markdown, a
              // sources list and a badge row, so there is nothing meaningful to
              // estimate from — and full column width is what a long answer
              // wants anyway.
              width: theirsMax,
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
        </View>
      </View>
    </View>
  );
}

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
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
  // The rows pick the side; the bubbles carry a definite pixel `width` from
  // bubble-width.ts. Two things were wrong on this screen and only one of them
  // was shared with the home feed: the bubbles were auto-width (so they
  // inherited any bad parent width verbatim), AND they were Animated.Views with
  // entering animations, which is what produced the bad parent width in the
  // first place. Both are gone — see the comment in ChatTurn.
  rowRight: { flexDirection: 'row', justifyContent: 'flex-end' },
  rowLeft: { flexDirection: 'row', justifyContent: 'flex-start' },
  question: {
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  answer: {
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
  recRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
  // minWidth:0 lets the label truncate instead of shoving the buttons off the bar.
  recLabel: { flexShrink: 1, minWidth: 0 },
  recDot: { width: 10, height: 10, borderRadius: 5 },
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
