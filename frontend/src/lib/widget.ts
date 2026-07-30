import type { Reminder } from './api';

/**
 * Widget updates are Android-only. Metro substitutes `widget.android.ts` there.
 *
 * A platform split rather than a `Platform.OS` branch: with a runtime check Metro
 * would still bundle react-native-android-widget and the whole widget component
 * tree into the web output. This way those modules are simply unreachable from
 * the web and iOS graphs and never bundled at all — the same reason
 * push.ts/push.web.ts and local-notify.ts/local-notify.web.ts are split.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function syncReminderWidget(_reminders: Reminder[] | null): void {}
