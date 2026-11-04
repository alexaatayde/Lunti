/**
 * Sign-up, sign-in and sign-out through Supabase Auth (SRS 3.5.1).
 * Screens don't navigate after success: the session listener updates the store and the
 * protected routes in app/_layout.tsx move the user to the right place.
 */
import { authStorage, supabase } from '../../lib/supabase';
import { authErrorMessage, NOT_CONFIGURED_ERROR } from './authErrors';
import type { SignInValues, SignUpValues } from './schemas';

/** Thrown with a message that is safe to show on screen. */
export class AuthFailure extends Error {}

function client() {
  if (!supabase) throw new AuthFailure(NOT_CONFIGURED_ERROR);
  return supabase;
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
  const auth = client().auth;
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
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } finally {
    authStorage.setPersist(true);
  }
}
