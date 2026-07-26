import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Persistent session storage — pure storage, no HTTP. api.ts owns the network
 * (including refresh); this module owns where tokens live and who gets told
 * when they change. Keeping the two apart is what avoids a circular import.
 *
 * Native: expo-secure-store (Keychain / Android Keystore). Web: localStorage —
 * the usual trade-off accepted by every web app that stays signed in.
 */

export type Session = { token: string; refreshToken: string };

const KEY = 'yamin.session';

const listeners = new Set<(session: Session | null) => void>();
let current: Session | null = null;

export function getSession(): Session | null {
  return current;
}

/** Fires immediately on subscribe with the current value, then on every change. */
export function subscribeSession(fn: (session: Session | null) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  for (const fn of listeners) fn(current);
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw =
      Platform.OS === 'web'
        ? typeof localStorage !== 'undefined'
          ? localStorage.getItem(KEY)
          : null
        : await SecureStore.getItemAsync(KEY);
    current = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    current = null;
  }
  notify();
  return current;
}

export async function setSession(session: Session | null): Promise<void> {
  current = session;
  notify();
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        if (session) localStorage.setItem(KEY, JSON.stringify(session));
        else localStorage.removeItem(KEY);
      }
    } else if (session) {
      await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    } else {
      await SecureStore.deleteItemAsync(KEY);
    }
  } catch {
    // Failing to persist must never break the in-memory session the user is
    // actively using; worst case they sign in again next launch.
  }
}
