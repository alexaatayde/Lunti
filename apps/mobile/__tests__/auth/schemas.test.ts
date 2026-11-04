import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js';

import { authErrorMessage, GENERIC_ERROR, NETWORK_ERROR } from '../../src/features/auth/authErrors';
import { passwordStrength, signInSchema, signUpSchema } from '../../src/features/auth/schemas';

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
