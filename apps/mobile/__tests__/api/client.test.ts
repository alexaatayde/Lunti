import { api, ApiError, apiBaseUrl, REQUEST_TIMEOUT_MS, unwrap } from '../../src/api/client';
import { fakeAuth, fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';

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
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });

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

  it('gives up with an "unauthorized" error if the refreshed token is also rejected', async () => {
    fakeAuth.refreshSession.mockResolvedValueOnce({
      data: { session: { ...fakeSession(), access_token: 'token-2' } },
      error: null,
    });
    fetchMock.mockImplementation(async () => problem(401, 'unauthorized', 'nope'));

    const error = await unwrap(() => api.GET('/api/v1/me')).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('unauthorized');
    expect(error.message).toBe('Your session has ended. Please sign in again.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
