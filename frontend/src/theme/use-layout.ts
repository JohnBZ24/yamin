import { useWindowDimensions } from 'react-native';

import {
  BREAKPOINT_DESKTOP,
  BREAKPOINT_WIDE,
  DETAIL_WIDTH,
  SIDEBAR_WIDTH,
  space,
} from './tokens';

/**
 * compact  — phone. The sidebar is an overlay drawer; one column.
 * medium   — the sidebar becomes permanent layout beside the conversation.
 * expanded — wide enough for a third column, so a selected entity opens next
 *            to the feed instead of displacing it.
 */
export type LayoutTier = 'compact' | 'medium' | 'expanded';

/**
 * Every width in the conversation, in pixels, derived from the real viewport.
 *
 * The bubbles used to be sized with percentage `maxWidth` ('85%', '92%') inside
 * a `flexDirection: 'row'` wrapper. That works on the web but is fragile in
 * Yoga: a percentage resolves against the parent's *definite* width, and when
 * the parent width is momentarily indefinite the constraint collapses to
 * min-content — which on a phone rendered messages one word per line, stacked
 * vertically. Pixels cannot collapse, so they are what ships.
 *
 * Sizing here also means the layout genuinely tracks the screen instead of
 * assuming a desktop: a narrow phone gets tighter gutters and wider bubbles,
 * which is most of the usable width back.
 */
export function useLayout() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINT_DESKTOP;
  const isWide = width >= BREAKPOINT_WIDE;
  // Below this a 16px gutter on each side is a meaningful slice of the screen.
  const isNarrow = width < 480;

  const tier: LayoutTier = isWide ? 'expanded' : isDesktop ? 'medium' : 'compact';

  const pad = isNarrow ? space.md : space.lg;

  /**
   * What is left for the conversation once the fixed chrome is taken out.
   *
   * This used to measure against the whole viewport, which was wrong the moment
   * the sidebar became permanent: at 1000px the feed was told it had 720px to
   * work with while its container was only 700px wide, so rows overhung their
   * column. It went unnoticed because it only misbehaves between 900 and about
   * 1050 — a half-width window on a laptop, and nobody's default.
   */
  const chrome = (isDesktop ? SIDEBAR_WIDTH : 0) + (isWide ? DETAIL_WIDTH : 0);
  // maxWidth keeps text at a readable measure regardless of monitor size.
  const columnWidth = Math.max(240, Math.min(width - chrome - pad * 2, 720));

  return {
    tier,
    isDesktop,
    isWide,
    isNarrow,
    /** Horizontal gutter for the feed and composer. */
    pad,
    /** Width of the centred conversation column. */
    columnWidth,
    /** The user's own bubbles — theirs sit slightly narrower than Yamin's. */
    mineMax: Math.round(columnWidth * (isNarrow ? 0.92 : 0.85)),
    /** Yamin's bubbles, which carry summaries and Markdown and need the room. */
    theirsMax: Math.round(columnWidth * (isNarrow ? 0.98 : 0.92)),
    /** The mobile memory drawer. A fixed 300 overhangs a small phone. */
    drawerWidth: Math.min(320, Math.round(width * 0.86)),
  };
}
