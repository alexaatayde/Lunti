import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

export const NETWORK_ERROR = "Can't reach Lunti. Check your connection and try again.";
export const GENERIC_ERROR = 'Something went wrong. Please try again.';
export const NOT_CONFIGURED_ERROR = 'Sign-in is not set up for this build yet.';

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
