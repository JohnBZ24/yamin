import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/** The feed's top bar: the wordmark, the drawer button on mobile, and connection state. */
export function ScreenHeader({
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
      <View style={styles.left}>
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

      <View style={styles.right}>
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

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
