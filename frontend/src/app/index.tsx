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

import { AnswerCard, AnswerEntry } from '../components/answer-card';
import { Composer } from '../components/composer';
import { MemorySidebar } from '../components/memory-sidebar';
import { NoteCard } from '../components/note-card';
import { useToast } from '../components/toast';
import { useSession } from '../hooks/use-session';
import { api, VoiceNote } from '../lib/api';
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

  const { ready, token, signIn, signUp, signOut } = useSession();
  const { socket, online } = useRealtime();
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [notifState, setNotifState] = useState<NotifyStatus>('unsupported');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [graphVersion, setGraphVersion] = useState(0);
  const feedRef = useRef<ScrollView>(null);

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
  }, [token, toast]);

  // Feed-specific realtime events, on the app-wide socket owned by
  // RealtimeProvider (which also handles reminder alerts globally — a
  // reminder must reach the user on ANY screen, not just this one).
  useEffect(() => {
    if (!socket) return;

    const onProcessed = (data: any) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.fileUuid === data.fileUuid
            ? { ...n, status: 'processed', summary: data.summary, nodes: data.nodes }
            : n,
        ),
      );
      // The worker just wrote new entities; pull the graph again.
      setGraphVersion((v) => v + 1);
    };

    const onFailed = (data: any) => {
      setNotes((prev) =>
        prev.map((n) => (n.fileUuid === data.fileUuid ? { ...n, status: 'failed' } : n)),
      );
      toast(data.error ?? 'That note could not be processed', 'error');
    };

    socket.on('voice-processed', onProcessed);
    socket.on('voice-failed', onFailed);
    return () => {
      socket.off('voice-processed', onProcessed);
      socket.off('voice-failed', onFailed);
    };
  }, [socket, toast]);

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
          onSignOut={() => void signOut()}
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
  onSignOut,
}: {
  isDesktop: boolean;
  showSidebar: boolean;
  sidebarOpen: boolean;
  token: string;
  graphVersion: number;
  onCloseMobile: () => void;
  onSignOut: () => void;
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
          <MemorySidebar
            token={token}
            refreshKey={graphVersion}
            onSignOut={onSignOut}
          />
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
                onSignOut={onSignOut}
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
          <Pressable
            onPress={onOpenSidebar}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Open memory sidebar"
          >
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

/** Must match @MinLength(6) on AuthRegisterDto — the server rejects anything shorter. */
const MIN_PASSWORD_LENGTH = 6;

function LoginScreen({
  onSignIn,
  onSignUp,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (details: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => Promise<void>;
}) {
  const { colors } = useTokens();
  const toast = useToast();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  // Deliberately empty. The old build shipped a real, working password in the
  // bundle, readable by anyone who downloaded the app.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast('Enter your email and password', 'error');
      return;
    }
    if (mode === 'signup' && (!firstName.trim() || !lastName.trim())) {
      toast('Enter your first and last name', 'error');
      return;
    }
    // Mirrors the server's @MinLength(6). Checked here so a too-short password
    // is caught while the user is still looking at the field, instead of
    // costing a round trip to be told the same thing.
    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      toast(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'error');
      return;
    }
    setBusy(true);
    try {
      // Asked here because this press is a user gesture — browsers reject (or
      // auto-deny) a permission prompt fired on page load. Deliberately not
      // awaited-on for correctness: refusing must not block sign-in.
      void requestNotificationPermission();
      if (mode === 'signup') {
        await onSignUp({
          email: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
      } else {
        await onSignIn(email.trim(), password);
      }
    } catch (err: any) {
      toast(
        err.message ??
          (mode === 'signup' ? 'Could not create your account' : 'Could not sign in'),
        'error',
      );
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
          {mode === 'signup' && (
            <View style={styles.nameRow}>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={colors.textSubtle}
                autoComplete="given-name"
                accessibilityLabel="First name"
                style={[
                  styles.field,
                  styles.nameField,
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
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={colors.textSubtle}
                autoComplete="family-name"
                accessibilityLabel="Last name"
                style={[
                  styles.field,
                  styles.nameField,
                  type.body,
                  {
                    color: colors.text,
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                {...({ outlineStyle: 'none' } as object)}
              />
            </View>
          )}
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            accessibilityLabel="Email"
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
            // Signing up with autoComplete="current-password" makes password
            // managers offer an existing password instead of generating a new
            // one — and suppresses the save prompt for the account just made.
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            accessibilityLabel="Password"
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
          {mode === 'signup' && (
            <Text style={[type.small, { color: colors.textSubtle }]}>
              At least {MIN_PASSWORD_LENGTH} characters.
            </Text>
          )}

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
              <Text style={[type.bodyMedium, { color: colors.onBrand }]}>
                {mode === 'signup' ? 'Create account' : 'Sign in'}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
            accessibilityRole="button"
            style={styles.switchMode}
          >
            <Text style={[type.small, { color: colors.textMuted }]}>
              {mode === 'signup'
                ? 'Already have an account? '
                : "Don't have an account? "}
              <Text style={[type.smallMedium, { color: colors.text }]}>
                {mode === 'signup' ? 'Sign in' : 'Create one'}
              </Text>
            </Text>
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
  nameRow: { flexDirection: 'row', gap: space.md },
  // minWidth:0 is load-bearing on web. RN-Web renders TextInput as <input>,
  // which carries an intrinsic width of ~177px, and a flex item's default
  // `min-width: auto` refuses to shrink below that. Two of them plus the gap
  // came to 366px inside a 332px column, so the name row visibly overhung the
  // email and password fields below it — the misalignment, not a spacing bug.
  nameField: { flex: 1, minWidth: 0 },
  switchMode: { alignSelf: 'center', paddingVertical: space.sm },
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
