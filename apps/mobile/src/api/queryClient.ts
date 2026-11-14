import { onlineManager, QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useSessionStore } from '../stores/session';
import { ApiError } from './client';

/** Queries retry only connection/temporary failures (a 4xx won't fix itself), and not while
 * the phone is known to be offline: reconnecting refetches them instead. */
export function shouldRetryQuery(failures: number, error: unknown): boolean {
  return error instanceof ApiError && error.transient && failures < 2 && onlineManager.isOnline();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: shouldRetryQuery,
      // Try even when the phone looks offline: a paused query would leave the screen on its
      // skeleton forever. Failing shows the error card (with Try again), and the reconnect
      // and foreground refetches (src/lib/connectivity.ts) recover it without a tap.
      networkMode: 'always',
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Never auto-retry a write (AGENTS.md §4; idempotency only covers manual creates, and
      // the user decides when to send it again).
      retry: false,
      // TanStack's default ('online') PAUSES a mutation while offline and sends it on
      // reconnect — a hidden offline write queue. Fail right away instead; forms keep their
      // values and the same idempotency key for the user's retry.
      networkMode: 'always',
    },
  },
});

/**
 * Drops all cached server data when the signed-in user changes (sign out, or a different
 * account signs in), so one user's data is never shown to another. Mount once at the root.
 *
 * The first change at startup (no session known yet → the saved user) is skipped: the cache is
 * empty then, and clearing it would orphan the queries the first screen just started, leaving
 * that screen loading forever.
 */
export function useResetQueriesOnUserChange() {
  const userId = useSessionStore((s) => s.session?.user.id ?? null);
  const previous = useRef(userId);

  useEffect(() => {
    if (previous.current !== userId) {
      if (previous.current !== null) queryClient.clear();
      previous.current = userId;
    }
  }, [userId]);
}
