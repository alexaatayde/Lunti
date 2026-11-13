/**
 * PKCE must use a cryptographically secure verifier and an S256 challenge, never supabase-js's
 * Math.random / `plain` fallback. Node (Jest) has Web Crypto built in, so each test removes it
 * to behave like Hermes, where only expo-crypto (mocked here onto Node's CSPRNG) is available.
 */
import { createClient } from '@supabase/supabase-js';
import * as ExpoCrypto from 'expo-crypto';

import { installWebCrypto, secureCryptoAvailable } from '../../src/lib/webCrypto';

// The platform's real Web Crypto, captured before the tests remove it from globalThis.
const platform: Crypto = globalThis.crypto;

// expo-crypto stand-in backed by the platform CSPRNG and SHA-256 (the native module isn't
// available under Jest).
jest.mock('expo-crypto', () => {
  const real: Crypto = globalThis.crypto;
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomValues: jest.fn((array: Uint8Array<ArrayBuffer>) => real.getRandomValues(array)),
    digest: jest.fn((_algorithm: string, data: BufferSource) => real.subtle.digest('SHA-256', data)),
  };
});

const expoCrypto = ExpoCrypto as jest.Mocked<typeof ExpoCrypto>;
const nativeCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

/** Like Hermes: no global crypto at all. */
function removeGlobalCrypto() {
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
}

beforeEach(() => {
  removeGlobalCrypto();
  jest.clearAllMocks();
});

afterAll(() => {
  if (nativeCrypto) Object.defineProperty(globalThis, 'crypto', nativeCrypto);
});

const bytesOf = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer));

const sha256 = async (text: string) =>
  platform.subtle.digest('SHA-256', new TextEncoder().encode(text));

const base64url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

describe('installWebCrypto', () => {
  it('reports no secure crypto before it is installed (Hermes)', () => {
    expect(secureCryptoAvailable()).toBe(false);
  });

  it('provides getRandomValues and SHA-256 from expo-crypto', async () => {
    installWebCrypto();

    expect(secureCryptoAvailable()).toBe(true);
    const bytes = crypto.getRandomValues(new Uint32Array(56));
    expect(expoCrypto.getRandomValues).toHaveBeenCalledWith(bytes);
    expect(new Set(bytes).size).toBeGreaterThan(50); // not all zeros / constant

    const data = new TextEncoder().encode('lunti');
    const hash = await crypto.subtle.digest('SHA-256', data);
    expect(bytesOf(hash)).toEqual(bytesOf(await sha256('lunti')));
  });

  it('refuses digests other than SHA-256 instead of guessing', async () => {
    installWebCrypto();

    await expect(crypto.subtle.digest('SHA-1', new Uint8Array(1))).rejects.toThrow(
      'Unsupported digest algorithm: SHA-1',
    );
    await expect(crypto.subtle.digest({ name: 'sha-256' }, new Uint8Array(1))).resolves.toBeDefined();
  });

  it('keeps a runtime’s own Web Crypto', () => {
    const own = { getRandomValues: jest.fn(), subtle: { digest: jest.fn() } };
    const host = { crypto: own } as never;

    installWebCrypto(host);

    expect((host as { crypto: unknown }).crypto).toBe(own);
    expect(own.getRandomValues).not.toHaveBeenCalled();
  });

  it('reports false when the native module is missing (no silent fallback)', () => {
    installWebCrypto();
    expoCrypto.getRandomValues.mockImplementationOnce(() => {
      throw new Error("Cannot find native module 'ExpoCrypto'");
    });

    expect(secureCryptoAvailable()).toBe(false);
  });
});

describe('supabase-js PKCE with the installed crypto', () => {
  async function requestReset() {
    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const store = new Map<string, string>();
    const client = createClient('https://project.supabase.test', 'anon-key', {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'lunti.auth',
        storage: {
          getItem: async (k: string) => store.get(k) ?? null,
          setItem: async (k: string, v: string) => void store.set(k, v),
          removeItem: async (k: string) => void store.delete(k),
        },
      },
      global: { fetch: fetchMock as unknown as typeof fetch },
    });
    const { error } = await client.auth.resetPasswordForEmail('alex@example.com', {
      redirectTo: 'lunti://reset-password',
    });
    expect(error).toBeNull();
    const recover = fetchMock.mock.calls.find(([url]) => String(url).includes('/recover'));
    const body = JSON.parse(String(recover?.[1]?.body));
    // Stored JSON-encoded as "<verifier>/PASSWORD_RECOVERY".
    const verifier = String(JSON.parse(store.get('lunti.auth-code-verifier') ?? '""')).split('/')[0];
    return { body, verifier };
  }

  it('sends an S256 challenge of a CSPRNG verifier, never Math.random or plain', async () => {
    installWebCrypto();
    const random = jest.spyOn(Math, 'random');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { body, verifier } = await requestReset();

    expect(body.code_challenge_method).toBe('s256');
    // supabase-js: 56 random 32-bit values → 112 hex characters.
    expect(verifier).toMatch(/^[0-9a-f]{112}$/);
    expect(body.code_challenge).toBe(base64url(await sha256(verifier)));
    expect(body.code_challenge).not.toBe(verifier);
    expect(expoCrypto.getRandomValues).toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('WebCrypto API is not supported'));
    random.mockRestore();
    warn.mockRestore();
  });

  it('documents the fallback this guards against: without crypto, supabase-js goes plain', async () => {
    const random = jest.spyOn(Math, 'random');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { body } = await requestReset();

    expect(body.code_challenge_method).toBe('plain');
    expect(random).toHaveBeenCalled();
    random.mockRestore();
    warn.mockRestore();
  });

  it('keeps fresh verifiers per request', async () => {
    installWebCrypto();
    const first = await requestReset();
    const second = await requestReset();
    expect(first.verifier).not.toBe(second.verifier);
  });
});
