import { renderRouter, screen } from 'expo-router/testing-library';

import { useSessionStore } from '../../src/stores/session';

jest.mock('../../src/lib/supabase', () => ({
  supabase: null,
  authStorage: { setPersist: jest.fn() },
  isSupabaseConfigured: false,
  missingSupabaseEnv: ['EXPO_PUBLIC_SUPABASE_ANON_KEY'],
}));

describe('missing Supabase config', () => {
  it('shows a setup message naming the missing variable instead of crashing', async () => {
    useSessionStore.setState({ status: 'loading', session: null });

    await renderRouter('./app', { initialUrl: '/' });

    expect(screen.getByText("Lunti isn't connected yet")).toBeOnTheScreen();
    expect(screen.getByText('EXPO_PUBLIC_SUPABASE_ANON_KEY')).toBeOnTheScreen();
  });
});
