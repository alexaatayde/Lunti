import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js';

import { authErrorMessage, GENERIC_ERROR, NETWORK_ERROR } from '../../src/features/auth/authErrors';
import {
  forgotPasswordSchema,
  passwordStrength,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from '../../src/features/auth/schemas';
import { parseRecoveryLink, fragmentParams } from '../../src/features/auth/recoveryLink';

const validSignUp = {
  fullName: 'Alex Reyes',
  email: 'alex@example.com',
  password: 'leafygreens24',
  confirmPassword: 'leafygreens24',
  acceptTerms: true,
  dataConsent: true,
};

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe('signInSchema', () => {
  it('trims the email', () => {
    const result = signInSchema.parse({
      email: '  alex@example.com  ',
      password: 'x',
      keepSignedIn: true,
    });
    expect(result.email).toBe('alex@example.com');
  });
});

describe('signUpSchema', () => {
  it('accepts a complete form', () => {
    expect(signUpSchema.safeParse(validSignUp).success).toBe(true);
  });

  it.each([
    [{ password: 'short1', confirmPassword: 'short1' }, 'Use at least 8 characters.'],
    [{ password: 'nonumbers', confirmPassword: 'nonumbers' }, 'Add at least one number.'],
    [
      { password: `${'a'.repeat(72)}1`, confirmPassword: `${'a'.repeat(72)}1` },
      'Use 72 characters or fewer.',
    ],
    [{ confirmPassword: 'different1' }, "Passwords don't match."],
    [{ fullName: '   ' }, 'Enter your full name.'],
    [{ acceptTerms: false }, 'Accept the Terms of Use and Privacy Notice to continue.'],
    [{ dataConsent: false }, 'Consent to data processing to continue.'],
  ])('rejects %o', (override, message) => {
    expect(messages(signUpSchema.safeParse({ ...validSignUp, ...override }))).toContain(message);
  });
});

describe('passwordStrength', () => {
  it.each([
    ['', 0, ''],
    ['abc', 1, 'Too short'],
    ['abcdefgh', 1, 'Weak'],
    ['abcdefg1', 2, 'Fair'],
    ['leafygreens24', 3, 'Good'],
    ['Leafygreens24!', 4, 'Strong'],
  ])('%s → %i %s', (password, score, label) => {
    expect(passwordStrength(password)).toEqual({ score, label });
  });
});

describe('authErrorMessage', () => {
  it('maps known Supabase codes', () => {
    expect(authErrorMessage(new AuthApiError('x', 400, 'invalid_credentials'))).toBe(
      'Email or password is incorrect.',
    );
    expect(authErrorMessage(new AuthApiError('x', 400, 'email_not_confirmed'))).toMatch(
      /Confirm your email/,
    );
    expect(
      authErrorMessage(
        new AuthApiError('Email address not authorized', 400, 'email_address_not_authorized'),
      ),
    ).toMatch(/can't send a confirmation email/);
    expect(authErrorMessage(new AuthWeakPasswordError('x', 422, ['length']))).toMatch(
      /stronger password/,
    );
  });

  it('detects network failures', () => {
    expect(authErrorMessage(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(NETWORK_ERROR);
    expect(authErrorMessage(new TypeError('Network request failed'))).toBe(NETWORK_ERROR);
  });

  it('falls back to a generic message without leaking details', () => {
    expect(
      authErrorMessage(new AuthApiError('db exploded at row 7', 500, 'unexpected_failure')),
    ).toBe(GENERIC_ERROR);
    expect(authErrorMessage('weird')).toBe(GENERIC_ERROR);
  });
});

describe('password reset schemas', () => {
  it('trims and checks the email', () => {
    expect(forgotPasswordSchema.parse({ email: ' a@b.co ' })).toEqual({ email: 'a@b.co' });
    expect(forgotPasswordSchema.safeParse({ email: 'a@' }).success).toBe(false);
  });

  it('applies the sign-up password rules to the new password', () => {
    const ok = resetPasswordSchema.safeParse({ password: 'newpass123', confirmPassword: 'newpass123' });
    expect(ok.success).toBe(true);
    const messages = (password: string, confirmPassword = password) =>
      resetPasswordSchema
        .safeParse({ password, confirmPassword })
        .error?.issues.map((i) => i.message);
    expect(messages('short1')).toContain('Use at least 8 characters.');
    expect(messages('nonumbers')).toContain('Add at least one number.');
    expect(messages('x1'.repeat(37))).toContain('Use 72 characters or fewer.');
    expect(messages('newpass123', 'newpass12')).toContain("Passwords don't match.");
  });
});

describe('parseRecoveryLink', () => {
  const code = '6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b';

  it('reads the one-time code', () => {
    expect(parseRecoveryLink({ code })).toEqual({ kind: 'code', code });
  });

  it('treats Supabase errors (query or fragment) as an expired link', () => {
    expect(parseRecoveryLink({ error: 'access_denied', error_code: 'otp_expired' })).toEqual({
      kind: 'error',
      reason: 'expired',
    });
    const fragment = fragmentParams('lunti://reset-password#error=access_denied&error_code=otp_expired');
    expect(parseRecoveryLink({}, fragment)).toEqual({ kind: 'error', reason: 'expired' });
    // An error wins over a code.
    expect(parseRecoveryLink({ code, error: 'x' }).kind).toBe('error');
  });

  it('refuses malformed codes instead of sending them to Supabase', () => {
    expect(parseRecoveryLink({ code: '<script>' })).toEqual({ kind: 'error', reason: 'expired' });
  });

  it('reports no link when there is nothing to read', () => {
    expect(parseRecoveryLink({})).toEqual({ kind: 'none' });
    expect(fragmentParams(null)).toEqual({});
    expect(fragmentParams('lunti://reset-password')).toEqual({});
  });
});
