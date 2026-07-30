import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardStickyView } from '../lib/keyboard-controller';

import { AnswerCard, AnswerEntry } from '../components/answer-card';
import { Composer } from '../components/composer';
import { EmptyFeed } from '../components/empty-feed';
import { EntityDetailPane } from '../components/entity-detail-pane';
import { LoginScreen } from '../components/login-screen';
import { NoteCard } from '../components/note-card';
import { NotificationBanner } from '../components/notification-banner';
import { ScreenHeader } from '../components/screen-header';
import { SidebarShell } from '../components/sidebar-shell';
import { useToast } from '../components/toast';
import { useKeyboardInset } from '../hooks/use-keyboard-inset';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts';
import { useSession } from '../hooks/use-session';
import { api, VoiceNote } from '../lib/api';
import {
  invalidateAfterNoteProcessed,
  queryKeys,
  useDeleteNote,
  useNotes,
} from '../lib/queries';
import { useRealtime } from '../lib/realtime';
import {
  NotifyStatus,
  notifyStatus,
  notifyStatusMessage,
  requestNotificationPermission,
  showNotification,
} from '../lib/notify';
import { registerForPush } from '../lib/push';
import { randomUuid } from '../lib/uuid';
import { space } from '../theme/tokens';
import { useLayout } from '../theme/use-layout';
import { useTokens } from '../theme/use-tokens';

type FeedItem =
  | { kind: 'note'; key: string; at: string; note: VoiceNote }
  | { kind: 'answer'; key: string; at: string; answer: AnswerEntry };

/**
 * What the worker is doing right now, per note.
 *
 * Deliberately not stored on the cached note: this is transient progress about
 * a job, not a field of the record, and it is meaningless once the note is
 * processed. Keeping it beside the cache means a refetch cannot resurrect a
 * stale stage.
 */
const STAGE_LABEL: Record<string, string> = {
  understanding: 'Understanding…',
  extracting: 'Finding what matters…',
  remembering: 'Remembering…',
};

