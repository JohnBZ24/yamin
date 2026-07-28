import { useWindowDimensions } from 'react-native';

import { BREAKPOINT_DESKTOP, space } from './tokens';

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
  // Below this a 16px gutter on each side is a meaningful slice of the screen.
  const isNarrow = width < 480;

  const pad = isNarrow ? space.md : space.lg;
  // maxWidth keeps text at a readable measure regardless of monitor size.
  const columnWidth = Math.max(240, Math.min(width - pad * 2, 720));

  return {
    isDesktop,
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
