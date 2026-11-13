import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';

import {
  api,
  ApiError,
  apiBaseUrl,
  isDefinitiveRejection,
  postForm,
  REQUEST_TIMEOUT_MS,
  unwrap,
} from '../../src/api/client';
import { useSessionStore } from '../../src/stores/session';
import {
  fakeAuth,
  fakeSession,
  resetFakeSupabase,
  setFakeSession,
} from '../../test-utils/fakeSupabase';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);
jest.mock('../../src/lib/env', () => ({
  env: { apiUrl: 'https://api.lunti.test/api/v1', supabaseUrl: '', supabaseAnonKey: '' },
  missingSupabaseEnv: [],
}));

const me = {
  user_id: '00000000-0000-4000-8000-000000000001',
  email: 'alex@example.com',
  full_name: 'Alex Reyes',
  role: 'user',
  currency: 'PHP',
  terms_accepted_at: null,
  data_consent_at: null,
  created_at: '2026-11-04T00:00:00Z',
};

const json = (status: number, body: unknown, type = 'application/json') =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': type,
      // Like the API's auth check, which always says why a 401 happened.
      ...(status === 401 ? { 'WWW-Authenticate': 'Bearer error="invalid_token"' } : {}),
    },
  });

const problem = (status: number, slug: string, detail: string, errors: object[] = []) =>
  json(
    status,
    { type: `urn:lunti:problem:${slug}`, title: 'x', status, detail, errors },
    'application/problem+json',
  );

let fetchMock: jest.SpyInstance;

