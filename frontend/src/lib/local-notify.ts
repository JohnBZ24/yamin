import * as Notifications from 'expo-notifications';

/**
 * Present a reminder that arrived over the LIVE socket. NATIVE ONLY — Metro
 * substitutes `local-notify.web.ts` for web builds, same split (and same
 * reason) as push.ts: expo-notifications cannot even be bundled for web.
 *
 * Push covers the app-closed case; this covers the app-open one. Android in
 * particular shows nothing for a foreground data event unless an actual local
 * notification is presented.
 *
 * Returns true if an OS-level notification was shown — the caller falls back
 * to an in-app toast when it wasn't.
 */
export async function presentReminder(title: string, body: string): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return false;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      // null = now. The 'reminders' channel is created during push
      // registration (push.ts) and app.json declares it as default.
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
