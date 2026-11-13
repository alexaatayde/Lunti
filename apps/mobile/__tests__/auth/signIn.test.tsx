import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '../../src/stores/session';
import {
  fakeAuth,
  fakeAuthStorage,
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

// Load the route tree once, outside any single test's timeout (see preloadRoutes.ts).
beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  resetFakeSupabase(null);
});

async function fillAndSubmit(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Sign in', () => {
  it('shows field errors and does not call Supabase when empty', async () => {
    await renderRouter(appDir, { initialUrl: '/sign-in' });

    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your email.')).toBeOnTheScreen();
    expect(screen.getByText('Enter your password.')).toBeOnTheScreen();
    expect(fakeAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    await renderRouter(appDir, { initialUrl: '/sign-in' });

    await fillAndSubmit('alex@', 'secret123');

    expect(await screen.findByText('Enter a valid email address.')).toBeOnTheScreen();
    expect(fakeAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with a trimmed email, keeps the session, and opens Home', async () => {
    fakeAuth.signInWithPassword.mockImplementation(async () => {
      const session = fakeSession();
      setFakeSession(session);
      return { data: { user: session.user, session }, error: null };
    });
    const router = await renderRouter(appDir, { initialUrl: '/sign-in' });

    await fillAndSubmit('  alex@example.com ', 'leafygreens24');

    await waitFor(() => expect(router.getPathname()).toBe('/home'));
    expect(fakeAuth.signInWithPassword).toHaveBeenCalledWith({
      email: 'alex@example.com',
      password: 'leafygreens24',
    });
    expect(fakeAuthStorage.setPersist).toHaveBeenCalledWith(true);
  });

  it('keeps the session in memory only when "Keep me signed in" is off', async () => {
    fakeAuth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    await renderRouter(appDir, { initialUrl: '/sign-in' });

    const keep = screen.getByRole('checkbox', { name: 'Keep me signed in' });
    expect(keep).toBeChecked();
    await fireEvent.press(keep);
    expect(keep).not.toBeChecked();
    await fillAndSubmit('alex@example.com', 'leafygreens24');

    await waitFor(() => expect(fakeAuthStorage.setPersist).toHaveBeenCalledWith(false));
  });

  it('shows a clear message for wrong credentials and stays on Sign in', async () => {
    fakeAuth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    const router = await renderRouter(appDir, { initialUrl: '/sign-in' });

    await fillAndSubmit('alex@example.com', 'wrong-pass1');

    expect(await screen.findByText('Email or password is incorrect.')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
  });

  it('shows a connection message when offline, and retrying works', async () => {
    fakeAuth.signInWithPassword
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: new AuthRetryableFetchError('Failed to fetch', 0),
      })
      .mockImplementationOnce(async () => {
        const session = fakeSession();
        setFakeSession(session);
        return { data: { user: session.user, session }, error: null };
      });
    const router = await renderRouter(appDir, { initialUrl: '/sign-in' });

    await fillAndSubmit('alex@example.com', 'leafygreens24');
    expect(
      await screen.findByText("Can't reach Lunti. Check your connection and try again."),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.getPathname()).toBe('/home'));
  });

  it('shows and hides the password', async () => {
    await renderRouter(appDir, { initialUrl: '/sign-in' });
    const password = screen.getByLabelText('Password');
    expect(password).toHaveProp('secureTextEntry', true);

    await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', false);
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeOnTheScreen();
  });
});
