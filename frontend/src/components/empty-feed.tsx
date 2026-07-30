import { Feather } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/** What shows before there is any history — the feed itself is a FlatList. */
export function EmptyFeed() {
  const { colors } = useTokens();

  return (
    <Animated.View entering={FadeIn} style={styles.empty}>
      <Feather name="mic" size={26} color={colors.textSubtle} />
      <Text style={[type.heading, { color: colors.text }]}>
        Nothing remembered yet
      </Text>
      <Text style={[type.small, styles.blurb, { color: colors.textSubtle }]}>
        Hold the mic or type below. Yamin keeps what matters and answers when
        you ask.
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxxl },
  blurb: { textAlign: 'center' },
});
