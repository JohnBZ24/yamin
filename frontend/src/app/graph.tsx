import { Feather } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { KnowledgeGraph } from '../components/knowledge-graph';
import { api } from '../lib/api';
import { useSession } from '../hooks/use-session';
import { radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/**
 * Full-screen map of what Yamin knows. A drawer-width graph is a postage
 * stamp; this view gives the force layout the whole display, with a detail
 * panel for whichever entity is tapped.
 */
export default function GraphScreen() {
  const { colors } = useTokens();
  const router = useRouter();
  const { ready, token } = useSession();
  const { width, height } = useWindowDimensions();
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.entity>> | null>(
    null,
  );

  useEffect(() => {
    if (!token || selected == null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api
      .entity(token, selected)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, selected]);

  if (!ready) return null;
  if (!token) return <Redirect href="/" />;

  const graphHeight = height - 64 - (selected ? 220 : 0);

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
        <Text style={[type.title, { color: colors.text }]}>What Yamin knows</Text>
        <View style={{ width: 20 }} />
      </View>

      <View style={{ flex: 1 }}>
        <KnowledgeGraph
          token={token}
          width={width}
          height={graphHeight}
          selectedId={selected}
          onSelect={setSelected}
        />
      </View>

      {selected != null && detail && (
        <Animated.View
          entering={FadeInDown.springify().damping(20)}
          style={[
            styles.panel,
            { backgroundColor: colors.surface, borderTopColor: colors.borderSubtle },
          ]}
        >
          <View style={styles.panelHead}>
            <View style={{ flex: 1 }}>
              <Text style={[type.heading, { color: colors.text }]} numberOfLines={1}>
                {detail.entity.name}
              </Text>
              <Text style={[type.mono, { color: colors.textSubtle }]}>
                {detail.entity.type} · mentioned in {detail.entity.mentionCount} note
                {detail.entity.mentionCount === 1 ? '' : 's'}
              </Text>
            </View>
            <Pressable
              onPress={() => setSelected(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close details"
            >
              <Feather name="x" size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.facts}>
            {detail.entity.description ? (
              <Text style={[type.small, { color: colors.textMuted }]}>
                {detail.entity.description}
              </Text>
            ) : null}
            {detail.facts.length === 0 ? (
              <Text style={[type.small, { color: colors.textSubtle }]}>
                No connections yet.
              </Text>
            ) : (
              detail.facts.map((f) => (
                <Text
                  key={`${f.type}-${f.direction}-${f.otherNodeName}`}
                  style={[type.small, { color: colors.textMuted }]}
                >
                  {f.direction === 'outgoing' ? '→ ' : '← '}
                  <Text style={{ color: colors.text }}>
                    {f.type.replace(/_/g, ' ').toLowerCase()}
                  </Text>{' '}
                  {f.otherNodeName}
                </Text>
              ))
            )}
          </ScrollView>
        </Animated.View>
      )}
    </SafeAreaView>
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
  panel: {
    borderTopWidth: 1,
    padding: space.lg,
    maxHeight: 220,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.sm,
  },
  facts: { gap: space.xs },
});
