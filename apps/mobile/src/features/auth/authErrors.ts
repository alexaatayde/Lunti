import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

export const NETWORK_ERROR = "Can't reach Lunti. Check your connection and try again.";
export const GENERIC_ERROR = 'Something went wrong. Please try again.';
export const NOT_CONFIGURED_ERROR = 'Sign-in is not set up for this build yet.';
/** This build can't create the secure one-time keys sign-up and password reset need. */
export const SECURE_CRYPTO_ERROR =
  "This version of Lunti can't do this securely. Update the app and try again.";

const messagesByCode: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  email_not_confirmed: 'Confirm your email first. Open the link we sent to your inbox.',
  user_already_exists: 'An account with this email already exists. Try signing in.',
  email_exists: 'An account with this email already exists. Try signing in.',
  weak_password: 'Choose a stronger password: at least 8 characters with a number.',
  email_address_invalid: 'Enter a valid email address.',
  over_email_send_rate_limit: 'Too many attempts. Wait a minute and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
  // Supabase's built-in mailer only sends to project team members until custom SMTP is set up.
  email_address_not_authorized:
    "We can't send a confirmation email to this address yet. Try another email.",
  signup_disabled: 'New sign-ups are turned off right now.',
  email_provider_disabled: 'Email sign-in is turned off right now.',
};

/** Turns a Supabase (or network) error into a short message for the user. */
export function authErrorMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error)) return NETWORK_ERROR;
  if (isAuthError(error) && error.code && messagesByCode[error.code]) {
    return messagesByCode[error.code];
  }
  // fetch() rejects with a TypeError when the device is offline.
  if (error instanceof TypeError && /network/i.test(error.message)) return NETWORK_ERROR;
  return GENERIC_ERROR;
}

export const RESET_SEND_ERROR = "We couldn't send a reset email right now. Please try again later.";
export const RATE_LIMIT_ERROR = 'Too many attempts. Wait a minute and try again.';

/**
 * Message for a failed "send reset link". Deliberately never says whether an account exists
 * for the address (that is decided by the caller, which treats "no such user" as sent).
 */
export function resetRequestErrorMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error)) return NETWORK_ERROR;
  if (error instanceof TypeError && /network/i.test(error.message)) return NETWORK_ERROR;
  if (isAuthError(error)) {
    if (error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') {
      return RATE_LIMIT_ERROR;
    }
    if (error.status === 429) return RATE_LIMIT_ERROR;
    if (error.code === 'email_address_invalid') return 'Enter a valid email address.';
  }
  return RESET_SEND_ERROR;
}

/** Errors on "Save new password" that mean the reset session is gone. */
export function isRecoverySessionGone(error: unknown): boolean {
  if (!isAuthError(error) || isAuthRetryableFetchError(error)) return false;
  return (
    error.name === 'AuthSessionMissingError' ||
    error.code === 'session_not_found' ||
    error.code === 'session_expired' ||
    error.code === 'bad_jwt' ||
    error.status === 401 ||
    error.status === 403
  );
}

const newPasswordMessages: Record<string, string> = {
  same_password: 'Choose a password different from your current one.',
  weak_password: messagesByCode.weak_password,
  over_request_rate_limit: RATE_LIMIT_ERROR,
};

/** Message for a failed "Save new password" that isn't an ended reset session. */
export function newPasswordErrorMessage(error: unknown): string {
  if (isAuthError(error) && error.code && newPasswordMessages[error.code]) {
    return newPasswordMessages[error.code];
  }
  return authErrorMessage(error);
}