beforeEach(() => {
  const session = fakeSession();
  session.access_token = 'token-1';
  resetFakeSupabase(session);
  useSessionStore.setState({ status: 'signedIn', session });
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => fetchMock.mockRestore());

const sentAuth = (call: number) =>
  (fetchMock.mock.calls[call][0] as Request).headers.get('Authorization');

describe('API client', () => {
  it('maps the documented ".../api/v1" URL to the server root', () => {
    expect(apiBaseUrl('http://192.168.1.20:8000/api/v1')).toBe('http://192.168.1.20:8000');
    expect(apiBaseUrl('https://api.lunti.app/api/v1/')).toBe('https://api.lunti.app');
    expect(apiBaseUrl('https://api.lunti.app')).toBe('https://api.lunti.app');
  });

  it('calls the generated path with the Supabase access token', async () => {
    fetchMock.mockResolvedValue(json(200, me));

    const data = await unwrap(() => api.GET('/api/v1/me'));

    expect(data.full_name).toBe('Alex Reyes');
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe('https://api.lunti.test/api/v1/me');
    expect(sentAuth(0)).toBe('Bearer token-1');
  });

  it('sends JSON bodies for updates', async () => {
    const prefs = {
      notify_budget: true,
      notify_replenishment: false,
      notify_shopping: true,
      notify_meals: true,
      budget_alert_pct: 85,
    };
    fetchMock.mockResolvedValue(json(200, prefs));

    await unwrap(() => api.PUT('/api/v1/me/preferences', { body: prefs }));

    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.method).toBe('PUT');
    expect(await request.json()).toEqual(prefs);
  });

  it('refreshes an expired token once and retries', async () => {
    fakeAuth.refreshSession.mockResolvedValueOnce({
      data: { session: { ...fakeSession(), access_token: 'token-2' } },
      error: null,
    });
    fetchMock
      .mockResolvedValueOnce(problem(401, 'unauthorized', 'The access token has expired.'))
      .mockResolvedValueOnce(json(200, me));

    await expect(unwrap(() => api.GET('/api/v1/me'))).resolves.toMatchObject({ email: me.email });

    expect(fakeAuth.refreshSession).toHaveBeenCalledTimes(1);
    expect(sentAuth(0)).toBe('Bearer token-1');
    expect(sentAuth(1)).toBe('Bearer token-2');
  });

  it('stops after one retry, without signing out, if the refreshed token is also rejected', async () => {
    fakeAuth.refreshSession.mockResolvedValueOnce({
      data: { session: { ...fakeSession(), access_token: 'token-2' } },
      error: null,
    });
    fetchMock.mockImplementation(async () => problem(401, 'unauthorized', 'nope'));

    const error = await unwrap(() => api.GET('/api/v1/me')).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    // Signing in again would get the same rejection (e.g. a wrong phone clock): no loop.
    expect(error.kind).toBe('unverified');
    expect(error.transient).toBe(false);
    expect(error.message).toMatch(/couldn't verify your sign-in/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fakeAuth.refreshSession).toHaveBeenCalledTimes(1);
    expect(fakeAuth.signOut).not.toHaveBeenCalled();
  });

  it('signs out locally with "Your session ended" when Supabase rejects the refresh', async () => {
    fakeAuth.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token: Already Used', 400, 'refresh_token_already_used'),
    });
    fetchMock.mockResolvedValue(problem(401, 'unauthorized', 'The access token has expired.'));

    const error = await unwrap(() => api.GET('/api/v1/me')).catch((e) => e);

    expect(error.kind).toBe('unauthorized');
    expect(error.message).toBe('Your session ended. Please sign in again.');
    expect(fakeAuth.signOut).toHaveBeenCalledTimes(1);
    expect(fakeAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // not retried
  });

  it('does not sign out again when Supabase already cleared the rejected session', async () => {
    fakeAuth.refreshSession.mockImplementationOnce(async () => {
      setFakeSession(null); // Supabase removes the session and emits SIGNED_OUT itself
      useSessionStore.setState({ status: 'signedOut', session: null });
      return { data: { session: null }, error: new AuthApiError('Refresh Token Not Found', 400, 'refresh_token_not_found') };
    });
    fetchMock.mockResolvedValue(problem(401, 'unauthorized', 'expired'));

    await expect(unwrap(() => api.GET('/api/v1/me'))).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(fakeAuth.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ['offline', new AuthRetryableFetchError('Failed to fetch', 0)],
    ['Auth server error', new AuthApiError('Internal error', 500, 'unexpected_failure')],
    ['Auth server 503', new AuthApiError('Service unavailable', 503, undefined)],
    ['rate limited', new AuthApiError('Too many requests', 429, 'over_request_rate_limit')],
  ])('keeps the session when the refresh fails because %s', async (_label, refreshError) => {
    fakeAuth.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: refreshError });
    fetchMock.mockResolvedValue(problem(401, 'unauthorized', 'expired'));

    const error = await unwrap(() => api.GET('/api/v1/me')).catch((e) => e);

    expect(error.kind).toBe('network');
    expect(error.transient).toBe(true); // TanStack Query retries it
    expect(fakeAuth.signOut).not.toHaveBeenCalled();
  });

  it('keeps the session when the refresh itself throws or hangs', async () => {
    fakeAuth.refreshSession.mockRejectedValueOnce(new TypeError('Network request failed'));
    fetchMock.mockResolvedValue(problem(401, 'unauthorized', 'expired'));

    await expect(unwrap(() => api.GET('/api/v1/me'))).rejects.toMatchObject({ kind: 'network' });
    expect(fakeAuth.signOut).not.toHaveBeenCalled();
  });

  it('never treats an API 503 as a reason to refresh or sign out', async () => {
    fetchMock.mockResolvedValue(problem(503, 'service-unavailable', 'Database unavailable.'));

    const error = await unwrap(() => api.GET('/api/v1/me')).catch((e) => e);

    expect(error.kind).toBe('unavailable');
    expect(fakeAuth.refreshSession).not.toHaveBeenCalled();
    expect(fakeAuth.signOut).not.toHaveBeenCalled();
  });

  it('reports a connection problem (not "session ended") when the saved token cannot be refreshed offline', async () => {
    fakeAuth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    } as never);

    const error = await unwrap(() => api.GET('/api/v1/me')).catch((e) => e);

    expect(error.kind).toBe('network');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fakeAuth.signOut).not.toHaveBeenCalled();
  });

  it('shares one refresh between requests rejected at the same time', async () => {
    let finish!: () => void;
    fakeAuth.refreshSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ data: { session: { ...fakeSession(), access_token: 'token-2' } }, error: null });
        }),
    );
    fetchMock.mockImplementation(async (request: Request) =>
      request.headers.get('Authorization') === 'Bearer token-2'
        ? json(200, me)
        : problem(401, 'unauthorized', 'expired'),
    );

    const first = unwrap(() => api.GET('/api/v1/me'));
    const second = unwrap(() => api.GET('/api/v1/me'));
    await waitForCalls(() => fakeAuth.refreshSession.mock.calls.length === 1 && fetchMock.mock.calls.length === 2);
    finish();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fakeAuth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('reuses a token another request already refreshed instead of refreshing again', async () => {
    fetchMock
      .mockResolvedValueOnce(problem(401, 'unauthorized', 'expired'))
      .mockResolvedValueOnce(json(200, me));
    // By the time this request looks again, the session holds a newer token.
    fakeAuth.getSession
      .mockResolvedValueOnce({ data: { session: { ...fakeSession(), access_token: 'token-1' } }, error: null } as never)
      .mockResolvedValueOnce({ data: { session: { ...fakeSession(), access_token: 'token-9' } }, error: null } as never);

    await expect(unwrap(() => api.GET('/api/v1/me'))).resolves.toMatchObject({ email: me.email });
    expect(fakeAuth.refreshSession).not.toHaveBeenCalled();
    expect(sentAuth(1)).toBe('Bearer token-9');
  });

  it('does not replay a 401 that did not come from the API auth check', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } }),
    );

    await expect(unwrap(() => api.POST('/api/v1/devices', { body: { fcm_token: 't', platform: 'android' } } as never))).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fakeAuth.refreshSession).not.toHaveBeenCalled();
    expect(fakeAuth.signOut).not.toHaveBeenCalled();
  });

  it('refreshes and resends a multipart upload with a fresh body', async () => {
    fakeAuth.refreshSession.mockResolvedValueOnce({
      data: { session: { ...fakeSession(), access_token: 'token-2' } },
      error: null,
    });
    fetchMock
      .mockResolvedValueOnce(problem(401, 'unauthorized', 'expired'))
      .mockResolvedValueOnce(json(201, { id: 'r1' }));
    const makeBody = jest.fn(() => new FormData());

    await expect(postForm('/api/v1/receipts', makeBody)).resolves.toEqual({
      data: { id: 'r1' },
      status: 201,
    });
    expect(makeBody).toHaveBeenCalledTimes(2);
    const headers = (call: number) => fetchMock.mock.calls[call][1].headers as Record<string, string>;
    expect(headers(0).Authorization).toBe('Bearer token-1');
    expect(headers(1).Authorization).toBe('Bearer token-2');
  });

  it('signs out an upload whose refresh Supabase rejects', async () => {
    fakeAuth.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthSessionMissingError(),
    });
    fetchMock.mockResolvedValueOnce(problem(401, 'unauthorized', 'expired'));

    await expect(postForm('/api/v1/receipts', () => new FormData())).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(fakeAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('turns RFC 7807 validation problems into field errors', async () => {
    fetchMock.mockResolvedValue(
      problem(422, 'validation-error', 'The request has invalid fields.', [
        {
          field: 'budget_alert_pct',
          message: 'Input should be less than or equal to 100',
          code: 'x',
        },
      ]),
    );

    const error = await unwrap(() => api.GET('/api/v1/me/preferences')).catch((e) => e);

    expect(error.kind).toBe('validation');
    expect(error.message).toBe('The request has invalid fields.');
    expect(error.problem.errors[0].field).toBe('budget_alert_pct');
  });

  it.each([
    [409, 'conflict', 'A category named "Pets" already exists.'],
    [404, 'not-found', "We couldn't find that."],
    [503, 'unavailable', 'Lunti is temporarily unavailable. Please try again shortly.'],
    [500, 'server', 'Something went wrong. Please try again.'],
  ])('maps HTTP %i to "%s"', async (status, kind, message) => {
    fetchMock.mockResolvedValue(problem(status, 'x', 'A category named "Pets" already exists.'));

    const error = await unwrap(() => api.GET('/api/v1/categories')).catch((e) => e);

    expect(error.kind).toBe(kind);
    expect(error.message).toBe(message);
    expect(error.transient).toBe(status === 503);
  });

  it('reports a missing API URL as a configuration error without sending anything', async () => {
    const { env } = jest.requireMock('../../src/lib/env');
    env.apiUrl = '';
    try {
      const error = await unwrap(() => api.GET('/api/v1/me')).catch((e) => e);
      expect(error.kind).toBe('config');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      env.apiUrl = 'https://api.lunti.test/api/v1';
    }
  });

  it('reports offline / unreachable server as a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    const error = await unwrap(() => api.GET('/api/v1/me')).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('network');
    expect(error.transient).toBe(true);
  });

  it('gives up on a server that never answers instead of loading forever', async () => {
    jest.useFakeTimers();
    try {
      // Like an API address that no machine answers: fetch only settles when aborted.
      fetchMock.mockImplementation(
        (_req: Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
          }),
      );

      const pending = unwrap(() => api.GET('/api/v1/me')).catch((e) => e);
      await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      const error = await pending;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.kind).toBe('network');
      expect(error.message).toBe("Can't reach Lunti. Check your connection and try again.");
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives up when the session lookup hangs, so the query can retry', async () => {
    jest.useFakeTimers();
    try {
      // Supabase still restoring the session after a cold start: getSession never settles.
      fakeAuth.getSession.mockImplementationOnce(() => new Promise(() => {}));

      const pending = unwrap(() => api.GET('/api/v1/me')).catch((e) => e);
      await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      const error = await pending;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.kind).toBe('network');
      expect(error.transient).toBe(true); // TanStack Query retries it
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('classifies refresh errors: only a 4xx from Supabase Auth (or no session) is final', () => {
    expect(isDefinitiveRejection(new AuthApiError('x', 400, 'refresh_token_not_found'))).toBe(true);
    expect(isDefinitiveRejection(new AuthApiError('x', 401, 'bad_jwt'))).toBe(true);
    expect(isDefinitiveRejection(new AuthSessionMissingError())).toBe(true);
    expect(isDefinitiveRejection(new AuthApiError('x', 429, 'over_request_rate_limit'))).toBe(false);
    expect(isDefinitiveRejection(new AuthApiError('x', 408, undefined))).toBe(false);
    expect(isDefinitiveRejection(new AuthApiError('x', 500, undefined))).toBe(false);
    expect(isDefinitiveRejection(new AuthRetryableFetchError('offline', 0))).toBe(false);
    expect(isDefinitiveRejection(new TypeError('Network request failed'))).toBe(false);
  });

  describe('rate limits (429)', () => {
    const limited = (retryAfter?: string) =>
      new Response(
        JSON.stringify({
          type: 'urn:lunti:problem:rate-limited',
          title: 'Too Many Requests',
          status: 429,
          detail: 'Too many requests. Please wait a moment and try again.',
          errors: [],
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/problem+json',
            ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
          },
        },
      );

    it('reports how long to wait, is not retried automatically, and never refreshes', async () => {
      fetchMock.mockResolvedValue(limited('30'));

      const error = await unwrap(() => api.GET('/api/v1/me')).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ kind: 'rate-limited', status: 429, retryAfterSeconds: 30 });
      expect((error as ApiError).message).toBe('Too many requests. Please try again in 30 seconds.');
      expect((error as ApiError).transient).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fakeAuth.refreshSession).not.toHaveBeenCalled();
    });

    it('words long waits in minutes and falls back without Retry-After', async () => {
      fetchMock.mockResolvedValueOnce(limited('600'));
      await expect(unwrap(() => api.GET('/api/v1/me'))).rejects.toThrow(
        'Too many requests. Please try again in 10 minutes.',
      );
      fetchMock.mockResolvedValueOnce(limited());
      await expect(unwrap(() => api.GET('/api/v1/me'))).rejects.toThrow(
        'Too many requests. Please wait a moment and try again.',
      );
    });

    it('applies to receipt uploads too', async () => {
      fetchMock.mockResolvedValue(limited('12'));
      await expect(postForm('/api/v1/receipts', () => new FormData())).rejects.toMatchObject({
        kind: 'rate-limited',
        retryAfterSeconds: 12,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('treats 413 (too large) as a problem with the request, not a server failure', async () => {
    fetchMock.mockResolvedValue(problem(413, 'payload-too-large', 'The request is too large.'));
    await expect(postForm('/api/v1/receipts', () => new FormData())).rejects.toMatchObject({
      kind: 'validation',
      status: 413,
    });
  });

  it('sends no Authorization header when signed out', async () => {
    resetFakeSupabase(null);
    fetchMock.mockResolvedValue(problem(401, 'unauthorized', 'Sign in to continue.'));

    await expect(unwrap(() => api.GET('/api/v1/me'))).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(sentAuth(0)).toBeNull();
    expect(fakeAuth.refreshSession).not.toHaveBeenCalled();
  });
});

async function waitForCalls(ready: () => boolean) {
  for (let i = 0; i < 50 && !ready(); i += 1) await new Promise((r) => setTimeout(r, 0));
  expect(ready()).toBe(true);
}
