/** TanStack Query hooks for the step 2 endpoints (AGENTS.md §8: all server data via src/api). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './client';
import type { components } from './schema';

export type Me = components['schemas']['Me'];
export type Preferences = components['schemas']['Preferences'];
export type Category = components['schemas']['Category'];

export const queryKeys = {
  me: ['me'] as const,
  preferences: ['me', 'preferences'] as const,
  categories: ['categories'] as const,
};

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => unwrap(() => api.GET('/api/v1/me')) });
}

export function usePreferences() {
  return useQuery({
    queryKey: queryKeys.preferences,
    queryFn: () => unwrap(() => api.GET('/api/v1/me/preferences')),
  });
}

export function useUpdatePreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Preferences) => unwrap(() => api.PUT('/api/v1/me/preferences', { body })),
    onSuccess: (saved) => client.setQueryData(queryKeys.preferences, saved),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => unwrap(() => api.GET('/api/v1/categories')),
  });
}
