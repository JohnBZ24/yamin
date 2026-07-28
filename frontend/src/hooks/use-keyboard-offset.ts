import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * How many pixels the composer must lift so the on-screen keyboard doesn't
 * cover it.
 *
 * KeyboardAvoidingView used to do this, except it was configured
 * `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` — an explicit
 * no-op on Android. The assumption was that `adjustResize` would shrink the
 * window instead, which Expo SDK 57 broke for good: edge-to-edge is mandatory
 * there, and an edge-to-edge window does not resize for the IME. So on a real
 * Android phone nothing moved the input bar at all and the keyboard simply sat
 * on top of it.
 *
 * This is deliberately self-correcting rather than platform-branched. It
 * measures how much the window ACTUALLY shrank and only makes up the
 * difference, so it is right in all three worlds: iOS (window resizes, offset
 * ≈ 0), older/non-edge-to-edge Android (window resizes, offset ≈ 0), and
 * edge-to-edge Android (window does not resize, offset = full keyboard). A
 * hardware keyboard, a floating keyboard, or a future SDK that restores
 * resizing all fall out correctly without another special case.
 */
export function useKeyboardOffset(): number {
  const insets = useSafeAreaInsets();
  const [offset, setOffset] = useState(0);
  // The window height with no keyboard up. Refreshed on every hide rather than
  // captured once, so rotation and split-screen don't leave it stale.
  const baselineHeight = useRef(Dimensions.get('window').height);
  const keyboardHeight = useRef(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    // Whatever the OS already gave back by resizing, we must not claim again —
    // padding on top of a resized window pushes the bar into empty space above
    // the keys.
    const recompute = () => {
      if (keyboardHeight.current === 0) {
        setOffset(0);
        return;
      }
      const absorbedByResize = Math.max(
        0,
        baselineHeight.current - Dimensions.get('window').height,
      );
      // The safe-area bottom inset is already applied by SafeAreaView, and the
      // keyboard covers that region anyway.
      setOffset(
        Math.max(0, keyboardHeight.current - absorbedByResize - insets.bottom),
      );
    };

    // iOS emits `will` events in time to animate with the keyboard; Android
    // only emits `did`, and listening for `will` there would never fire.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event) => {
      keyboardHeight.current = event.endCoordinates?.height ?? 0;
      recompute();
    });

    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardHeight.current = 0;
      baselineHeight.current = Dimensions.get('window').height;
      setOffset(0);
    });

    // The resize and the keyboard event are not ordered against each other. If
    // the window shrinks AFTER we already padded for the full keyboard, this is
    // what takes the padding back off instead of leaving a double gap.
    const resize = Dimensions.addEventListener('change', recompute);

    return () => {
      show.remove();
      hide.remove();
      resize.remove();
    };
  }, [insets.bottom]);

  return offset;
}
