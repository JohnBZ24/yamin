import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import type { Reminder } from './api';

/**
 * Mirroring Yamin's reminders onto the device calendar.
 *
 * Why the device calendar and not the Google Calendar API: on Android the system
 * calendar provider is already synced to whatever accounts are signed in, so an
 * event written here lands in the user's real Google Calendar within about a
 * minute — with no OAuth consent screen, no client secret, no per-user refresh
 * tokens on the server, and crucially no Google app-verification review, which
 * Calendar's sensitive scope would otherwise require before anyone but test
 * users could grant it.
 *
 * The trade-off, stated plainly: this only runs on the device that created the
 * reminder, and only while the app is open. A reminder the user just spoke is
 * exactly that case. Server-side sync for reminders created elsewhere would need
 * the real API.
 */

/** How long a mirrored reminder occupies in the calendar. It is a point in time, not a meeting. */
const EVENT_DURATION_MS = 15 * 60 * 1000;

/**
 * Marks events as ours, so a re-sync can recognise what it already wrote instead
 * of creating duplicates every time the reminder list is refetched.
 */
const SIGNATURE = 'Added by Yamin';

function notesFor(reminder: Reminder): string {
  return `${SIGNATURE} · reminder #${reminder.id}`;
}

/**
 * Ask for calendar access. Returns false rather than throwing when refused —
 * declining must never break saving the note itself.
 */
export async function ensureCalendarAccess(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { granted } = await Calendar.requestCalendarPermissions();
    return granted;
  } catch {
    return false;
  }
}

/**
 * The calendar to write into.
 *
 * Android has no single "default" calendar, so pick the primary writable one —
 * which on a phone with a Google account signed in is that account's calendar,
 * i.e. the one that syncs. Falls back to any writable calendar so a device with
 * an unusual setup still works, and returns null rather than inventing one.
 */
async function writableCalendar(): Promise<Calendar.ExpoCalendar | null> {
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const writable = calendars.filter((c) => c.allowsModifications);
  return writable.find((c) => c.isPrimary) ?? writable[0] ?? null;
}

/**
 * Put one reminder on the calendar. Returns the event id, or null if it could not
 * be written for any reason.
 *
 * Deliberately best-effort throughout: a calendar mirror is a convenience on top
 * of a reminder that already works via push and socket, so nothing here is
 * allowed to surface as a failure to the user.
 */
export async function addReminderToCalendar(
  reminder: Reminder,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    const startDate = new Date(reminder.scheduledFor);
    if (Number.isNaN(startDate.getTime())) return null;

    const calendar = await writableCalendar();
    if (!calendar) return null;

    const event = await calendar.createEvent({
      title: reminder.title,
      startDate,
      endDate: new Date(startDate.getTime() + EVENT_DURATION_MS),
      // The server stores the zone it resolved the spoken time against; reusing
      // it means "remind me at 5" lands at 5 in the zone the user meant, not the
      // one their phone happens to be in now.
      timeZone: reminder.timezone ?? undefined,
      notes: notesFor(reminder),
      // A notification at the moment it is due, so the calendar entry is useful
      // on its own rather than only being a record.
      alarms: [{ relativeOffset: 0 }],
    });

    return event.id;
  } catch {
    return null;
  }
}

/**
 * Mirror any scheduled reminders that are not on the calendar yet.
 *
 * Existing events are matched by our own signature in `notes` within the window
 * the reminder falls in, which is what keeps a refetch from writing the same
 * reminder twice. Only future reminders are mirrored — back-filling history into
 * someone's calendar would be presumptuous and noisy.
 */
export async function syncRemindersToCalendar(
  reminders: Reminder[],
): Promise<number> {
  if (Platform.OS === 'web') return 0;

  const upcoming = reminders.filter(
    (r) => r.status === 'scheduled' && new Date(r.scheduledFor) > new Date(),
  );
  if (upcoming.length === 0) return 0;

  try {
    const calendar = await writableCalendar();
    if (!calendar) return 0;

    // One read across the whole span, rather than a query per reminder.
    const times = upcoming.map((r) => new Date(r.scheduledFor).getTime());
    const existing = await calendar.listEvents(
      new Date(Math.min(...times) - EVENT_DURATION_MS),
      new Date(Math.max(...times) + EVENT_DURATION_MS),
    );
    const alreadyThere = new Set(
      existing
        .map((e) => e.notes ?? '')
        .filter((n) => n.includes(SIGNATURE)),
    );

    let written = 0;
    for (const reminder of upcoming) {
      if (alreadyThere.has(notesFor(reminder))) continue;
      if (await addReminderToCalendar(reminder)) written += 1;
    }
    return written;
  } catch {
    return 0;
  }
}
