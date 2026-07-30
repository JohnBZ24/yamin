// Must be first: expo-router/entry calls registerRootComponent, and the widget
// handler below is registered against the app it sets up.
import 'expo-router/entry';

import { Platform } from 'react-native';

/**
 * The Android home-screen widget's JS entry.
 *
 * Registered here rather than anywhere in src/app, because the widget runs in a
 * headless task that has no screen mounted — the handler has to be attached at
 * startup, before any route exists.
 *
 * Android-only, and reached through require() rather than a static import. A
 * static import is hoisted and evaluated on every platform, and
 * react-native-android-widget is Android native code: on web it would throw at
 * module scope. This is the entry point, so that throw takes down the whole
 * bundle before anything renders — exactly the failure that
 * lib/keyboard-controller.ts hit by reading TurboModuleRegistry (absent from
 * react-native-web) at module scope, which silently killed the web build.
 *
 * `expo export --platform web` is the check that keeps this honest.
 */
if (Platform.OS === 'android') {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widgets/widget-task-handler');

  registerWidgetTaskHandler(widgetTaskHandler);
}
