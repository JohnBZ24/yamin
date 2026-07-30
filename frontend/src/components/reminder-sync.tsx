import { useEffect, useRef } from 'react';

import { useSession } from '../hooks/use-session';
import { ensureCalendarAccess, syncRemindersToCalendar } from '../lib/calendar';
import { useReminders } from '../lib/queries';
import { syncReminderWidget } from '../lib/widget';

/**
 * Mirrors Yamin's reminders outward, to the home-screen widget and the device
 * calendar. Renders nothing.
 *
 * Mounted once in the root layout rather than sprinkling calls at every mutation
 * site. It hangs off the same `queryKeys.reminders` key the sidebar already uses,
 * so it costs no extra request — and it inherits every existing invalidation for
 * free, including `invalidateAfterNoteProcessed()`, which is what fires after a
 * spoken note schedules a reminder.
 */
export function ReminderSync() {
  const { token } = useSession();
  const { data: reminders } = useReminders(token, 5);

  // Android widget. On other platforms syncReminderWidget is a no-op via the
  // widget.ts / widget.android.ts split.
  useEffect(() => {
    // No token: show the signed-out state, so signing out does not leave the
    // previous user's reminder sitting on the home screen.
    if (!token) {
      syncReminderWidget(null);
      return;
    }
    if (reminders) syncReminderWidget(reminders);
  }, [token, reminders]);

  /**
   * Calendar permission is asked for at most once per app run, and only when
   * there is genuinely something to write.
   *
   * Not on launch, deliberately: a permission prompt before the user has any
   * reminders is a prompt with no visible reason, and the usual answer to that is
   * no. Waiting until a reminder exists means the request arrives moments after
   * they asked Yamin to remind them, which is when it explains itself.
   */
  const askedForCalendar = useRef(false);

  useEffect(() => {
    if (!token || !reminders?.length) return;

    const hasUpcoming = reminders.some(
      (r) => r.status === 'scheduled' && new Date(r.scheduledFor) > new Date(),
    );
    if (!hasUpcoming) return;

    let cancelled = false;
    (async () => {
      if (!askedForCalendar.current) {
        askedForCalendar.current = true;
        // Refusing is a normal outcome, not an error: reminders already reach the
        // user by push and socket, so the calendar is an addition, never the
        // delivery mechanism.
        if (!(await ensureCalendarAccess())) return;
      }
      if (cancelled) return;
      await syncRemindersToCalendar(reminders);
    })();

    return () => {
      cancelled = true;
    };
  }, [token, reminders]);

  return null;
}
