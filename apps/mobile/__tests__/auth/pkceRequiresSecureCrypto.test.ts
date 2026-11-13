/** Sign-up and password reset start PKCE flows: without secure crypto they must refuse. */
import { SECURE_CRYPTO_ERROR } from '../../src/features/auth/authErrors';
import { requestPasswordReset, signIn, signUp } from '../../src/features/auth/authService';
import { fakeAuth, resetFakeSupabase } from '../../test-utils/fakeSupabase';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const nativeCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

beforeEach(() => {
  resetFakeSupabase(null);
  // Like Hermes without expo-crypto installed.
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
});

afterEach(() => {
  if (nativeCrypto) Object.defineProperty(globalThis, 'crypto', nativeCrypto);
});

it('refuses a password reset instead of using a weak verifier', async () => {
  await expect(requestPasswordReset('alex@example.com')).rejects.toThrow(SECURE_CRYPTO_ERROR);
  expect(fakeAuth.resetPasswordForEmail).not.toHaveBeenCalled();
});

it('refuses sign-up instead of using a weak verifier', async () => {
  const values = {
    fullName: 'Alex Reyes',
    email: 'alex@example.com',
    password: 'secret123',
    confirmPassword: 'secret123',
    acceptTerms: true,
    dataConsent: true,
  };
  await expect(signUp(values)).rejects.toThrow(SECURE_CRYPTO_ERROR);
  expect(fakeAuth.signUp).not.toHaveBeenCalled();
});

it('still allows password sign-in, which uses no PKCE', async () => {
  fakeAuth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  await expect(
    signIn({ email: 'alex@example.com', password: 'secret123', keepSignedIn: true }),
  ).resolves.toBeUndefined();
});
