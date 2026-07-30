import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MemorySidebar } from './memory-sidebar';
import { SIDEBAR_WIDTH } from '../theme/tokens';
import { useTokens } from '../theme/use-tokens';

/**
 * Where the memory sidebar lives, which is a different thing on each size.
 *
 * On a desktop it is layout: a permanent column the feed sits beside. On a
 * phone it is an overlay the user summons and dismisses. Those are two
 * behaviours, not one behaviour with a width — so they are two branches here
 * rather than one panel that gets narrower.
 *
 * This is the shell only; `memory-sidebar.tsx` is the contents, and does not
 * need to know which of the two it is currently inside.
 */
export function SidebarShell({
  isDesktop,
  open,
  drawerWidth,
  token,
  onCloseMobile,
  onSignOut,
  selectedEntity,
  onSelectEntity,
}: {
  isDesktop: boolean;
  /** Mobile only: whether the drawer is showing. Ignored on desktop, where the sidebar is always present. */
  open: boolean;
  drawerWidth: number;
  token: string;
  onCloseMobile: () => void;
  onSignOut: () => void;
  /** Set only on a wide screen, where a detail column owns the selection. */
  selectedEntity?: number | null;
  onSelectEntity?: (id: number | null) => void;
}) {
  const { colors } = useTokens();

  if (isDesktop) {
    return (
      <View
        style={[
          styles.desktop,
          {
            backgroundColor: colors.surface,
            borderRightColor: colors.borderSubtle,
          },
        ]}
      >
        <MemorySidebar
          token={token}
          onSignOut={onSignOut}
          selectedId={selectedEntity}
          onSelectEntity={onSelectEntity}
        />
      </View>
    );
  }

  if (!open) return null;

  return (
    /**
     * The scrim is a SIBLING of the drawer, not its parent.
     *
     * It used to wrap it, which meant every touch inside the drawer began inside
     * a Pressable — and the drawer then needed a second, inner Pressable with an
     * empty onPress to stop taps closing it. Two nested Pressables around a
     * scrolling list is a responder fight: a drag that started on a row which is
     * not itself pressable (a reminder) was claimed by the wrapper, so the list
     * would not scroll until you happened to start the drag on blank space.
     *
     * Side by side, the drawer has no pressable ancestor at all: the list gets
     * every gesture that starts inside it, and the scrim still catches taps
     * beside it because it fills the layer underneath.
     */
    <View style={styles.overlay}>
      <Pressable
        style={[styles.scrim, { backgroundColor: colors.overlay }]}
        onPress={onCloseMobile}
        accessibilityRole="button"
        accessibilityLabel="Close sidebar"
      />
      {/*
        No entering animation, deliberately. This was a spring
        (SlideInLeft.springify().damping(22)) that overshot and wobbled, and
        it ran while the drawer was mounting a FlatList and firing two API
        calls — so the bounce stuttered on top of looking wrong. Appearing
        instantly is both calmer and free.
      */}
      <View
        style={[
          styles.mobile,
          { width: drawerWidth, backgroundColor: colors.canvas },
        ]}
      >
        <MemorySidebar
          token={token}
          onClose={onCloseMobile}
          onSignOut={onSignOut}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // From the same token useLayout() subtracts when sizing the feed column, so
  // the two cannot drift apart and overlap.
  desktop: { width: SIDEBAR_WIDTH, borderRightWidth: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  // Fills the layer beneath the drawer. Declared first so the drawer, later in
  // the tree, paints on top of it.
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mobile: { height: '100%' },
});
