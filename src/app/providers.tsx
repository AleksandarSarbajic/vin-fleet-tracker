'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { HttpError } from '@/lib/http-error';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            /**
             * One retry, EXCEPT where asking again cannot help (phase 6,
             * item 3).
             *
             * A flat `retry: 1` answered our own 429 by immediately spending
             * another token, which is the one response guaranteed to make
             * being rate limited worse. 401 and 403 are excluded for the
             * same reason in a different key: they are decisions, not
             * accidents, and a second identical request cannot change the
             * caller's role.
             */
            retry: (failureCount, error) =>
              error instanceof HttpError ? error.retryable && failureCount < 1 : failureCount < 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
