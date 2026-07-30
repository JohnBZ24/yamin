import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useEffect, useRef, useState } from 'react';

import { useSession } from '../hooks/use-session';

/**
 * Owns the query cache for the whole app.
 *
 * Created inside a component rather than at module scope so it is not shared
 * between requests during web static rendering, and so a fast refresh does not
 * hand two trees the same client.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * Navigating back to a screen within half a minute reuses what is
             * already cached instead of refetching. The events that genuinely
             * change this data — a processed note, a deletion — invalidate
             * their keys explicitly, so freshness does not depend on this
             * number being small.
             */
            staleTime: 30_000,
            /**
             * One retry, not three. api.ts already refreshes and replays a
             * request once on a 401, so the failures that reach here are
             * mostly real (offline, server down) and retrying them three times
             * only delays telling the user.
             */
            retry: 1,
          },
        },
      }),
  );

  const { token } = useSession();
  // Signed in at mount counts as "already seen" — only a later transition to
  // signed-out should wipe anything.
  const wasSignedIn = useRef(!!token);

  useEffect(() => {
    if (wasSignedIn.current && !token) {
      // Another account must never be shown the previous one's notes,
      // entities or reminders out of cache while their own request is still
      // in flight.
      client.clear();
    }
    wasSignedIn.current = !!token;
  }, [token, client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
