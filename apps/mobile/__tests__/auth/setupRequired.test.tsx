import { renderRouter, screen } from 'expo-router/testing-library';

import { useSessionStore } from '../../src/stores/session';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

jest.mock('../../src/lib/supabase', () => ({
  supabase: null,
  authStorage: { setPersist: jest.fn() },
  isSupabaseConfigured: false,
  missingSupabaseEnv: ['EXPO_PUBLIC_SUPABASE_ANON_KEY'],
}));

// Load the route tree once, outside any single test's timeout (see preloadRoutes.ts).
beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

describe('missing Supabase config', () => {
  it('shows a setup message naming the missing variable instead of crashing', async () => {
    useSessionStore.setState({ status: 'loading', session: null });

    await renderRouter('./app', { initialUrl: '/' });

    expect(screen.getByText("Lunti isn't connected yet")).toBeOnTheScreen();
    expect(screen.getByText('EXPO_PUBLIC_SUPABASE_ANON_KEY')).toBeOnTheScreen();
  });
});
