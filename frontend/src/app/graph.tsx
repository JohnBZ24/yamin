import { Feather } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { KnowledgeGraph } from '../components/knowledge-graph';
import { useEntityDetail } from '../lib/queries';
import { useSession } from '../hooks/use-session';
import { radius, space, type } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/** Matches styles.header's minHeight plus its border. */
const HEADER_HEIGHT = 57;

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
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<number | null>(null);
  // Shares a cache entry with the sidebar's expanded row, so tapping the same
  // entity in both places costs one request.
  const { data: detail } = useEntityDetail(token, selected);

  if (!ready) return null;
  if (!token) return <Redirect href="/" />;

  /**
   * Constant, and that is the point. This used to subtract the detail panel's
   * height when something was selected — which changed a prop the simulation
   * effect depends on, so every single tap tore down the layout and re-seeded
   * all 60 nodes on a ring. The panel now floats over the graph instead.
   */
  const graphHeight = height - HEADER_HEIGHT;

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
        // Not animated. The spring entrance ran at the same moment the SVG was
        // re-rendering the highlight, so the two competed for the JS thread and
        // the panel visibly stuttered on its way in. Appearing instantly is both
        // calmer and free.
        <View
          style={[
            styles.panel,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.borderSubtle,
              /**
               * Lifted clear of the system navigation area. The panel sat flush
               * against the bottom of the screen, so on a Samsung with gesture
               * navigation its lower rows — including the close button — landed
               * on the home-swipe strip and taps went to the OS instead.
               */
              paddingBottom: space.lg + insets.bottom,
              // Grows with the inset so the extra padding does not eat into the
              // facts list on a device with a tall gesture bar.
              maxHeight: 220 + insets.bottom,
            },
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
        </View>
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
  // Floats over the graph so selecting something never resizes the canvas.
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    // paddingBottom is supplied per-render from the safe-area inset.
    paddingTop: space.lg,
    paddingHorizontal: space.lg,
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
