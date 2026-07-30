import React from 'react';
import { Platform, TurboModuleRegistry, View, type ViewProps } from 'react-native';

/**
 * react-native-keyboard-controller, if this binary actually contains it.
 *
 * The library is native code, so a dev client or APK built before it was
 * installed does not have it — and importing it there throws at module scope,
 * taking the whole app down with "doesn't seem to be linked". That is a real
 * constraint of native modules, not something a Metro reload can route around:
 * Metro ships JavaScript, and there is no Android library on the device to bind
 * to. Expo Go cannot load custom native modules at all.
 *
 * So the import is guarded rather than assumed. On a binary that has the module
 * we use it; on one that doesn't, the app still runs with a JS-only fallback
 * and only the keyboard behaviour is degraded. That matters because the
 * alternative — a hard crash — also hides every unrelated fix in the same
 * reload, and blocks all testing until a 15-minute rebuild lands.
 *
 * `TurboModuleRegistry.get` returns null when a module is absent (unlike
 * `getEnforcing`, which throws), so on a device this check is safe to run
 * whether or not the module is there.
 *
 * Web is excluded BEFORE that call, though, and not merely because the library
 * is native-only: react-native-web does not implement TurboModuleRegistry at
 * all — the export is `undefined` — so reading `.get` off it is a TypeError at
 * module scope. This module is imported by the root layout, so that throw took
 * down the entire web bundle before anything rendered, and `expo export
 * --platform web` failed in the static-render pass with "Cannot read properties
 * of undefined (reading 'get')".
 */
export const isKeyboardControllerLinked =
  Platform.OS !== 'web' && TurboModuleRegistry.get('KeyboardController') != null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lib: any = null;
if (isKeyboardControllerLinked) {
  // Required, not imported: a static import is hoisted and would run — and
  // throw — before the check above could prevent it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  lib = require('react-native-keyboard-controller');
}

/** Passthrough when unlinked — nothing to provide. */
export const KeyboardProvider: React.ComponentType<{
  children: React.ReactNode;
}> = lib?.KeyboardProvider ?? (({ children }) => children as React.ReactElement);

/**
 * Sticks its children to the top of the keyboard using the platform's real IME
 * insets. Unlinked, it is an ordinary View and `useKeyboardInset` compensates
 * by padding instead.
 */
export const KeyboardStickyView: React.ComponentType<
  ViewProps & { offset?: { closed?: number; opened?: number } }
> = lib?.KeyboardStickyView ?? (View as never);

/** The library's hook, or null when there is no library. */
export const useNativeKeyboardState: // eslint-disable-next-line @typescript-eslint/no-explicit-any
| (<T>(selector: (state: any) => T) => T)
  | null = lib?.useKeyboardState ?? null;
