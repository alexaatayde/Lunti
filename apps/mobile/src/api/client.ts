/**
 * Typed client for the Lunti API, generated from the FastAPI OpenAPI spec:
 *   apps/api: python -m scripts.export_openapi  →  src/api/openapi.json
 *   apps/mobile: npm run api:generate          →  src/api/schema.d.ts
 *
 * Every request carries the Supabase access token. On a 401 the token is refreshed once and
 * the request retried. Failures become an ApiError with a message safe to show on screen.
 */
import createClient from 'openapi-fetch';

import { env } from '../lib/env';
import { supabase } from '../lib/supabase';
import type { components, paths } from './schema';

export type Problem = components['schemas']['Problem'];

export type ApiErrorKind =
  | 'config'
  | 'network'
  | 'unauthorized'
  | 'validation'
  | 'not-found'
  | 'conflict'
  | 'unavailable'
  | 'server';

const MESSAGES: Record<ApiErrorKind, string> = {
  config: 'The app is not connected to the Lunti server yet.',
  network: "Can't reach Lunti. Check your connection and try again.",
  unauthorized: 'Your session has ended. Please sign in again.',
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
 */
async function accessToken(refresh: boolean): Promise<string | null> {
  if (!supabase) return null;
  const lookup: Promise<{ data: { session: { access_token: string } | null } }> = refresh
    ? supabase.auth.refreshSession()
    : supabase.auth.getSession();
  const { data } = await withTimeout(lookup, REQUEST_TIMEOUT_MS);
  return data.session?.access_token ?? null;
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

/** fetch with the user's token; refreshes and retries once if the API says 401. */
export async function authFetch(request: Request): Promise<Response> {
  const token = await accessToken(false);
  const response = await send(request, token);
  if (response.status !== 401 || !token) return response;
  const refreshed = await accessToken(true).catch(() => null);
  if (!refreshed || refreshed === token) return response;
  return send(request, refreshed);
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
 * builds a fresh FormData per attempt, so the 401 refresh-and-retry resends the photo.
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

  const token = await accessToken(false);
  let response = await attempt(token);
  if (response.status === 401 && token) {
    const refreshed = await accessToken(true).catch(() => null);
    if (refreshed && refreshed !== token) response = await attempt(refreshed);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) return { data: body as T, status: response.status };
  throw new ApiError(
    kindForStatus(response.status),
    response.status,
    isProblem(body) ? body : undefined,
  );
}
