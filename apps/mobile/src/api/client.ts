/**
 * Typed client for the Lunti API, generated from the FastAPI OpenAPI spec:
 *   apps/api: python -m scripts.export_openapi  →  src/api/openapi.json
 *   apps/mobile: npm run api:generate          →  src/api/schema.d.ts
 *
 * Every request carries the Supabase access token. When the API rejects it (401), the session is
 * refreshed once and the request retried; see `authorized` for what happens when that fails.
 * Failures become an ApiError with a message safe to show on screen.
 */
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from '@supabase/supabase-js';
import createClient from 'openapi-fetch';

import { env } from '../lib/env';
import { supabase } from '../lib/supabase';
import { useSessionStore } from '../stores/session';
import type { components, paths } from './schema';

export type Problem = components['schemas']['Problem'];

export type ApiErrorKind =
  | 'config'
  | 'network'
  | 'unauthorized'
  | 'unverified'
  | 'validation'
  | 'not-found'
  | 'conflict'
  | 'unavailable'
  | 'server';

const MESSAGES: Record<ApiErrorKind, string> = {
  config: 'The app is not connected to the Lunti server yet.',
  network: "Can't reach Lunti. Check your connection and try again.",
  unauthorized: 'Your session ended. Please sign in again.',
  // The session was refreshed, yet the API still rejects it. Signing in again would not help
  // (and could loop); the usual cause is a phone clock that is far off.
  unverified:
    "Lunti couldn't verify your sign-in. Check that your phone's date and time are correct, then try again.",
  validation: 'Some details need fixing.',
  'not-found': "We couldn't find that.",
  conflict: 'That conflicts with something you already have.',
  unavailable: 'Lunti is temporarily unavailable. Please try again shortly.',
  server: 'Something went wrong. Please try again.',
};

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    /** The server's RFC 7807 body, when there is one (field errors live in problem.errors). */
    readonly problem?: Problem,
  ) {
    // Server details are short, user-facing sentences; fall back to a generic message.
    super(
      kind === 'validation' || kind === 'conflict'
        ? (problem?.detail ?? MESSAGES[kind])
        : MESSAGES[kind],
    );
    this.name = 'ApiError';
  }

  /** Worth retrying automatically (connection or temporary server trouble). */
  get transient() {
    return this.kind === 'network' || this.kind === 'unavailable';
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 403 || status === 422) return 'validation';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'server';
}

/**
 * Server root for the generated paths (which already start with /api/v1).
 * EXPO_PUBLIC_API_URL is documented as ".../api/v1", so that suffix is removed.
 */
export function apiBaseUrl(apiUrl: string = env.apiUrl): string {
  return apiUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/, '');
}

/**
 * Give up on a request that gets no response in this time. Without it, a wrong or unreachable
 * API address leaves the request (and the screen's loading state) waiting on the OS connect
 * timeout, which can be minutes.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Rejects with a retryable network error if `promise` takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError('network', 0)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The current access token. Bounded by the request timeout too: right after a cold start,
 * Supabase may still be restoring or refreshing the saved session, and a stuck lookup would
 * otherwise leave the screen loading forever. The query retry then asks again.
 *
 * Supabase refreshes an expired token here by itself. If that refresh could not reach the
 * server, the saved session is still there but no token comes back: that is a connection
 * problem, not a signed-out user, so it must not turn into a 401 "session ended".
 */
async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await withTimeout(supabase.auth.getSession(), REQUEST_TIMEOUT_MS);
  const token = data.session?.access_token ?? null;
  if (!token && error && !isDefinitiveRejection(error)) throw new ApiError('network', 0);
  return token;
}

/**
 * Supabase Auth refused the refresh token itself (revoked, expired, already used, user gone),
 * or there is no session left to refresh. Anything else — offline, timeout, rate limit, an
 * Auth server error — is temporary and must never sign the user out.
 */
