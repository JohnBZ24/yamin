import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/**
 * Says why reminders will not arrive, and offers the fix when there is one.
 *
 * Renders nothing when there is nothing to say — a permanently-present banner
 * about a permission that is already granted is just chrome.
 */
export function NotificationBanner({
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
        styles.banner,
        {
          backgroundColor: colors.warningSurface,
          borderBottomColor: colors.borderSubtle,
        },
      ]}
    >
      <Feather name="bell-off" size={13} color={colors.warningText} />
      <Text style={[type.small, styles.message, { color: colors.warningText }]}>
        {message}
      </Text>
      {canEnable && (
        <Pressable
          onPress={onEnable}
          style={[styles.button, { backgroundColor: colors.brand }]}
        >
          <Text style={[type.label, { color: colors.onBrand }]}>Enable</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
  },
  message: { flex: 1 },
  button: {
    paddingHorizontal: space.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
});
