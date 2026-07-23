/**
 * Web stub for native push registration.
 *
 * Metro picks this file over `push.ts` for the web bundle. It exists because
 * `expo-notifications` cannot be bundled for web at all — it re-exports
 * Android-only modules like `setNotificationChannelAsync`, which fail to
 * resolve and break the whole build. A `Platform.OS` check inside the function
 * does NOT help: the import is resolved when the bundle is built, long before
 * any check runs.
 *
 * Web reminders go through the browser Notification API instead — see
 * `notify.ts`, which this file deliberately does not duplicate.
 */

export type PushRegistration =
  | { ok: true; token: string }
  | { ok: false; reason: string };

export async function registerForPush(): Promise<PushRegistration> {
  return {
    ok: false,
    reason: 'Web uses the browser Notification API, not Expo push.',
  };
}
