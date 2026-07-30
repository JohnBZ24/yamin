import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Touch feedback for the record button.
 *
 * Recording is the one interaction here that happens without the user looking:
 * you hold the mic, speak, and let go. A tap you can feel is what confirms the
 * take started and ended — otherwise the only feedback is visual, on a screen
 * that is probably not being watched.
 *
 * Native only. expo-haptics does support web through the Vibration API, but it
 * is silently ignored on desktop, needs permission on mobile browsers, and adds
 * a failure mode to a purely decorative effect.
 *
 * Every call is fire-and-forget and swallows its error: haptics are disabled
 * outright in iOS Low Power Mode and on devices without the hardware, and a
 * recording must never fail because a vibration did.
 */
const supported = Platform.OS === 'ios' || Platform.OS === 'android';

const fire = (run: () => Promise<void>) => {
  if (!supported) return;
  void run().catch(() => {});
};

/** The take has begun — the firmest of these, because it starts something. */
export const hapticRecordStart = () =>
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

/** Sent. Lighter than the start: a confirmation, not an event. */
export const hapticSend = () =>
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** Swiped up into hands-free — a mode change, which is what selection feedback is for. */
export const hapticLock = () => fire(() => Haptics.selectionAsync());

/** Thrown away. The warning pattern, because something was just discarded. */
export const hapticCancel = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
