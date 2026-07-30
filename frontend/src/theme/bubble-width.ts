import { space } from './tokens';

/**
 * A DEFINITE pixel width for a chat bubble, estimated from its own text.
 *
 * Why estimate at all, instead of the obvious `maxWidth` + hug-the-content?
 *
 * Because a `maxWidth` bubble has an AUTO width, which means its real width is
 * whatever its parent says is available. That makes the bubble a faithful
 * amplifier of any bad number handed down to it — and it does not degrade
 * gracefully. Measured against the real Yoga engine, one 2-line message in a
 * 309px-max bubble renders as:
 *
 *     parent width 336 -> bubble 309, 2 lines   (correct)
 *     parent width 120 -> bubble 120, 5 lines
 *     parent width  40 -> bubble  40, 52 lines  <- one character per line
 *     parent width   0 -> bubble  32, 7 lines
 *
 * That 52-line case is the "messages render vertically" bug, and the bubble
 * styles were never the cause: they were reporting a parent width of ~40px
 * accurately. On Android that bad parent width has several sources (a
 * Reanimated entering animation on the box, a list row measured before window
 * dimensions settle, a detached subview), which is why fixing it one style at a
 * time kept missing.
 *
 * A definite width cannot be collapsed by any of them. The same test with an
 * explicit width returns 309px and 2 lines at every parent width above,
 * including zero. The cost is that the width is an estimate rather than a true
 * text measure, so a bubble can be a few pixels loose or wrap one word early —
 * both invisible next to the bug it removes.
 *
 * If a real measure is ever wanted here, the honest way is `onTextLayout` and a
 * second render pass; that trades a guaranteed-correct first paint for a
 * one-frame reflow on every message, which is the worse deal in a chat feed.
 */

/**
 * Mean advance width of Inter 400 as a fraction of font size, over lowercase
 * English prose. Deliberately a touch generous: overestimating pads a bubble
 * with a few pixels of dead space, while underestimating wraps a word onto a
 * new line, and dead space is the cheaper mistake.
 */
const AVG_ADVANCE = 0.55;

/** Bubble padding is inside the width — RN boxes are border-box. */
const PADDING = space.lg * 2;

export function bubbleWidth(
  text: string,
  max: number,
  {
    /**
     * Floor for the result. Bubbles are rarely just text: a footer row with a
     * timestamp and a delete button, or an audio player with fixed-width
     * waveform bars, has a real minimum that no amount of short text should
     * shrink below — those children do not wrap, they overflow.
     */
    min = 96,
    fontSize = 15,
  }: { min?: number; fontSize?: number } = {},
) {
  const advance = fontSize * AVG_ADVANCE;
  const oneLine = text.length * advance + PADDING;

  // A single unbreakable word sets its own floor: nothing can be narrower than
  // the longest thing in it without breaking mid-word.
  const words = text.split(/\s+/).filter(Boolean);
  const longestWord = words.length
    ? Math.max(...words.map((w) => w.length)) * advance + PADDING
    : 0;

  const floor = Math.min(max, Math.max(min, longestWord));
  return Math.round(Math.min(max, Math.max(floor, oneLine)));
}
