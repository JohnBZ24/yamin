import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { loadSession } from '../lib/session-store';
import { fetchRemindersForWidget, pickNext } from './fetch-reminders';
import { renderNextReminder } from './next-reminder-widget';
import type { NextReminderState } from './next-reminder-widget';
import { WIDGET_NAME } from './widget-name';

/**
 * The widget's headless entry point.
 *
 * This runs in a JS context with no app mounted: no React tree, no providers, no
 * hooks. Nothing here may use `useTokens()`, `useColorScheme()` or a TanStack
 * Query hook — it reads storage and the API directly and hands a plain state
 * object to the renderer.
 *
 * Everything reachable from this file gets its module scope evaluated in that
 * context, so keep the import graph tight. In particular do NOT import
 * `lib/queries.ts` (pulls in TanStack Query), `lib/realtime.tsx` (socket.io plus
 * the toast component), or anything under `src/components/`.
 *
 * Registered from index.js, the only place that runs early enough.
 */

/** Upcoming come back first, so a handful is plenty to find the next one. */
const FETCH_LIMIT = 5;

/**
 * Read the next upcoming reminder, or say why there isn't one.
 *
 * Every failure resolves to a renderable state rather than throwing. A widget
 * showing an error is worse than one showing "tap to open", and an exception
 * escaping the handler leaves whatever pixels were there before with no
 * explanation.
 */
async function readState(): Promise<NextReminderState> {
  /**
   * `loadSession()`, not `getSession()`.
   *
   * session-store keeps the session in a module-level `current` that only
   * `loadSession()` populates from SecureStore. This is a fresh JS context every
   * time the widget wakes, so `current` starts null — `getSession()` alone would
   * report a signed-in user as signed out on every single refresh.
   */
  let token: string | null = null;
  try {
    token = (await loadSession())?.token ?? null;
  } catch {
    /**
     * SecureStore unavailable in this context. Whether Expo modules initialise
     * in a headless task is the one thing about this widget that is unverified,
     * so it is handled rather than assumed. Reported as 'offline' and not
     * 'signedOut': the user IS signed in, we just cannot see it, and telling
     * them to sign in would be a lie that invites them to do the wrong thing.
     */
    return { kind: 'offline' };
  }

  if (!token) return { kind: 'signedOut' };

  const reminders = await fetchRemindersForWidget(token, FETCH_LIMIT);
  // null = offline, or a 401 this deliberately does not try to recover from.
  if (!reminders) return { kind: 'offline' };

  const next = pickNext(reminders);
  return next
    ? { kind: 'reminder', title: next.title, scheduledFor: next.scheduledFor }
    : { kind: 'empty' };
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  // Guard on name so adding a second widget later cannot accidentally render
  // this one's UI into it.
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      // Resize redraws too: the layout is fluid, and the relative time is worth
      // recomputing whenever we are woken anyway.
      props.renderWidget(renderNextReminder(await readState()));
      break;
    }

    case 'WIDGET_DELETED':
      // Nothing is persisted per-widget, so nothing to clean up.
      break;

    case 'WIDGET_CLICK':
      // The only click action is OPEN_APP, which Android handles natively and
      // never routes here. Left explicit so a future custom action is obviously
      // unhandled rather than silently swallowed by a default case.
      break;

    default:
      break;
  }
}
