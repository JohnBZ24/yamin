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
 * The next reminder the user actually cares about.
 *
 * Filters on `status` rather than trusting position — the endpoint orders
 * upcoming-first, but relying on that silently breaks if the ordering ever
 * changes. Past-due `scheduled` reminders are deliberately kept: one the worker
 * has not fired yet is still the next thing coming, and hiding it would make the
 * widget look empty exactly when the backend is lagging.
 */
export function pickNext(reminders: Reminder[]): Reminder | null {
  return (
    [...reminders]
      .filter((r) => r.status === 'scheduled')
      .sort(
        (a, b) =>
          new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime(),
      )[0] ?? null
  );
}
