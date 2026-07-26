import { showNotification } from './notify';

/**
 * Web half of the local-notify split — the browser Notification API wrapper
 * already in notify.ts does the work; this file only matches the native
 * module's signature so callers stay platform-blind.
 */
export async function presentReminder(title: string, body: string): Promise<boolean> {
  return showNotification(title, body);
}
