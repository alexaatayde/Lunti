import { QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useSessionStore } from '../stores/session';
import { ApiError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retry only connection/temporary failures; a 4xx won't fix itself.
      retry: (failures, error) => error instanceof ApiError && error.transient && failures < 2,
    },
    mutations: { retry: false },
  },
});

/**
 * Drops all cached server data when the signed-in user changes (sign out, or a different
 * account signs in), so one user's data is never shown to another. Mount once at the root.
 */
export function useResetQueriesOnUserChange() {
  const userId = useSessionStore((s) => s.session?.user.id ?? null);
  const previous = useRef(userId);

  useEffect(() => {
    if (previous.current !== userId) {
      queryClient.clear();
      previous.current = userId;
    }
  }, [userId]);
}
