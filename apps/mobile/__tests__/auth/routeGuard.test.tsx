import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import {
  fakeAuth,
  fakeSession,
  resetFakeSupabase,
  setFakeSession,
} from '../../test-utils/fakeSupabase';
import { mockApi } from '../../test-utils/fakeApi';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const appDir = './app';

let fetchMock: jest.SpyInstance;

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  queryClient.clear();
  // Every screen gets the fake API; Profile loads GET /me (Alex Reyes).
  fetchMock = mockApi().fetchMock;
});

afterEach(() => fetchMock.mockRestore());

describe('route guard: signed out', () => {
  beforeEach(() => resetFakeSupabase(null));

  it('opens Welcome from the app entry', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/' });

    expect(router.getPathname()).toBe('/welcome');
    expect(screen.getByRole('button', { name: 'Get started' })).toBeOnTheScreen();
  });

  it.each([
    '/home',
    '/transactions',
    '/transactions/abc',
    '/profile',
    '/meals/pantry',
    '/scan/camera',
    '/expense-form?mode=add',
    '/budget/new',
    '/notifications',
    '/dev/components',
  ])('redirects %s to Welcome', async (url) => {
    const router = await renderRouter(appDir, { initialUrl: url });

    expect(router.getPathname()).toBe('/welcome');
  });

  it('moves between Welcome, Sign up and Sign in', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/welcome' });

    await fireEvent.press(screen.getByRole('button', { name: 'Get started' }));
    expect(router.getPathname()).toBe('/sign-up');

    await fireEvent.press(screen.getByRole('link', { name: 'Back to sign in' }));
    expect(router.getPathname()).toBe('/sign-in');

    await fireEvent.press(screen.getByRole('link', { name: 'Create an account' }));
    expect(router.getPathname()).toBe('/sign-up');
  });
});

describe('route guard: signed in', () => {
  beforeEach(() => resetFakeSupabase(fakeSession()));

  it.each(['/welcome', '/sign-in', '/sign-up'])('redirects %s to Home', async (url) => {
    const router = await renderRouter(appDir, { initialUrl: url });

    expect(router.getPathname()).toBe('/home');
  });

  it('shows the profile from the API, logs out, and forgets cached data', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/profile' });
    expect(await screen.findByText('Alex Reyes')).toBeOnTheScreen();
    expect(screen.getByText('alex@example.com')).toBeOnTheScreen();
    expect(queryClient.getQueryData(['me'])).toBeDefined();

    await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));

    expect(fakeAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await waitFor(() => expect(router.getPathname()).toBe('/welcome'));
    // The next account to sign in on this phone must not see this user's data.
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
  });

  it('shows a retry when the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const defaults = queryClient.getDefaultOptions();
    // Skip the automatic retries (and their back-off) for this test.
    queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
    try {
      await renderRouter(appDir, { initialUrl: '/profile' });

      expect(
        await screen.findByText("Can't reach Lunti. Check your connection and try again."),
      ).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    } finally {
      queryClient.setDefaultOptions(defaults);
    }
  });

  it('returns to Welcome when the session ends (expired or revoked)', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/transactions' });

    await act(async () => setFakeSession(null));

    await waitFor(() => expect(router.getPathname()).toBe('/welcome'));
  });
});
