import { requestWidgetUpdate } from 'react-native-android-widget';

import { pickNext } from '../widgets/fetch-reminders';
import { renderNextReminder } from '../widgets/next-reminder-widget';
import { WIDGET_NAME } from '../widgets/widget-name';
import type { Reminder } from './api';

/**
 * Push fresh reminder data to the home screen from the running app.
 *
 * Android will not deliver a periodic widget update more than once every 30
 * minutes, so this is what makes the widget feel live: the moment the app learns
 * about a new reminder, the home screen already knows.
 *
 * `null` means "signed out" — the widget then invites a sign-in rather than
 * leaving the previous user's reminder on screen.
 */
export function syncReminderWidget(reminders: Reminder[] | null): void {
  const next = reminders ? pickNext(reminders) : null;

  const state = !reminders
    ? ({ kind: 'signedOut' } as const)
    : next
      ? ({
          kind: 'reminder',
          title: next.title,
          scheduledFor: next.scheduledFor,
        } as const)
      : ({ kind: 'empty' } as const);

  void requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: () => renderNextReminder(state),
    // No widget on the home screen is the normal case, not an error.
    widgetNotFound: () => {},
  }).catch(() => {
    // Never let a home-screen concern surface as an app-level failure.
  });
}
