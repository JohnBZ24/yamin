/**
 * IANA-timezone wall-clock math, without a date library.
 *
 * Exists for one reason: a spoken reminder like "remind me at 2:43" is a
 * request in the user's local wall-clock time, but the reminder tool only
 * knew how to schedule a relative delay — and the model computing that delay
 * itself had no idea what time it currently was, in what timezone. It simply
 * declined to call the tool. This resolves "2:43" to a concrete UTC instant in
 * code, so the model never has to do clock arithmetic blind.
 */

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** IANA identifier if valid, else the given fallback — never throws. */
export function resolveTimezone(
  timeZone: string | undefined | null,
  fallback: string,
): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : fallback;
}

function partsOf(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const out: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  // formatToParts with hour12:false renders midnight as "24", which Date.UTC
  // would read as the 25th hour of the day.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Offset in minutes such that `utcInstant = wallClockInZone - offset`. */
function offsetMinutesAt(date: Date, timeZone: string): number {
  const p = partsOf(date, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * The next UTC instant at which the wall clock in `timeZone` reads
 * `hour:minute`. If that time has already passed today (with a small grace
 * window for the moment the request itself is being processed), rolls to the
 * same time tomorrow — "remind me at 2:43" said at 2:44 means tomorrow, not a
 * reminder that already elapsed.
 */
export function nextOccurrenceUtc(
  hour: number,
  minute: number,
  timeZone: string,
  now: Date = new Date(),
): Date {
  const todayInZone = partsOf(now, timeZone);

  // First pass: treat the target wall-clock as if it were UTC, then correct by
  // the zone's offset at that approximate instant. One correction is enough
  // for all real timezones — offsets don't shift by more than an hour, and a
  // DST boundary landing exactly on this reminder's target minute is not worth
  // a second iteration.
  const guessUtc = Date.UTC(
    todayInZone.year,
    todayInZone.month - 1,
    todayInZone.day,
    hour,
    minute,
    0,
  );
  const offset = offsetMinutesAt(new Date(guessUtc), timeZone);
  let targetUtc = guessUtc - offset * 60_000;

  const GRACE_MS = 30_000;
  if (targetUtc <= now.getTime() - GRACE_MS) {
    targetUtc += 24 * 60 * 60 * 1000;
  }

  return new Date(targetUtc);
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads `hour:minute` on
 * a specific calendar date.
 *
 * Needed because `nextOccurrenceUtc` can only ever reach today or tomorrow: it
 * takes a clock time and nothing else, so a reminder further out than 24 hours
 * was not expressible. "10 August is my birthday, remind me" therefore could not
 * be scheduled at all — the model had no parameter to put the date in, and fell
 * back to asking the user for a time it already had.
 *
 * @param date `YYYY-MM-DD`, read as a calendar date in `timeZone` (not UTC).
 */
export function occurrenceOnDateUtc(
  date: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`occurrenceOnDateUtc: expected YYYY-MM-DD, got "${date}"`);
  }
  const [, y, mo, d] = match.map(Number) as [unknown, number, number, number];

  // Same one-pass offset correction as nextOccurrenceUtc: treat the target wall
  // clock as UTC, then subtract the zone's offset at approximately that instant.
  const guessUtc = Date.UTC(y, mo - 1, d, hour, minute, 0);
  const offset = offsetMinutesAt(new Date(guessUtc), timeZone);
  return new Date(guessUtc - offset * 60_000);
}

/** Human-readable anchor for a prompt: "Tuesday 2026-07-21, 14:47 (Asia/Beirut)". */
export function describeNow(timeZone: string, now: Date = new Date()): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return `${formatted} (${timeZone})`;
}
