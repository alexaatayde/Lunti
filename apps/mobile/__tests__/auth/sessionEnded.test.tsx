/** Expired / revoked sessions: back to Welcome with a reason, never because of a network blip. */
import { AuthApiError } from '@supabase/supabase-js';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { mockApi } from '../../test-utils/fakeApi';
import {
  fakeAuth,
  fakeSession,
  resetFakeSupabase,
  setFakeSession,
} from '../../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const appDir = './app';
const ENDED = 'Your session ended. Please sign in again.';

let fetchMock: jest.SpyInstance;

beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  queryClient.clear();
  fetchMock = mockApi().fetchMock;
  resetFakeSupabase(fakeSession());
});

afterEach(() => fetchMock.mockRestore());

describe('session ended', () => {
  it('shows "Your session ended" on Welcome after a sign-out the user did not ask for', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/home' });

    await act(async () => setFakeSession(null)); // Supabase gave up refreshing

    await waitFor(() => expect(router.getPathname()).toBe('/welcome'));
    expect(screen.getByText(ENDED)).toBeOnTheScreen();
  });

  it('keeps the message on Sign in, lets the user dismiss it, and clears it on sign-in', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/home' });
    await act(async () => setFakeSession(null));
    await waitFor(() => expect(router.getPathname()).toBe('/welcome'));

    await fireEvent.press(screen.getByRole('button', { name: 'I already have an account' }));
    expect(screen.getByText(ENDED)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByText(ENDED)).toBeNull();

    useSessionStore.getState().setNotice('sessionEnded');
    await act(async () => setFakeSession(fakeSession()));
    expect(useSessionStore.getState().notice).toBeNull();
  });

  it('does not show it when the user logs out themselves', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/profile' });
    expect(await screen.findByText('Alex Reyes')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(router.getPathname()).toBe('/welcome'));
    expect(screen.queryByText(ENDED)).toBeNull();
  });

  it('signs out and opens Welcome when an API call finds the refresh token revoked', async () => {
    fakeAuth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token: Revoked', 400, 'refresh_token_not_found'),
    } as never);
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ type: 'x', title: 'x', status: 401, detail: 'expired' }), {
          status: 401,
          headers: {
            'Content-Type': 'application/problem+json',
            'WWW-Authenticate': 'Bearer error="invalid_token"',
          },
        }),
    );
    const router = await renderRouter(appDir, { initialUrl: '/profile' });

    await waitFor(() => expect(router.getPathname()).toBe('/welcome'));
    expect(screen.getByText(ENDED)).toBeOnTheScreen();
    expect(fakeAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(fakeAuth.refreshSession).toHaveBeenCalledTimes(1); // no refresh loop
  });

  it('stays signed in, with a retry, when the API is down (503)', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ type: 'x', title: 'x', status: 503, detail: 'Database unavailable' }),
          { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
        ),
    );
    const defaults = queryClient.getDefaultOptions();
    queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
    try {
      const router = await renderRouter(appDir, { initialUrl: '/profile' });

      expect(
        await screen.findByText('Lunti is temporarily unavailable. Please try again shortly.'),
      ).toBeOnTheScreen();
      expect(router.getPathname()).toBe('/profile');
      expect(fakeAuth.signOut).not.toHaveBeenCalled();
      expect(fakeAuth.refreshSession).not.toHaveBeenCalled();
    } finally {
      queryClient.setDefaultOptions(defaults);
    }
  });
});
