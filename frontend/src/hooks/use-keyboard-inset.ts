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
};

/**
 * The real thing: KeyboardStickyView has already translated the bar clear of
 * the keys, so this only has to answer for the navigation bar.
 */
function useLinkedInset(): KeyboardInset {
  const insets = useSafeAreaInsets();
  const isVisible = useNativeKeyboardState!<boolean>((state) => state.isVisible);

  return {
    // An open keyboard covers the navigation bar, and the sticky view is
    // already above both — adding the gesture-bar inset would only put dead
    // space under the input.
    bottomInset: isVisible ? 0 : insets.bottom,
    keyboardVisible: isVisible,
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
