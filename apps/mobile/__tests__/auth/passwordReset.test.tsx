/** Forgot password → email link → choose a new password (Supabase recovery, PKCE). */
import {
  AuthApiError,
  AuthPKCECodeVerifierMissingError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from '@supabase/supabase-js';
import { router as appRouter } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '../../src/stores/session';
import {
  fakeAuth,
  fakeAuthStorage,
  fakeSession,
  resetFakeSupabase,
} from '../../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const appDir = './app';
const CODE = '6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b';
const SENT = /If an account exists for/;

beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  resetFakeSupabase(null);
});

async function requestLink(email: string) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
}

describe('Forgot password', () => {
  it('opens from Sign in with the typed email filled in', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/sign-in' });
    await fireEvent.changeText(screen.getByLabelText('Email'), ' alex@example.com ');

    await fireEvent.press(screen.getByRole('link', { name: 'Forgot password?' }));

    expect(router.getPathname()).toBe('/forgot-password');
    expect(screen.getByLabelText('Email').props.value).toBe('alex@example.com');
  });

  it('validates the email before calling Supabase', async () => {
    await renderRouter(appDir, { initialUrl: '/forgot-password' });

    await requestLink('alex@');

    expect(await screen.findByText('Enter a valid email address.')).toBeOnTheScreen();
    expect(fakeAuth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('sends the reset email with the app link as the redirect', async () => {
    await renderRouter(appDir, { initialUrl: '/forgot-password' });

    await requestLink(' alex@example.com ');

    expect(await screen.findByText(SENT)).toBeOnTheScreen();
    expect(fakeAuth.resetPasswordForEmail).toHaveBeenCalledWith('alex@example.com', {
      redirectTo: expect.stringMatching(/reset-password$/),
    });
    // Resend is held back for the Supabase per-address limit.
    expect(screen.getByRole('button', { name: /Resend link in \d+s/ })).toBeDisabled();
  });

  it('gives the same answer when no account exists (no account enumeration)', async () => {
    fakeAuth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: new AuthApiError('User not found', 404, 'user_not_found'),
    });
    await renderRouter(appDir, { initialUrl: '/forgot-password' });

    await requestLink('nobody@example.com');

    expect(await screen.findByText(SENT)).toBeOnTheScreen();
  });

  it.each([
    [new AuthRetryableFetchError('Failed to fetch', 0), "Can't reach Lunti. Check your connection and try again."],
    [new AuthApiError('rate', 429, 'over_email_send_rate_limit'), 'Too many attempts. Wait a minute and try again.'],
    [new AuthApiError('boom', 500, 'unexpected_failure'), "We couldn't send a reset email right now. Please try again later."],
  ])('shows an error and stays on the form: %s', async (error, message) => {
    fakeAuth.resetPasswordForEmail.mockResolvedValue({ data: null, error });
    await renderRouter(appDir, { initialUrl: '/forgot-password' });

    await requestLink('alex@example.com');

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByText(SENT)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeOnTheScreen();
  });

  it('allows a resend after the cooldown', async () => {
    jest.useFakeTimers();
    try {
      await renderRouter(appDir, { initialUrl: '/forgot-password' });
      await requestLink('alex@example.com');
      expect(await screen.findByText(SENT)).toBeOnTheScreen();

      for (let i = 0; i < 60; i += 1) await act(async () => jest.advanceTimersByTime(1000));
      await fireEvent.press(screen.getByRole('button', { name: 'Resend link' }));

      expect(fakeAuth.resetPasswordForEmail).toHaveBeenCalledTimes(2);
      expect(await screen.findByText('We sent the link again.')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });
});

async function choosePassword(password: string, confirm = password) {
  await fireEvent.changeText(screen.getByLabelText('New password'), password);
  await fireEvent.changeText(screen.getByLabelText('Confirm new password'), confirm);
  await fireEvent.press(screen.getByRole('button', { name: 'Save new password' }));
}

describe('Reset password link', () => {
  it('exchanges the code once, keeps the app locked, and saves the new password', async () => {
    const router = await renderRouter(appDir, { initialUrl: `/reset-password?code=${CODE}` });

    expect(await screen.findByText('Choose a new password')).toBeOnTheScreen();
    expect(fakeAuth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(fakeAuth.exchangeCodeForSession).toHaveBeenCalledWith(CODE);
    // The reset session lives in memory only and does not open the app.
    expect(fakeAuthStorage.holdInMemory).toHaveBeenCalledWith('lunti.auth');
    expect(useSessionStore.getState().recovering).toBe(true);
    expect(router.getPathname()).toBe('/reset-password');

    await choosePassword('newpass123');

    expect(await screen.findByText('Password updated')).toBeOnTheScreen();
    expect(fakeAuth.updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
    expect(fakeAuth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(useSessionStore.getState()).toMatchObject({ status: 'signedOut', recovering: false });
    // Finishing a reset is not an unexpected sign-out.
    expect(useSessionStore.getState().notice).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.getPathname()).toBe('/sign-in');
  });

  it('keeps the signed-in screens closed while a reset session is open', async () => {
    const router = await renderRouter(appDir, { initialUrl: `/reset-password?code=${CODE}` });
    expect(await screen.findByText('Choose a new password')).toBeOnTheScreen();

    await act(async () => appRouter.push('/home'));

    expect(router.getPathname()).toBe('/welcome');
  });

  it('validates the new password like sign-up', async () => {
    await renderRouter(appDir, { initialUrl: `/reset-password?code=${CODE}` });
    await screen.findByText('Choose a new password');

    await choosePassword('short', 'short');
    expect(await screen.findByText('Use at least 8 characters.')).toBeOnTheScreen();

    await choosePassword('longenough', 'longenough');
    expect(await screen.findByText('Add at least one number.')).toBeOnTheScreen();

    await choosePassword('newpass123', 'newpass124');
    expect(await screen.findByText("Passwords don't match.")).toBeOnTheScreen();
    expect(fakeAuth.updateUser).not.toHaveBeenCalled();
  });

  it('explains a reused password and lets the user try again', async () => {
    fakeAuth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthApiError('same', 422, 'same_password'),
    });
    await renderRouter(appDir, { initialUrl: `/reset-password?code=${CODE}` });
    await screen.findByText('Choose a new password');

    await choosePassword('oldpass123');

    expect(
      await screen.findByText('Choose a password different from your current one.'),
    ).toBeOnTheScreen();
    expect(fakeAuth.signOut).not.toHaveBeenCalled();
  });

  it('keeps the form on a network failure so the user can retry', async () => {
    fakeAuth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    await renderRouter(appDir, { initialUrl: `/reset-password?code=${CODE}` });
    await screen.findByText('Choose a new password');

    await choosePassword('newpass123');
    expect(
      await screen.findByText("Can't reach Lunti. Check your connection and try again."),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText('Password updated')).toBeOnTheScreen();
  });

  it('asks for a new link if the reset session ended before saving', async () => {
    fakeAuth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    await renderRouter(appDir, { initialUrl: `/reset-password?code=${CODE}` });
    await screen.findByText('Choose a new password');

    await choosePassword('newpass123');

    expect(await screen.findByText('This link has expired')).toBeOnTheScreen();
    expect(useSessionStore.getState().recovering).toBe(false);
  });

  it('shows "expired" for an expired or used link from Supabase', async () => {
    const router = await renderRouter(appDir, {
      initialUrl: '/reset-password?error=access_denied&error_code=otp_expired&error_description=x',
    });

    expect(screen.getByText('This link has expired')).toBeOnTheScreen();
    expect(fakeAuth.exchangeCodeForSession).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Request a new link' }));
    expect(router.getPathname()).toBe('/forgot-password');
  });

  it.each([
    [new AuthApiError('expired', 403, 'flow_state_expired'), 'This link has expired'],
    [new AuthPKCECodeVerifierMissingError(), 'Open the link on this phone'],
    [new AuthRetryableFetchError('Failed to fetch', 0), "We couldn't check your link"],
  ])('explains a code that cannot be used (%s)', async (error, title) => {
    fakeAuth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null, user: null, redirectType: null },
      error,
    });
    await renderRouter(appDir, { initialUrl: `/reset-password?code=${CODE}` });

    expect(await screen.findByText(title)).toBeOnTheScreen();
    expect(useSessionStore.getState()).toMatchObject({ recovering: false, status: 'signedOut' });
    expect(fakeAuthStorage.holdInMemory).not.toHaveBeenCalled();
  });

  it('asks for the email link when opened without one', async () => {
    await renderRouter(appDir, { initialUrl: '/reset-password' });

    expect(screen.getByText('Open the link from your email')).toBeOnTheScreen();
  });

  it('Cancel ends the reset session without the "session ended" message', async () => {
    const router = await renderRouter(appDir, { initialUrl: `/reset-password?code=${CODE}` });
    await screen.findByText('Choose a new password');

    await fireEvent.press(screen.getByRole('link', { name: 'Back to cancel' }));

    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'));
    expect(fakeAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useSessionStore.getState()).toMatchObject({ recovering: false, notice: null });
  });

  it('does not sign out someone already signed in who opens an old link', async () => {
    resetFakeSupabase(fakeSession());
    const router = await renderRouter(appDir, {
      initialUrl: '/reset-password?error=access_denied&error_code=otp_expired',
    });
    expect(screen.getByText('This link has expired')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Back to sign in' }));

    await waitFor(() => expect(router.getPathname()).toBe('/home'));
    expect(fakeAuth.signOut).not.toHaveBeenCalled();
  });
});
