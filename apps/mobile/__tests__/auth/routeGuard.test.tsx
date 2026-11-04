import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '../../src/stores/session';
import {
  fakeAuth,
  fakeSession,
  resetFakeSupabase,
  setFakeSession,
} from '../../test-utils/fakeSupabase';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const appDir = './app';

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
});

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

  it('logs out from Profile and returns to Welcome', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/profile' });
    expect(screen.getByText('alex@example.com')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));

    expect(fakeAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await waitFor(() => expect(router.getPathname()).toBe('/welcome'));
  });

  it('returns to Welcome when the session ends (expired or revoked)', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/transactions' });

    await act(async () => setFakeSession(null));

    await waitFor(() => expect(router.getPathname()).toBe('/welcome'));
  });
});
