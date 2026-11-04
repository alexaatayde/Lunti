/**
 * In-memory stand-in for src/lib/supabase in tests. Use with:
 *   jest.mock('../src/lib/supabase', () => require('../test-utils/fakeSupabase').supabaseModuleMock);
 * It behaves like Supabase Auth's listener: INITIAL_SESSION on subscribe, then SIGNED_IN /
 * SIGNED_OUT when `setFakeSession` is called.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

const listeners = new Set<Listener>();
let current: Session | null = null;

export function fakeSession(email = 'alex@example.com'): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

/** Changes the session and notifies listeners, like a real sign-in, sign-out or expiry. */
export function setFakeSession(session: Session | null) {
  current = session;
  listeners.forEach((listener) => listener(session ? 'SIGNED_IN' : 'SIGNED_OUT', session));
}

export const fakeAuth = {
  onAuthStateChange: jest.fn((listener: Listener) => {
    listeners.add(listener);
    listener('INITIAL_SESSION', current);
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  }),
  signInWithPassword: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn(),
};

export const fakeAuthStorage = { setPersist: jest.fn() };

export const supabaseModuleMock = {
  supabase: { auth: fakeAuth },
  authStorage: fakeAuthStorage,
  isSupabaseConfigured: true,
  missingSupabaseEnv: [],
};

/** Call in beforeEach: signed out, no listeners, default mock behaviour. */
export function resetFakeSupabase(session: Session | null = null) {
  listeners.clear();
  current = session;
  fakeAuth.onAuthStateChange.mockClear();
  fakeAuth.signInWithPassword.mockReset();
  fakeAuth.signUp.mockReset();
  fakeAuth.signOut.mockReset().mockImplementation(async () => {
    setFakeSession(null);
    return { error: null };
  });
  fakeAuthStorage.setPersist.mockClear();
}