export function isDefinitiveRejection(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  if (isAuthRetryableFetchError(error) || !isAuthApiError(error)) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

type RefreshOutcome =
  | { kind: 'token'; token: string }
  /** The session is over: the user must sign in again. */
  | { kind: 'rejected' }
  /** Couldn't refresh right now (offline, timeout, Auth server trouble). */
  | { kind: 'unavailable' };

/** One refresh at a time: requests that fail together share it instead of each refreshing. */
let refreshing: Promise<RefreshOutcome> | null = null;

/**
 * A token to retry with after `rejectedToken` got a 401. If another request already refreshed
 * the session meanwhile, its newer token is reused instead of refreshing again.
 */
async function replacementToken(rejectedToken: string): Promise<RefreshOutcome> {
  if (!supabase) return { kind: 'rejected' };
  const auth = supabase.auth;
  refreshing ??= (async (): Promise<RefreshOutcome> => {
    try {
      const current = await withTimeout(auth.getSession(), REQUEST_TIMEOUT_MS);
      const latest = current.data.session?.access_token;
      if (latest && latest !== rejectedToken) return { kind: 'token', token: latest };

      const { data, error } = await withTimeout(auth.refreshSession(), REQUEST_TIMEOUT_MS);
      if (data.session?.access_token) return { kind: 'token', token: data.session.access_token };
      return error && isDefinitiveRejection(error) ? { kind: 'rejected' } : { kind: 'unavailable' };
    } catch {
      return { kind: 'unavailable' };
    }
  })().finally(() => {
    refreshing = null;
  });
  const outcome = await refreshing;
  if (outcome.kind === 'rejected') await endSession();
  return outcome;
}

/**
 * Clears the dead session on this device. Supabase usually does this itself when it refuses a
 * refresh, but not when the old access token still looks valid to the phone's clock. The auth
 * listener sees a sign-out the user didn't ask for, shows "Your session ended…", and the route
 * guard opens Welcome. Runs at most once per session: later failures find it signed out.
 */
async function endSession() {
  if (!supabase || useSessionStore.getState().status !== 'signedIn') return;
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
}

/**
 * Our API rejected the token in its auth check (it always sends `WWW-Authenticate: Bearer` with
 * those 401s). That check runs before any route code, so nothing was saved and the request is
 * safe to send again, even a POST.
 */
function isTokenRejection(response: Response): boolean {
  return (
    response.status === 401 &&
    /^bearer\b/i.test(response.headers.get('WWW-Authenticate') ?? '')
  );
}

/**
 * Sends a request with the user's token. On a token rejection:
 * - refreshed → retried once with the new token; a second 401 is `unverified` (no sign-out,
 *   so no sign-in/sign-out loop);
 * - refresh refused by Supabase → the local session is cleared (`unauthorized`);
 * - refresh not possible right now → `network` (retryable; the user stays signed in).
 */
async function authorized(send: (token: string | null) => Promise<Response>) {
  const token = await accessToken();
  const response = await send(token);
  if (!token || !isTokenRejection(response)) return response;

  const outcome = await replacementToken(token);
  if (outcome.kind === 'rejected') throw new ApiError('unauthorized', 401);
  if (outcome.kind === 'unavailable') throw new ApiError('network', 0);
  if (outcome.token === token) throw new ApiError('unverified', 401);
  const retried = await send(outcome.token);
  if (retried.status === 401) throw new ApiError('unverified', 401);
  return retried;
}

async function send(request: Request, token: string | null): Promise<Response> {
  const attempt = request.clone();
  if (token) attempt.headers.set('Authorization', `Bearer ${token}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const cancel = () => controller.abort();
  request.signal?.addEventListener?.('abort', cancel);
  try {
    return await globalThis.fetch(attempt, { signal: controller.signal });
  } catch {
    // fetch only rejects when the request never got a response (offline, DNS, refused,
    // timed out).
    throw new ApiError('network', 0);
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener?.('abort', cancel);
  }
}

/** fetch with the user's token, refreshing it if the API rejects it (see `authorized`). */
export function authFetch(request: Request): Promise<Response> {
  return authorized((token) => send(request, token));
}

export const api = createClient<paths>({
  baseUrl: apiBaseUrl(),
  fetch: authFetch,
});

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/**
 * Runs a request and returns its data, or throws an ApiError (use in TanStack Query functions):
 *   unwrap(() => api.GET('/api/v1/me'))
 */
export async function unwrap<T>(call: () => Promise<FetchResult<T>>): Promise<T> {
  if (!apiBaseUrl()) throw new ApiError('config', 0);
  let result: FetchResult<T>;
  try {
    result = await call();
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError('network', 0);
  }
  const { data, error, response } = result;
  if (response.ok) return data as T;
  const problem = isProblem(error) ? error : undefined;
  throw new ApiError(kindForStatus(response.status), response.status, problem);
}

function isProblem(value: unknown): value is Problem {
  return typeof value === 'object' && value !== null && 'type' in value && 'status' in value;
}

/** Receipt uploads send a photo and wait for OCR: allow more time than a normal request. */
export const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * POST a multipart form (openapi-fetch can't stream React Native file parts). `makeBody`
 * builds a fresh FormData per attempt, so the refresh-and-retry after a 401 resends the photo.
 * Returns the parsed JSON and the status (200 = the server already had this upload).
 */
export async function postForm<T>(
  path: string,
  makeBody: () => FormData,
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
): Promise<{ data: T; status: number }> {
  const base = apiBaseUrl();
  if (!base) throw new ApiError('config', 0);

  const attempt = async (token: string | null): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // No Content-Type header: fetch adds the multipart boundary itself.
      return await globalThis.fetch(`${base}${path}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: makeBody(),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError('network', 0);
    } finally {
      clearTimeout(timer);
    }
  };

  const response = await authorized(attempt);
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) return { data: body as T, status: response.status };
  throw new ApiError(
    kindForStatus(response.status),
    response.status,
    isProblem(body) ? body : undefined,
  );
}
