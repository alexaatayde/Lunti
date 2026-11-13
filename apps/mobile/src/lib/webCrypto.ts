/**
 * Web Crypto for supabase-js PKCE (password reset, sign-up links).
 *
 * supabase-js builds the PKCE verifier with the global `crypto.getRandomValues` and the S256
 * challenge with `crypto.subtle.digest('SHA-256')`. Hermes has neither, and without them
 * supabase-js silently falls back to `Math.random` and a `plain` challenge. This installs the
 * two functions from expo-crypto (native, OS-backed CSPRNG and SHA-256; available in Expo Go
 * and dev/release builds) — no cryptography is implemented here.
 *
 * Auth calls that start a PKCE flow must check `secureCryptoAvailable()` first and refuse to
 * run without it, so the weak fallback can never be used.
 */
import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';

type RandomSource = <T extends ArrayBufferView | null>(array: T) => T;
type Digest = (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer>;

type CryptoLike = {
  getRandomValues?: RandomSource;
  subtle?: { digest?: Digest } & Record<string, unknown>;
} & Record<string, unknown>;

type Host = { crypto?: CryptoLike };

function algorithmName(algorithm: AlgorithmIdentifier): string {
  return (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase();
}

/** SHA-256 only: the one digest supabase-js asks for. Anything else is refused, not guessed. */
const sha256Digest: Digest = async (algorithm, data) => {
  const name = algorithmName(algorithm);
  if (name !== 'SHA-256') throw new Error(`Unsupported digest algorithm: ${name}`);
  return digest(CryptoDigestAlgorithm.SHA256, data);
};

const randomValues: RandomSource = (array) => {
  getRandomValues(array as never);
  return array;
};

/**
 * Adds `crypto.getRandomValues` and `crypto.subtle.digest` where the runtime lacks them.
 * Native implementations that already exist are kept. Safe to call more than once.
 */
export function installWebCrypto(host: Host = globalThis as unknown as Host): void {
  const current = host.crypto;
  if (typeof current?.getRandomValues === 'function' && typeof current.subtle?.digest === 'function') {
    return;
  }
  const target: CryptoLike = current ?? {};
  if (typeof target.getRandomValues !== 'function') target.getRandomValues = randomValues;
  if (typeof target.subtle?.digest !== 'function') {
    target.subtle = { ...(target.subtle ?? {}), digest: sha256Digest };
  }
  if (!current) {
    Object.defineProperty(host, 'crypto', { value: target, configurable: true, writable: true });
  }
}

/**
 * True when PKCE can use a secure random verifier and an S256 challenge. Draws one random
 * byte, so a build whose expo-crypto native module is missing reports false instead of
 * failing later inside supabase-js.
 */
export function secureCryptoAvailable(host: Host = globalThis as unknown as Host): boolean {
  const c = host.crypto;
  if (typeof c?.getRandomValues !== 'function' || typeof c.subtle?.digest !== 'function') {
    return false;
  }
  if (typeof TextEncoder === 'undefined') return false;
  try {
    c.getRandomValues(new Uint8Array(1));
    return true;
  } catch {
    return false;
  }
}
