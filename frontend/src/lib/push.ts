import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Native push registration. NATIVE ONLY — see `push.web.ts`, which Metro
 * substitutes for the web bundle.
 *
 * This file must never be reachable from a web build: `expo-notifications`
 * re-exports Android-only modules (`setNotificationChannelAsync` and friends)
 * that cannot resolve for web, and the failure is a hard bundling error rather
 * than a runtime one. Guarding with `Platform.OS` inside a function does not
 * prevent it, because the import is resolved when the bundle is built.
 *
 * This is the only delivery path that reaches the user when the app is closed.
 * The WebSocket path only fires while a socket is live, so a backgrounded phone
 * silently missed every reminder — which for a secretary is the product not
 * working at all.
 *
 * Push requires a real build: Expo Go dropped Android push support in SDK 53,
 * so `npx expo start` will never deliver one. Test with an EAS build.
 */

/** Show reminders while the app is foregrounded too, instead of swallowing them. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * `getExpoPushTokenAsync` REQUIRES a projectId, and it lives in a different
 * place depending on how the app was built — reading only one of these returns
 * undefined in the other case and the call throws at runtime.
 */
function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId
  );
}

export type PushRegistration =
  | { ok: true; token: string }
  | { ok: false; reason: string };

export async function registerForPush(): Promise<PushRegistration> {
  // An emulator has no push service, and the call fails in a way that looks
  // like a permissions bug rather than an unsupported device.
  if (!Device.isDevice) {
    return { ok: false, reason: 'Push notifications need a physical device.' };
  }

  // Android 13+ will not deliver anything without this, and the token call can
  // still succeed — so a missing permission looks like working code that never
  // notifies.
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') {
    return { ok: false, reason: 'Notification permission was refused.' };
  }

  if (Platform.OS === 'android') {
    // Must match `defaultChannel` in app.json. Without a channel, Android
    // silently drops the notification.
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#208AEF',
    });
  }

  const id = projectId();
  if (!id) {
    return {
      ok: false,
      reason: 'No EAS projectId — run `eas init` and rebuild.',
    };
  }

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return { ok: true, token: data };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? 'Could not obtain a push token.' };
  }
}
