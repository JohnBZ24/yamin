import React, { createContext, useContext, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

type ToastKind = 'info' | 'success' | 'error';
type ToastOptions = {
  /**
   * Stay until dismissed. A reminder is the one message here the user asked to
   * receive at a moment when they are, by definition, doing something else —
   * auto-hiding it after a few seconds is how a reminder gets missed entirely.
   */
  sticky?: boolean;
};
type Toast = { id: number; message: string; kind: ToastKind; sticky?: boolean };

const ToastContext = createContext<
  (message: string, kind?: ToastKind, options?: ToastOptions) => void
>(() => {});

/**
 * Replaces Alert.alert, which is a **no-op in react-native-web** — on the web
 * build every one of the app's error alerts was silently swallowed, so a failed
 * login or upload looked like nothing happening at all.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { colors } = useTokens();

  const dismiss = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const show = (message: string, kind: ToastKind = 'info', options?: ToastOptions) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind, sticky: options?.sticky }]);
    if (!options?.sticky) {
      setTimeout(() => dismiss(id), 4500);
    }
  };

  const tone = (kind: ToastKind) =>
    kind === 'error'
      ? { bg: colors.dangerSurface, fg: colors.dangerText }
      : kind === 'success'
        ? { bg: colors.successSurface, fg: colors.successText }
        : { bg: colors.brandSurface, fg: colors.brandText };

  return (
    <ToastContext.Provider value={show}>
      {children}
      <View style={styles.host} pointerEvents="box-none">
        {toasts.map((t) => {
          const { bg, fg } = tone(t.kind);
          return (
            <Animated.View
              key={t.id}
              entering={FadeInDown.springify().damping(18)}
              exiting={FadeOutUp.duration(150)}
            >
              <Pressable
                onPress={() => dismiss(t.id)}
                style={[
                  styles.toast,
                  { backgroundColor: bg, borderColor: colors.borderSubtle },
                ]}
              >
                <Text style={[type.smallMedium, { color: fg }]}>{t.message}</Text>
                {t.sticky && (
                  <Text style={[type.mono, { color: fg, opacity: 0.7 }]}>
                    tap to dismiss
                  </Text>
                )}
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: space.lg,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: space.sm,
    zIndex: 10000,
  },
  toast: {
    maxWidth: 460,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
