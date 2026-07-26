import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import {
  loadSession,
  Session,
  setSession,
  subscribeSession,
} from '../lib/session-store';

/**
 * The one hook screens use for auth. Restores the stored session on cold
 * start (so the user is not asked to sign in on every launch), stays in sync
 * with the store — including the sign-out that api.ts performs when a refresh
 * fails — and exposes signIn/signOut.
 *
 * `ready` is false until the restore attempt finishes; render a splash-ish
 * blank until then, or the login screen flashes for every signed-in user.
 */
export function useSession() {
  const [session, setLocal] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeSession(setLocal);
    void loadSession().finally(() => setReady(true));
    return unsubscribe;
  }, []);

  return {
    ready,
    token: session?.token ?? null,
    signIn: async (email: string, password: string) => {
      const { token, refreshToken } = await api.login(email, password);
      await setSession({ token, refreshToken });
    },
    signUp: async (details: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
    }) => {
      // Registration signs the user straight in — the backend returns the
      // same token pair as login.
      const { token, refreshToken } = await api.register(details);
      await setSession({ token, refreshToken });
    },
    signOut: async () => {
      await setSession(null);
    },
  };
}
