/**
 * Sign-up, sign-in and sign-out through Supabase Auth (SRS 3.5.1).
 * Screens don't navigate after success: the session listener updates the store and the
 * protected routes in app/_layout.tsx move the user to the right place.
 */
import { isAuthApiError, isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { AUTH_STORAGE_KEY, authStorage, supabase } from '../../lib/supabase';
import { secureCryptoAvailable } from '../../lib/webCrypto';
import { useSessionStore } from '../../stores/session';
import { unregisterFromPush } from '../notifications/push';
import {
  authErrorMessage,
  isRecoverySessionGone,
  newPasswordErrorMessage,
  NOT_CONFIGURED_ERROR,
  resetRequestErrorMessage,
  SECURE_CRYPTO_ERROR,
} from './authErrors';
import type { SignInValues, SignUpValues } from './schemas';
import { intendedSignOut } from './signOutIntent';

/** Thrown with a message that is safe to show on screen. */
export class AuthFailure extends Error {}

function client() {
  if (!supabase) throw new AuthFailure(NOT_CONFIGURED_ERROR);
  return supabase;
}

/**
 * For calls that start a PKCE flow (sign-up, password reset). supabase-js would otherwise
 * fall back to Math.random and a plain challenge; refuse instead.
 */
function pkceClient() {
  const auth = client().auth;
  if (!secureCryptoAvailable()) throw new AuthFailure(SECURE_CRYPTO_ERROR);
  return auth;
}

/** Calls Supabase and turns any error (returned or thrown) into an AuthFailure. */
async function run<T extends { error: unknown }>(request: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await request();
  } catch (error) {
    throw new AuthFailure(authErrorMessage(error));
  }
  if (result.error) throw new AuthFailure(authErrorMessage(result.error));
  return result;
}

export async function signIn({ email, password, keepSignedIn }: SignInValues) {
  const auth = client().auth;
  // Must be set before the session is saved: off = keep it in memory only.
  authStorage.setPersist(keepSignedIn);
  await run(() => auth.signInWithPassword({ email, password }));
}

export type SignUpResult =
  /** Email confirmation is off: the user is signed in. */
  | { status: 'signedIn' }
  /** Email confirmation is on: the user must open the link, then sign in. */
  | { status: 'confirmEmail'; email: string };

export async function signUp({ fullName, email, password }: SignUpValues): Promise<SignUpResult> {
  const auth = pkceClient();
  authStorage.setPersist(true);
  const consentedAt = new Date().toISOString();
  const { data } = await run(() =>
    auth.signUp({
      email,
      password,
      options: {
        // Recorded with the account so the profiles table (build step 2) can copy them.
        data: {
          full_name: fullName,
          terms_accepted_at: consentedAt,
          data_consent_at: consentedAt,
        },
      },
    }),
  );
  return data.session ? { status: 'signedIn' } : { status: 'confirmEmail', email };
}

/** Always clears the session on this device, even when offline. */
export async function signOut() {
  if (!supabase) return;
  const auth = supabase.auth;
  await unregisterFromPush(); // while still signed in, so the API knows whose token it is
  try {
    await intendedSignOut(() => auth.signOut({ scope: 'local' }));
  } finally {
    authStorage.setPersist(true);
  }
}

// ---------- password reset (Supabase Auth recovery, PKCE) ----------

/** Path the reset email links back to: lunti://reset-password in a build, exp://…/--/ in Expo Go. */
export const RESET_PASSWORD_PATH = 'reset-password';

export function resetRedirectUrl() {
  return Linking.createURL(RESET_PASSWORD_PATH);
}

/**
 * Asks Supabase to email a reset link. Resolves the same way whether or not an account exists
 * for the address, so the screen can't be used to find out who has an account.
 */
export async function requestPasswordReset(email: string) {
  const auth = pkceClient();
  let error: unknown;
  try {
    ({ error } = await auth.resetPasswordForEmail(email, { redirectTo: resetRedirectUrl() }));
  } catch (thrown) {
    error = thrown;
  }
  if (!error) return;
  if (isAuthError(error) && error.code === 'user_not_found') return;
  throw new AuthFailure(resetRequestErrorMessage(error));
}

export type RecoveryFailure =
  /** Expired, already used, or not a valid link. */
  | 'expired'
  /** The link was opened on a different phone (or app install) than the one that asked. */
  | 'otherDevice'
  /** The link couldn't be checked (offline). PKCE codes can't be retried: ask for a new one. */
  | 'network';

export class RecoveryLinkFailure extends Error {
  constructor(readonly reason: RecoveryFailure) {
    super(reason);
  }
}

/**
 * Trades the one-time code from the reset link for a temporary session that may only change
 * the password. The session is kept in memory: closing the app ends the reset.
 */
export async function startPasswordRecovery(code: string) {
  const auth = client().auth;
  useSessionStore.getState().setRecovering(true);
  let error: unknown;
  try {
    ({ error } = await auth.exchangeCodeForSession(code));
  } catch (thrown) {
    error = thrown;
  }
  if (error) {
    useSessionStore.getState().setRecovering(false);
    throw new RecoveryLinkFailure(recoveryFailureReason(error));
  }
  await authStorage.holdInMemory(AUTH_STORAGE_KEY);
}

function recoveryFailureReason(error: unknown): RecoveryFailure {
  if (isAuthError(error) && error.name === 'AuthPKCECodeVerifierMissingError') return 'otherDevice';
  if (isAuthRetryableFetchError(error)) return 'network';
  if (isAuthApiError(error) && error.status >= 500) return 'network';
  if (error instanceof TypeError) return 'network';
  return 'expired';
}

/** Thrown by `setNewPassword` when the reset session has ended: the user needs a new link. */
export class RecoverySessionEnded extends Error {}

/**
 * Saves the new password, then signs out everywhere (any session someone else might hold
 * ends too). The user then signs in with the new password.
 */
export async function setNewPassword(password: string) {
  const auth = client().auth;
  let error: unknown;
  try {
    ({ error } = await auth.updateUser({ password }));
  } catch (thrown) {
    error = thrown;
  }
  if (error) {
    if (isRecoverySessionGone(error)) throw new RecoverySessionEnded();
    throw new AuthFailure(newPasswordErrorMessage(error));
  }
  await endRecovery('global');
}

/**
 * Leaves the reset session. 'global' also ends the account's sessions on other devices; if
 * that can't reach Supabase, this device is still signed out.
 */
export async function endRecovery(scope: 'global' | 'local' = 'local') {
  if (!supabase) return;
  const auth = supabase.auth;
  try {
    await intendedSignOut(async () => {
      const { error } = await auth.signOut({ scope });
      if (error && scope === 'global') await auth.signOut({ scope: 'local' });
    });
  } catch {
    await intendedSignOut(() => auth.signOut({ scope: 'local' })).catch(() => undefined);
  } finally {
    authStorage.setPersist(true);
    useSessionStore.getState().setRecovering(false);
  }
}
