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
    <Pressable
      style={[styles.overlay, { backgroundColor: colors.overlay }]}
      onPress={onCloseMobile}
    >
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
        {/* Swallows taps so touching the drawer doesn't close it. */}
        <Pressable style={styles.fill} onPress={() => {}}>
          <MemorySidebar
            token={token}
            onClose={onCloseMobile}
            onSignOut={onSignOut}
          />
        </Pressable>
      </View>
    </Pressable>
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
  mobile: { height: '100%' },
  fill: { flex: 1 },
});
