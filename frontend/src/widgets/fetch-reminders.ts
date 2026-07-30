import { API_URL, type Reminder } from '../lib/api';

/**
 * The widget's own reminders fetch. Deliberately NOT `api.reminders()`.
 *
 * `api.ts`'s `request()` refreshes on a 401, and `refreshAccessToken()` writes a
 * NEW refresh token to SecureStore — the server rotates it. The widget runs in a
 * separate JS context from the app, and its access token is usually stale
 * precisely because the app has been closed, so a 401 here is the normal case,
 * not an edge case.
 *
 * If the widget refreshed, the live app would still be holding the old refresh
 * token in memory. Its next refresh would present a rotated-away token, fail,
 * and `refreshAccessToken()` would call `setSession(null)` — signing the user
 * out of the app because their home screen ticked over. That is the worst
 * failure this widget could cause, and it would look like a random logout.
 *
 * So this reads only. A 401 means "keep showing what we had", never "mutate the
 * session". Host and response shape are still taken from api.ts so there is one
 * source of truth for both.
 */
export async function fetchRemindersForWidget(
  token: string,
  limit = 5,
): Promise<Reminder[] | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/memory/reminders?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    // 401 included: the widget has no business recovering from it.
    if (!res.ok) return null;
    const body = await res.json();
    // Same `{ status, data }` envelope api.ts unwraps.
    return (body?.data ?? body) as Reminder[];
  } catch {
    return null; // offline
  }
}

/**
 * How far past its time a `scheduled` reminder is still treated as imminent.
 *
 * A little slack is right: the worker fires within a minute, and a reminder due
 * thirty seconds ago is genuinely the next thing coming. Beyond this it is
 * stuck, not imminent — the job was lost, or the worker was down when it came
 * due — and it must not be allowed to sit at the front of the queue forever.
 */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * The next reminder the user actually cares about.
 *
 * Filters on `status` rather than trusting position — the endpoint orders
 * upcoming-first, but relying on that silently breaks if the ordering ever
 * changes.
 *
 * Reminders can now be scheduled months out (a birthday, say), which makes the
 * stale case matter in a way it did not when everything was minutes away: a
 * single `scheduled` row that never fired sorts ahead of every real reminder and
 * would show "now" on the home screen indefinitely, hiding the one the user is
 * actually waiting for. Recently-due reminders are still kept — that is the
 * backend-lagging case, where showing it is correct.
 */
export function pickNext(reminders: Reminder[], now: Date = new Date()): Reminder | null {
  const cutoff = now.getTime() - STALE_AFTER_MS;
  return (
    [...reminders]
      .filter(
        (r) =>
          r.status === 'scheduled' &&
          new Date(r.scheduledFor).getTime() >= cutoff,
      )
      .sort(
        (a, b) =>
          new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime(),
      )[0] ?? null
  );
}
