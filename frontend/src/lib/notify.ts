import { Platform } from 'react-native';

/**
 * Browser notifications for reminders.
 *
 * A reminder used to surface only as an in-page toast that disappeared after
 * 4.5 seconds. If the tab was in the background — which is the normal case for
 * a reminder you asked for an hour ago — it rendered into a tab nobody was
 * looking at and was gone before it was ever seen. An OS-level notification is
 * the whole point: it reaches you when you are NOT looking at the app.
 *
 * Two hard limits worth knowing, neither of which code can work around:
 *  - The Notification API is secure-context-only. Over plain HTTP on a LAN
 *    address (how the app is reached from a phone) `window.Notification` is
 *    simply absent — same restriction that blocks the microphone.
 *  - It only works while a tab is open. A closed tab needs a Service Worker
 *    plus the Push API; nothing here helps there.
 */

function api(): typeof Notification | null {
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined') return null;
  // Absent entirely on an insecure origin, so this is a feature check AND a
  // secure-context check at once.
  return typeof window.Notification === 'function' ? window.Notification : null;
}

/** True when the browser can show notifications and the user has allowed it. */
export function canNotify(): boolean {
  const N = api();
  return !!N && N.permission === 'granted';
}

/** True when we could still ask — i.e. not already denied. */
export function canAskToNotify(): boolean {
  const N = api();
  return !!N && N.permission === 'default';
}

export type NotifyStatus =
  | 'granted'
  | 'askable'
  | 'denied'
  | 'insecure'
  | 'unsupported';

/**
 * Why reminders will or won't reach you, as a single value the UI can explain.
 *
 * Without this the app failed silently: on an insecure origin the permission
 * request is a no-op, so nothing was ever asked and nothing ever appeared, with
 * no way for the user to tell the difference between "not granted" and "broken".
 */
export function notifyStatus(): NotifyStatus {
  if (Platform.OS !== 'web') return 'unsupported';
  if (typeof window === 'undefined') return 'unsupported';

  if (typeof window.Notification !== 'function') {
    // `isSecureContext` distinguishes the common case (plain HTTP on a LAN
    // address) from a browser that genuinely lacks the API.
    return window.isSecureContext === false ? 'insecure' : 'unsupported';
  }
  if (window.Notification.permission === 'granted') return 'granted';
  if (window.Notification.permission === 'denied') return 'denied';
  return 'askable';
}

/** One line explaining the current state, written for the person reading it. */
export function notifyStatusMessage(status: NotifyStatus): string | null {
  switch (status) {
    case 'granted':
      return null;
    case 'askable':
      return 'Turn on notifications so reminders reach you when this tab is in the background.';
    case 'denied':
      return 'Notifications are blocked. Reminders will only appear here while this tab is open — re-enable them in your browser\'s site settings.';
    case 'insecure':
      return 'This page is served over plain HTTP, so the browser blocks notifications entirely. Reminders will only appear here while this tab is open. Use https, or open the app on localhost.';
    case 'unsupported':
      return null;
  }
}

/**
 * Must be called from a user gesture in most browsers, so this is wired to the
 * sign-in press rather than fired on mount — an automatic prompt on page load
 * is both worse UX and silently rejected by some browsers.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const N = api();
  if (!N) return false;
  if (N.permission === 'granted') return true;
  if (N.permission === 'denied') return false;

  try {
    return (await N.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Shows an OS notification. Returns false when it could not be shown, so the
 * caller can fall back to an in-app toast rather than the reminder vanishing
 * silently.
 */
export function showNotification(title: string, body?: string): boolean {
  const N = api();
  if (!N || N.permission !== 'granted') return false;

  try {
    const notification = new N(title, {
      body,
      // Collapses duplicates rather than stacking if the same reminder somehow
      // arrives twice.
      tag: `yamin-${title}`,
      requireInteraction: false,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