export default function YaminScreen() {
  const { colors } = useTokens();
  const toast = useToast();
  const { isDesktop, isWide, pad, columnWidth, drawerWidth } = useLayout();
  const { bottomInset, keyboardVisible } = useKeyboardInset();

  const { ready, token, signIn, signUp, signOut } = useSession();
  const { socket, online } = useRealtime();
  const queryClient = useQueryClient();

  // Server state: cached, and refreshed by invalidating its key.
  const { data: notes = [], error: notesError } = useNotes(token);
  const deleteNote = useDeleteNote(token);

  // Client state: questions asked in this session. These are not on the
  // server until the answer lands, so they are genuinely local.
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [notifState, setNotifState] = useState<NotifyStatus>('unsupported');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /**
   * Only meaningful on a wide screen, where the detail gets its own column.
   * Narrower than that the sidebar keeps its own selection and expands the row
   * in place, so this stays null and the pane is never mounted.
   */
  const [selectedEntity, setSelectedEntity] = useState<number | null>(null);
  /** fileUuid → the worker stage last reported for it. */
  const [stages, setStages] = useState<Record<string, string>>({});
  const feedRef = useRef<FlatList<FeedItem>>(null);

  useKeyboardShortcuts({
    onToggleSidebar: () => {
      // The sidebar is permanent above the desktop breakpoint, so there the
      // shortcut has nothing to toggle.
      if (!isDesktop) setSidebarOpen((open) => !open);
    },
    onEscape: () => {
      setSidebarOpen(false);
      setSelectedEntity(null);
    },
  });

  /**
   * Home's questions are one continuous thread. Without this every question
   * started a fresh conversation, so "and his mother?" arrived with nothing to
   * continue and the follow-up simply could not work.
   */
  const homeConversation = useRef<string | undefined>(undefined);

  /**
   * Asking is a turn in the feed, not a separate panel: the question appears
   * immediately with a spinner and is filled in when the answer lands, so it
   * behaves like every other message here.
   *
   * Two lanes land here. `ask` is answered from the user's own notes and comes
   * back with sources; `chitchat` is anything aimed at Yamin itself or general
   * advice, answered without touching their memories. Routing chitchat through
   * /ask would embed "what can you do?", match nothing, and then load 20 of
   * their private notes into the prompt to answer a question about the app.
   */
  const ask = async (question: string, intent: 'ask' | 'chitchat' = 'ask') => {
    if (!token) return;
    const id = randomUuid();
    setAnswers((prev) => [
      ...prev,
      { id, question, createdAt: new Date().toISOString(), result: null, intent },
    ]);
    try {
      const result =
        intent === 'chitchat'
          ? await api.reply(token, question, homeConversation.current)
          : await api.ask(token, question, homeConversation.current);
      homeConversation.current = result.conversationUuid;
      setAnswers((prev) =>
        prev.map((a) => (a.id === id ? { ...a, result } : a)),
      );
    } catch (e: any) {
      setAnswers((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, error: e.message ?? 'Could not reach Yamin' }
            : a,
        ),
      );
    }
  };

  // The row disappears on tap and comes back if the server refuses — the
  // rollback and the cache bookkeeping live in useDeleteNote.
  const removeNote = (fileUuid: string) =>
    deleteNote.mutate(fileUuid, {
      onSuccess: () => toast('Note deleted', 'success'),
      onError: (e: any) =>
        toast(e.message ?? 'Could not delete that note', 'error'),
    });

  // Re-checked on focus: the user may grant or revoke permission in browser
  // settings while the tab is open, and a stale banner is worse than none.
  useEffect(() => {
    if (!token) return;
    const refresh = () => setNotifState(notifyStatus());
    refresh();
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('focus', refresh);
      return () => window.removeEventListener('focus', refresh);
    }
  }, [token]);

  // Native only. This is what lets a reminder arrive with the app closed —
  // without a registered token the server has nowhere to push to, and delivery
  // silently falls back to "only while a socket is open".
  useEffect(() => {
    if (!token || Platform.OS === 'web') return;
    (async () => {
      const result = await registerForPush();
      if (!result.ok) {
        console.warn(`Push not registered: ${result.reason}`);
        return;
      }
      try {
        await api.registerPushToken(token, result.token, Platform.OS);
      } catch (e: any) {
        console.warn(`Could not register push token: ${e.message}`);
      }
    })();
  }, [token]);

  // The fetch itself is useNotes(); this only reports a failure, which a query
  // hook has no way to do on its own.
  useEffect(() => {
    if (!notesError) return;
    toast((notesError as any).message ?? 'Could not load your notes', 'error');
  }, [notesError, toast]);

  // Feed-specific realtime events, on the app-wide socket owned by
  // RealtimeProvider (which also handles reminder alerts globally — a
  // reminder must reach the user on ANY screen, not just this one).
  useEffect(() => {
    if (!socket) return;

    // Named stages from the worker, replacing a single "Thinking…" that sat
    // there for the whole 5–20s run.
    const onProgress = (data: any) => {
      setStages((prev) => ({ ...prev, [data.fileUuid]: data.stage }));
    };

    const clearStage = (fileUuid: string) =>
      setStages((prev) => {
        if (!(fileUuid in prev)) return prev;
        const next = { ...prev };
        delete next[fileUuid];
        return next;
      });

    const onProcessed = (data: any) => {
      clearStage(data.fileUuid);
      // Paint the payload straight away so the card settles without waiting on
      // a round trip, then let the refetch reconcile: the event carries the
      // summary and nodes, but the server is still the authority on the rest of
      // the row (and on the entities and reminders it just wrote).
      queryClient.setQueryData<VoiceNote[]>(queryKeys.notes, (prev) =>
        (prev ?? []).map((n) =>
          n.fileUuid === data.fileUuid
            ? { ...n, status: 'processed', summary: data.summary, nodes: data.nodes }
            : n,
        ),
      );
      invalidateAfterNoteProcessed(queryClient);
    };

    const onFailed = (data: any) => {
      clearStage(data.fileUuid);
      queryClient.setQueryData<VoiceNote[]>(queryKeys.notes, (prev) =>
        (prev ?? []).map((n) =>
          n.fileUuid === data.fileUuid ? { ...n, status: 'failed' } : n,
        ),
      );
      toast(data.error ?? 'That note could not be processed', 'error');
    };

    socket.on('voice-progress', onProgress);
    socket.on('voice-processed', onProcessed);
    socket.on('voice-failed', onFailed);
    return () => {
      socket.off('voice-progress', onProgress);
      socket.off('voice-processed', onProcessed);
      socket.off('voice-failed', onFailed);
    };
  }, [socket, toast, queryClient]);

  // The composer lifting off the keyboard shortens the feed; without this the
  // last message ends up hidden behind it, which is exactly the message the
  // user was replying to.
  useEffect(() => {
    if (!keyboardVisible) return;
    const frame = requestAnimationFrame(() =>
      feedRef.current?.scrollToEnd({ animated: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [keyboardVisible]);

  // Follow the conversation only when it actually grows. This used to hang off
  // the list's onContentSizeChange, which also fires when existing content is
  // re-measured — a summary arriving mid-scroll would drag the user back to the
  // bottom while they were reading something else.
  // Counted from the state the feed is built from, not from `feedItems` — that
  // is derived below the early returns, and a hook cannot live down there.
  const itemCount = notes.length + answers.length;
  const feedCount = useRef(0);
  useEffect(() => {
    if (itemCount > feedCount.current) {
      requestAnimationFrame(() =>
        feedRef.current?.scrollToEnd({ animated: true }),
      );
    }
    feedCount.current = itemCount;
  }, [itemCount]);

  // Until the stored session is restored, render nothing — flashing the login
  // screen at every signed-in user on cold start reads as being logged out.
  if (!ready) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]} />
    );
  }

  if (!token) {
    return <LoginScreen onSignIn={signIn} onSignUp={signUp} />;
  }

  /**
   * Notes and answers are one conversation, ordered oldest-first so the newest
   * sits at the bottom next to the composer — which is also where the view
   * scrolls to.
   *
   * Sorting on createdAt rather than array position is what makes a just-sent
   * note actually visible: history arrives newest-first, so appending an
   * optimistic note put it at the END of a descending list, and the old
   * `.reverse()` render then drew it at the very TOP of the feed — off-screen,
   * while the scroll jumped to the bottom.
   */
  const feedItems = [
    ...notes.map((note) => ({
      kind: 'note' as const,
      key: `note:${note.fileUuid}`,
      at: note.createdAt,
      note,
    })),
    ...answers.map((answer) => ({
      kind: 'answer' as const,
      key: `ask:${answer.id}`,
      at: answer.createdAt,
      answer,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    // No bottom edge: the composer below owns the bottom inset, so the space it
    // needs is one number under one component's control rather than two that
    // have to agree. See useKeyboardInset.
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.canvas }]}
    >
      <View style={styles.shell}>
        <SidebarShell
          isDesktop={isDesktop}
          open={sidebarOpen}
          drawerWidth={drawerWidth}
          token={token}
          onCloseMobile={() => setSidebarOpen(false)}
          onSignOut={() => void signOut()}
          // Handing selection up is what turns the inline accordion into the
          // third column; below `isWide` there is no column, so it stays down
          // in the sidebar where it belongs.
          selectedEntity={isWide ? selectedEntity : undefined}
          onSelectEntity={isWide ? setSelectedEntity : undefined}
        />

        <View style={styles.main}>
          <ScreenHeader
            isDesktop={isDesktop}
            online={online}
            onOpenSidebar={() => setSidebarOpen(true)}
            onTestNotification={() => {
              const shown = showNotification(
                'Yamin reminder',
                'This is what a reminder looks like.',
              );
              if (!shown) {
                const why =
                  notifyStatusMessage(notifyStatus()) ??
                  'Notifications are unavailable in this browser.';
                toast(why, 'error', { sticky: true });
              }
              setNotifState(notifyStatus());
            }}
          />

          <NotificationBanner
            message={notifyStatusMessage(notifState)}
            canEnable={notifState === 'askable'}
            onEnable={async () => {
              await requestNotificationPermission();
              setNotifState(notifyStatus());
            }}
          />

          {/*
            FlatList, not ScrollView: a ScrollView mounts every note in the
            history at once, so the feed got slower with each note the user ever
            recorded and scrolling had to composite all of them. This windows
            them — only what is near the viewport exists.

            The auto-scroll is also gone from onContentSizeChange, which fired
            on every layout settle (text measuring, a summary arriving, an image
            sizing) and yanked the list to the bottom mid-scroll. It now runs
            only when the number of items actually grows — see below.
          */}
          <FlatList
            ref={feedRef}
            data={feedItems}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => (
              // Centre column: long lines are unreadable on a wide monitor.
              <View style={[styles.feedRow, { width: columnWidth }]}>
                {item.kind === 'note' ? (
                  <NoteCard
                    note={item.note}
                    stageLabel={STAGE_LABEL[stages[item.note.fileUuid]]}
                    onDelete={async () => removeNote(item.note.fileUuid)}
                  />
                ) : (
                  <AnswerCard entry={item.answer} />
                )}
              </View>
            )}
            ListEmptyComponent={<EmptyFeed />}
            style={styles.fill}
            contentContainerStyle={[
              styles.feed,
              { paddingHorizontal: pad, paddingTop: pad },
            ]}
            keyboardShouldPersistTaps="handled"
            /**
             * removeClippedSubviews is deliberately OFF.
             *
             * It is the usual first reach for list performance, but on Android
             * it detaches subviews the layout pass has not finished with, which
             * corrupts the measurement of what is left — the bubbles here are
             * width-auto boxes bounded by maxWidth, exactly the shape that then
             * collapses to min-content and renders a message one word per line.
             * Windowing below already keeps the mounted set small; this only
             * added a layout bug on top.
             */
            removeClippedSubviews={false}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={7}
          />

          {/*
            KeyboardStickyView, not padding and not KeyboardAvoidingView. The
            window does not resize for the keyboard under SDK 57's mandatory
            edge-to-edge, so anything that infers the lift from window geometry
            is guessing; this translates the bar using Android's real IME
            insets. `opened` adds breathing room so the box clears the top row
            of keys instead of resting flush against it.
          */}
          <KeyboardStickyView offset={{ closed: 0, opened: pad }}>
            <View
              style={[
                styles.composer,
                {
                  borderTopColor: colors.borderSubtle,
                  /**
                   * Opaque, and that is load-bearing. This bar had a top border
                   * but no fill, which looked fine at rest because the canvas
                   * behind it is the same colour — then the keyboard lifted it
                   * over the feed and the messages showed straight through the
                   * bar, leaving the border line hanging in mid-air with the
                   * input floating on top of the conversation.
                   */
                  backgroundColor: colors.canvas,
                  paddingHorizontal: pad,
                  paddingTop: pad,
                  paddingBottom: pad + bottomInset,
                },
              ]}
            >
              <View style={[styles.column, { width: columnWidth }]}>
                <Composer
                  token={token}
                  onAsk={ask}
                  onOptimistic={({ fileUuid, rawText, audioUrl, peaks }) =>
                    // Straight into the cache: the note shows in the feed the
                    // instant it is sent, and the socket's `voice-processed`
                    // fills in the summary on the same row.
                    queryClient.setQueryData<VoiceNote[]>(
                      queryKeys.notes,
                      (prev) => [
                        ...(prev ?? []),
                        {
                          fileUuid,
                          rawText,
                          audioUrl,
                          // Carried through so the waveform is correct on the
                          // first paint rather than popping in on refetch.
                          peaks,
                          status: 'pending',
                          summary: null,
                          createdAt: new Date().toISOString(),
                        },
                      ],
                    )
                  }
                />
              </View>
            </View>
          </KeyboardStickyView>
        </View>

        {/* The third column. Mounted only where there is genuinely room for
            it — at anything narrower the same information appears inline in
            the sidebar instead. */}
        {isWide && (
          <EntityDetailPane
            token={token}
            entityId={selectedEntity}
            onClose={() => setSelectedEntity(null)}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  shell: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
  feed: { paddingBottom: space.xxl },
  // Each row carries the centred column width; the list itself is full-bleed.
  feedRow: { alignSelf: 'center' },
  // Width comes from useLayout() in pixels. It used to be `width: '100%'` with
  // a percentage maxWidth further down the tree, which is what let the bubbles
  // collapse to one word per line on Android.
  column: { alignSelf: 'center', gap: space.xl },
  composer: { borderTopWidth: 1 },
});
