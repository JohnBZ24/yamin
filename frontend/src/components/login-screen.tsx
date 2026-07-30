import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
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
import Animated, { FadeIn } from 'react-native-reanimated';

import { useToast } from './toast';
import { useKeyboardInset } from '../hooks/use-keyboard-inset';
import { requestNotificationPermission } from '../lib/notify';
import { radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/** Must match @MinLength(6) on AuthRegisterDto — the server rejects anything shorter. */
const MIN_PASSWORD_LENGTH = 6;

export function LoginScreen({
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
  const { bottomInset } = useKeyboardInset();
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

  const fieldStyle = [
    styles.field,
    type.body,
    {
      color: colors.text,
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
  ];

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.canvas }]}
    >
      {/*
        Scrollable rather than a fixed centred block: with the keyboard up on a
        short phone the sign-up form is taller than what's left of the screen,
        and a centred View simply clips — the password field ends up below the
        keyboard with no way to reach it. flexGrow keeps it centred whenever it
        does fit, so nothing changes on a roomy screen.
      */}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: space.xl + bottomInset },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeIn} style={styles.wrap}>
          <View style={[styles.mark, { backgroundColor: colors.brand }]}>
            <Feather name="zap" size={22} color={colors.onBrand} />
          </View>

          <Text style={[type.display, { color: colors.text }]}>Yamin</Text>
          <Text style={[type.body, styles.tagline, { color: colors.textMuted }]}>
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
                  style={[fieldStyle, styles.nameField]}
                  {...({ outlineStyle: 'none' } as object)}
                />
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                  placeholderTextColor={colors.textSubtle}
                  autoComplete="family-name"
                  accessibilityLabel="Last name"
                  style={[fieldStyle, styles.nameField]}
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
              style={fieldStyle}
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
              style={fieldStyle}
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // flexGrow, not flex: the form stays vertically centred while it fits, and
  // becomes scrollable once the keyboard makes it taller than the viewport.
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  wrap: {
    width: '100%',
    maxWidth: 380,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    gap: space.md,
  },
  tagline: { textAlign: 'center' },
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
