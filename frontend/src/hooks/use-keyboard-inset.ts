import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  isKeyboardControllerLinked,
  useNativeKeyboardState,
} from '../lib/keyboard-controller';

/**
 * Bottom spacing and keyboard visibility for a screen-anchored input bar.
 *
 * Expo SDK 57 forces edge-to-edge on Android, and an edge-to-edge window does
 * not resize for the keyboard — `windowSoftInputMode=adjustResize` is already
 * the default and has nothing left to resize. The IME becomes a window INSET,
 * and from that point RN's own signals stop describing the geometry usefully:
 *
 *   1. `useSafeAreaInsets().bottom` inflates to roughly the keyboard height
 *      while the IME is open, so `keyboardHeight - insets.bottom` cancels out.
 *   2. `endCoordinates.height` is not measured on the same basis as the window
 *      on every vendor — a Samsung One UI keyboard, with its suggestion strip,
 *      reports a height that leaves the bar half covered.
 *   3. Measuring the real overlap and correcting on layout still landed the bar
 *      level with the keys on that device.
 *
 * Three attempts, one mistake repeated: inferring a number the OS will hand
 * over directly through the right API. react-native-keyboard-controller reads
 * the real IME insets, and `<KeyboardStickyView>` does the lift.
 */
export type KeyboardInset = {
  /** Bottom padding for the input bar container. */
  bottomInset: number;
  /** Whether the keyboard is up — for keeping the newest message in view. */
  keyboardVisible: boolean;
  /**
   * Extra bottom padding the FEED needs so its last row is not hidden behind
   * the lifted input bar.
   *
   * Zero on the fallback path and non-zero on the linked one, which looks
   * backwards until you see how each moves the bar. KeyboardStickyView lifts it
   * with a TRANSFORM: the bar's layout box never moves, so the feed still
   * believes it owns that space and draws its last message underneath the bar.
   * The fallback instead grows the bar's own padding, which is real layout — the
   * feed shrinks by exactly that much on its own, and adding padding here too
   * would leave a keyboard-sized gap above the composer.
   *
   * This is why "scroll to the end when the keyboard opens" was not enough: the
   * end of the content was already behind the bar, so scrolling to it changed
   * nothing.
   */
  feedBottomInset: number;
};

/**
 * The real thing: KeyboardStickyView has already translated the bar clear of
 * the keys, so this only has to answer for the navigation bar.
 */
function useLinkedInset(): KeyboardInset {
  const insets = useSafeAreaInsets();
  const isVisible = useNativeKeyboardState!<boolean>((state) => state.isVisible);
  // The real IME height, from the platform insets rather than inferred — the
  // whole reason this library is here. Only used to pad the feed; the bar itself
  // is moved by KeyboardStickyView.
  const height = useNativeKeyboardState!<number>((state) => state.height ?? 0);

  return {
    // An open keyboard covers the navigation bar, and the sticky view is
    // already above both — adding the gesture-bar inset would only put dead
    // space under the input.
    bottomInset: isVisible ? 0 : insets.bottom,
    keyboardVisible: isVisible,
    feedBottomInset: isVisible ? height : 0,
  };
}

/**
 * Used on a binary built before the native module was installed. Here
 * KeyboardStickyView is an inert View, so padding has to do the lifting — with
 * `endCoordinates.height`, known to be imprecise on some Android keyboards.
 *
 * This is a stopgap that keeps the app usable until the next build, not a
 * second implementation to maintain: it exists so an unrelated JS fix can still
 * be tested on the binary already installed on the phone.
 */
function useFallbackInset(): KeyboardInset {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Android only emits `did` events; listening for `will` there never fires.
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event) =>
      setKeyboardHeight(event.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return {
    bottomInset: keyboardHeight > 0 ? keyboardHeight : insets.bottom,
    keyboardVisible: keyboardHeight > 0,
    // Deliberately 0: `bottomInset` above already grows the bar's layout box, so
    // the feed has shrunk by the keyboard height without any help.
    feedBottomInset: 0,
  };
}

/**
 * Picked once at module load, never per render — `isKeyboardControllerLinked`
 * is a property of the binary and cannot change while the app is running, so
 * the hook order stays stable.
 */
export const useKeyboardInset: () => KeyboardInset = isKeyboardControllerLinked
  ? useLinkedInset
  : useFallbackInset;
