/**
 * Shared tuning for the two recording surfaces — the feed composer and the chat
 * dictation button — so the mic behaves identically in both.
 */

/**
 * How often the recorder's status is polled, in ms. The default is 500, which
 * is fine for a duration counter and far too slow for a level meter — at two
 * samples a second the pulse reads as a blink rather than as your voice.
 */
export const METER_INTERVAL_MS = 100;

/**
 * Quietest level treated as silence, in dBFS. The scale runs from about -160
 * (digital silence) to 0 (clipping), but ordinary speech into a phone sits
 * around -30 to -10, so normalising against the full range would leave the
 * indicator almost motionless.
 */
export const SILENCE_DBFS = -50;

/** Loudest the recording pulse grows to. */
export const PEAK_SCALE = 1.6;
/** How far the resting button drifts. Small on purpose — a breath, not a throb. */
export const IDLE_SCALE = 1.03;

/**
 * Below this the recording is a container header with no usable frames — the
 * STT provider rejects it outright, so discard locally with a clear message
 * instead of a round-trip that can only fail.
 */
export const MIN_DURATION_MS = 400;

/** dBFS → 0..1, clamped. Undefined when metering is off or not yet reported. */
export function meterToLevel(db: number | undefined): number {
  if (db == null || !Number.isFinite(db)) return 0;
  const level = (db - SILENCE_DBFS) / -SILENCE_DBFS;
  return Math.max(0, Math.min(1, level));
}
