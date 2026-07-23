import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, SlideInLeft } from 'react-native-reanimated';
import io, { Socket } from 'socket.io-client';

import { AnswerCard, AnswerEntry } from '../components/answer-card';
import { Composer } from '../components/composer';
import { MemorySidebar } from '../components/memory-sidebar';
import { NoteCard } from '../components/note-card';
import { useToast } from '../components/toast';
import { api, API_URL, VoiceNote } from '../lib/api';
import {
  NotifyStatus,
  notifyStatus,
  notifyStatusMessage,
  requestNotificationPermission,
  showNotification,
} from '../lib/notify';
import { registerForPush } from '../lib/push';
import { randomUuid } from '../lib/uuid';
import { BREAKPOINT_DESKTOP, radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

type FeedItem =
  | { kind: 'note'; key: string; at: string; note: VoiceNote }
  | { kind: 'answer'; key: string; at: string; answer: AnswerEntry };

export default function YaminScreen() {
  const { colors } = useTokens();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT_DESKTOP;

  const [token, setToken] = useState<string | null>(null);
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [online, setOnline] = useState(false);
  const [notifState, setNotifState] = useState<NotifyStatus>('unsupported');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [graphVersion, setGraphVersion] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const feedRef = useRef<ScrollView>(null);

  /**
   * Asking is a turn in the feed, not a separate panel: the question appears
   * immediately with a spinner and is filled in when the answer lands, so it
   * behaves like every other message here.
   */
  const ask = async (question: string) => {
    if (!token) return;
    const id = randomUuid();
    setAnswers((prev) => [
      ...prev,
      { id, question, createdAt: new Date().toISOString(), result: null },
    ]);
    try {
      const result = await api.ask(token, question);
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

  const deleteNote = async (fileUuid: string) => {
    if (!token) return;
    try {
      await api.deleteNote(token, fileUuid);
      setNotes((prev) => prev.filter((n) => n.fileUuid !== fileUuid));
      // The note's mentions were detached server-side; the sidebar counts
      // are stale until re-fetched.
      setGraphVersion((v) => v + 1);
      toast('Note deleted', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Could not delete that note', 'error');
    }
  };

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

  useEffect(() => {
    if (!token) return;

    api
      .history(token)
      .then(setNotes)
      .catch((e) => toast(e.message ?? 'Could not load your notes', 'error'));

    const socket = io(API_URL, {
      auth: { token: `Bearer ${token}` },
      transports: ['websocket'],
    });

    socket.on('connect', () => setOnline(true));
    socket.on('disconnect', () => setOnline(false));

    socket.on('voice-processed', (data: any) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.fileUuid === data.fileUuid
            ? { ...n, status: 'processed', summary: data.summary, nodes: data.nodes }
            : n,
        ),
      );
      // The worker just wrote new entities; pull the graph again.
      setGraphVersion((v) => v + 1);
    });

    socket.on('voice-failed', (data: any) => {
      setNotes((prev) =>
        prev.map((n) => (n.fileUuid === data.fileUuid ? { ...n, status: 'failed' } : n)),
      );
      toast(data.error ?? 'That note could not be processed', 'error');
    });

    socket.on('reminder-alert', (data: any) => {
      // The OS notification is the one that actually reaches you when the tab
      // is in the background. The toast is the in-tab fallback for when
      // permission was refused or the origin isn't secure — and it is sticky,
      // because a reminder that fades after 4.5s is a reminder you miss.
      const shown = showNotification('Yamin reminder', data.title);
      if (!shown) {
        toast(`⏰ Reminder: ${data.title}`, 'success', { sticky: true });
      }
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
    };
  }, [token, toast]);

  if (!token) {
    return <LoginScreen onToken={setToken} />;
  }

  const showSidebar = isDesktop || sidebarOpen;

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
    <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]}>
      <View style={styles.shell}>
        <Sidebar
          isDesktop={isDesktop}
          showSidebar={showSidebar}
          sidebarOpen={sidebarOpen}
          token={token}
          graphVersion={graphVersion}
          onCloseMobile={() => setSidebarOpen(false)}
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

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              ref={feedRef}
              style={{ flex: 1 }}
              contentContainerStyle={styles.feed}
              onContentSizeChange={() =>
                feedRef.current?.scrollToEnd({ animated: true })
              }
            >
              {/* Centre column: long lines are unreadable on a wide monitor. */}
              <View style={styles.column}>
                <Feed items={feedItems} onDeleteNote={deleteNote} />
              </View>
            </ScrollView>

            <View style={[styles.composer, { borderTopColor: colors.borderSubtle }]}>
              <View style={styles.column}>
                <Composer
                  token={token}
                  onAsk={ask}
                  showSuggestions={answers.length === 0}
                  onOptimistic={({ fileUuid, rawText, audioUrl }) =>
                    setNotes((prev) => [
                      ...prev,
                      {
                        fileUuid,
                        rawText,
                        audioUrl,
                        status: 'pending',
                        summary: null,
                        createdAt: new Date().toISOString(),
                      },
                    ])
                  }
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Sidebar({
  isDesktop,
  showSidebar,
  sidebarOpen,
  token,
  graphVersion,
  onCloseMobile,
}: {
  isDesktop: boolean;
  showSidebar: boolean;
  sidebarOpen: boolean;
  token: string;
  graphVersion: number;
  onCloseMobile: () => void;
}) {
  const { colors } = useTokens();

  return (
    <>
      {isDesktop && showSidebar && (
        <View
          style={[
            styles.sidebarDesktop,
            {
              backgroundColor: colors.surface,
              borderRightColor: colors.borderSubtle,
            },
          ]}
        >
          <MemorySidebar token={token} refreshKey={graphVersion} />
        </View>
      )}

      {!isDesktop && sidebarOpen && (
        <Pressable
          style={[styles.overlay, { backgroundColor: colors.overlay }]}
          onPress={onCloseMobile}
        >
          <Animated.View
            entering={SlideInLeft.springify().damping(22)}
            style={[styles.sidebarMobile, { backgroundColor: colors.canvas }]}
          >
            {/* Swallows taps so touching the drawer doesn't close it. */}
            <Pressable style={{ flex: 1 }} onPress={() => {}}>
              <MemorySidebar
                token={token}
                refreshKey={graphVersion}
                onClose={onCloseMobile}
              />
            </Pressable>
          </Animated.View>
        </Pressable>
      )}
    </>
  );
}

function ScreenHeader({
  isDesktop,
  online,
  onOpenSidebar,
  onTestNotification,
}: {
  isDesktop: boolean;
  online: boolean;
  onOpenSidebar: () => void;
  onTestNotification: () => void;
}) {
  const { colors } = useTokens();

  return (
    <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
      <View style={styles.headerLeft}>
        {!isDesktop && (
          <Pressable onPress={onOpenSidebar} hitSlop={10}>
            <Feather name="menu" size={20} color={colors.text} />
          </Pressable>
        )}
        <Text style={[type.title, { color: colors.text }]}>Yamin</Text>
      </View>

      <View style={styles.headerRight}>
        {/* Fires a notification right now. Waiting on a real reminder to
            find out whether notifications work is a slow, ambiguous test
            — this answers it immediately, and says WHY when it can't. */}
        {Platform.OS === 'web' && (
          <Pressable
            onPress={onTestNotification}
            hitSlop={8}
            style={[styles.status, { backgroundColor: colors.surfaceSunken }]}
          >
            <Feather name="bell" size={12} color={colors.textMuted} />
            <Text style={[type.mono, { color: colors.textMuted }]}>Test</Text>
          </Pressable>
        )}

        <View style={[styles.status, { backgroundColor: colors.surfaceSunken }]}>
          <View
            style={[
              styles.dot,
              { backgroundColor: online ? colors.successText : colors.textSubtle },
            ]}
          />
          <Text style={[type.mono, { color: colors.textMuted }]}>
            {online ? 'Listening' : 'Offline'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function NotificationBanner({
  message,
  canEnable,
  onEnable,
}: {
  message: string | null | undefined;
  canEnable: boolean;
  onEnable: () => void;
}) {
  const { colors } = useTokens();

  if (!message) return null;

  return (
    <View
      style={[
        styles.notifBanner,
        {
          backgroundColor: colors.warningSurface,
          borderBottomColor: colors.borderSubtle,
        },
      ]}
    >
      <Feather name="bell-off" size={13} color={colors.warningText} />
      <Text style={[type.small, { color: colors.warningText, flex: 1 }]}>
        {message}
      </Text>
      {canEnable && (
        <Pressable
          onPress={onEnable}
          style={[styles.notifBtn, { backgroundColor: colors.brand }]}
        >
          <Text style={[type.label, { color: colors.onBrand }]}>Enable</Text>
        </Pressable>
      )}
    </View>
  );
}

function Feed({
  items,
  onDeleteNote,
}: {
  items: FeedItem[];
  onDeleteNote: (fileUuid: string) => Promise<void>;
}) {
  const { colors } = useTokens();

  if (items.length === 0) {
    return (
      <Animated.View entering={FadeIn} style={styles.empty}>
        <Feather name="mic" size={26} color={colors.textSubtle} />
        <Text style={[type.heading, { color: colors.text }]}>
          Nothing remembered yet
        </Text>
        <Text
          style={[type.small, { color: colors.textSubtle, textAlign: 'center' }]}
        >
          Hold the mic or type below. Yamin keeps what matters and answers when
          you ask.
        </Text>
      </Animated.View>
    );
  }

  return (
    <>
      {items.map((item, i) =>
        item.kind === 'note' ? (
          <NoteCard
            key={item.key}
            note={item.note}
            index={i}
            onDelete={() => onDeleteNote(item.note.fileUuid)}
          />
        ) : (
          <AnswerCard key={item.key} entry={item.answer} index={i} />
        ),
      )}
    </>
  );
}

function LoginScreen({ onToken }: { onToken: (t: string) => void }) {
  const { colors } = useTokens();
  const toast = useToast();
  // Deliberately empty. The old build shipped a real, working password in the
  // bundle, readable by anyone who downloaded the app.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast('Enter your email and password', 'error');
      return;
    }
    setBusy(true);
    try {
      const { token } = await api.login(email.trim(), password);
      // Asked here because this press is a user gesture — browsers reject (or
      // auto-deny) a permission prompt fired on page load. Deliberately not
      // awaited-on for correctness: refusing must not block sign-in.
      void requestNotificationPermission();
      onToken(token);
    } catch (err: any) {
      toast(err.message ?? 'Could not sign in', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.root, styles.center, { backgroundColor: colors.canvas }]}
    >
      <Animated.View entering={FadeIn} style={styles.loginWrap}>
        <View style={[styles.mark, { backgroundColor: colors.brand }]}>
          <Feather name="zap" size={22} color={colors.onBrand} />
        </View>

        <Text style={[type.display, { color: colors.text }]}>Yamin</Text>
        <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>
          Your right hand. Tell it anything — it remembers, and answers.
        </Text>

        <View style={styles.form}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            style={[
              styles.field,
              type.body,
              {
                color: colors.text,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
            {...({ outlineStyle: 'none' } as object)}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            placeholder="Password"
            placeholderTextColor={colors.textSubtle}
            secureTextEntry
            autoComplete="current-password"
            style={[
              styles.field,
              type.body,
              {
                color: colors.text,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
            {...({ outlineStyle: 'none' } as object)}
          />

          <Pressable
            onPress={submit}
            disabled={busy}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: colors.brand, opacity: pressed || busy ? 0.85 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <Text style={[type.bodyMedium, { color: colors.onBrand }]}>Sign in</Text>
            )}
          </Pressable>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  shell: { flex: 1, flexDirection: 'row' },
  sidebarDesktop: { width: 300, borderRightWidth: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  sidebarMobile: { width: 300, height: '100%' },
  main: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  notifBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
  },
  notifBtn: {
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  feed: { padding: space.lg, paddingBottom: space.xxl },
  // maxWidth keeps text at a readable measure regardless of monitor size.
  column: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: space.xl },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxxl },
  composer: { padding: space.lg, borderTopWidth: 1 },
  loginWrap: {
    width: '100%',
    maxWidth: 380,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    gap: space.md,
  },
  mark: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  form: { width: '100%', gap: space.md, marginTop: space.xl },
  field: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 48,
  },
  cta: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: space.xs,
  },
});
