import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import io, { Socket } from 'socket.io-client';

import { API_URL } from './api';
import { presentReminder } from './local-notify';
import { useToast } from '../components/toast';
import { useSession } from '../hooks/use-session';

type Realtime = { socket: Socket | null; online: boolean };

const RealtimeContext = createContext<Realtime>({ socket: null, online: false });

export function useRealtime(): Realtime {
  return useContext(RealtimeContext);
}

/**
 * One app-wide socket, owned by the root layout — NOT by a screen.
 *
 * The socket used to be created inside the feed screen, which meant a
 * reminder that fired while you were on the chat or graph screen arrived at
 * a socket that had been torn down on navigation: no notification, no toast,
 * nothing. For an app whose headline feature is "it reminds you", delivery
 * cannot depend on which screen happens to be mounted.
 *
 * Reminder alerts are handled HERE, globally. Screens that care about other
 * events (voice-processed, voice-failed) subscribe through useRealtime().
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { token } = useSession();
  const toast = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      setOnline(false);
      return;
    }

    const s = io(API_URL, {
      auth: { token: `Bearer ${token}` },
      transports: ['websocket'],
    });

    s.on('connect', () => setOnline(true));
    s.on('disconnect', () => setOnline(false));

    s.on('reminder-alert', (data: any) => {
      // OS notification first (browser Notification on web, a real local
      // notification on native); the sticky toast is the in-app fallback for
      // when permission was refused — sticky, because a reminder that fades
      // after 4.5s is a reminder you miss.
      void presentReminder('Yamin reminder', data.title).then((shown) => {
        if (!shown) {
          toast(`⏰ Reminder: ${data.title}`, 'success', { sticky: true });
        }
      });
    });

    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [token, toast]);

  return (
    <RealtimeContext.Provider value={{ socket, online }}>
      {children}
    </RealtimeContext.Provider>
  );
}
