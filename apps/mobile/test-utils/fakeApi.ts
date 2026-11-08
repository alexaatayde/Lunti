/**
 * Fake Lunti API for screen tests: answers `fetch` by "METHOD /path" (query ignored).
 * Every screen gets sensible empty defaults; tests override the routes they care about.
 *
 *   const api = mockApi({ 'GET /api/v1/budgets/status': [status] });
 *   api.calls('POST', '/api/v1/transactions')  // → parsed JSON bodies sent
 */
export const USER_ID = '00000000-0000-4000-8000-000000000001';

export const CATEGORIES = [
  ['c-groceries', 'Groceries', 'groceries'],
  ['c-dining', 'Dining out', 'dining'],
  ['c-transport', 'Transport', 'transport'],
  ['c-utilities', 'Utilities', 'utilities'],
  ['c-household', 'Household', 'household'],
  ['c-others', 'Others', 'others'],
].map(([id, name, icon]) => ({ id, name, icon, is_default: true }));

export const ME = {
  user_id: USER_ID,
  email: 'alex@example.com',
  full_name: 'Alex Reyes',
  role: 'user',
  currency: 'PHP',
  terms_accepted_at: null,
  data_consent_at: null,
  created_at: '2026-11-04T00:00:00Z',
};

export const EMPTY_SUMMARY = {
  total: '0.00',
  count: 0,
  receipt_count: 0,
  manual_count: 0,
  by_category: [],
};

const DEFAULTS: Record<string, unknown> = {
  'GET /api/v1/me': ME,
  'GET /api/v1/me/preferences': {
    notify_budget: true,
    notify_replenishment: true,
    notify_shopping: true,
    notify_meals: true,
    budget_alert_pct: 90,
  },
  'GET /api/v1/categories': CATEGORIES,
  'GET /api/v1/transactions': { items: [], next_cursor: null },
  'GET /api/v1/transactions/summary': EMPTY_SUMMARY,
  'GET /api/v1/budgets/status': [],
  'GET /api/v1/budgets': [],
};

export type Reply = { status: number; body?: unknown };
type Route = unknown | ((request: Request, body: unknown) => Reply | Promise<Reply>);

export const reply = (status: number, body?: unknown): Reply => ({ status, body });

export const problem = (status: number, detail: string, errors: object[] = []) =>
  reply(status, {
    type: `urn:lunti:problem:${status === 422 ? 'validation-error' : 'x'}`,
    title: 'x',
    status,
    detail,
    errors,
  });

export function mockApi(routes: Record<string, Route> = {}) {
  const table: Record<string, Route> = { ...DEFAULTS, ...routes };
  const sent: { method: string; path: string; query: URLSearchParams; body: unknown }[] = [];

  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.clone().text();
    const body = text ? JSON.parse(text) : undefined;
    sent.push({ method: request.method, path: url.pathname, query: url.searchParams, body });

    const route = table[`${request.method} ${url.pathname}`];
    let result: Reply;
    if (route === undefined) result = problem(404, `No fake route for ${url.pathname}`);
    else if (typeof route === 'function') result = await route(request, body);
    else result = reply(request.method === 'POST' ? 201 : 200, route);

    if (result.status === 204 || result.body === undefined) {
      return new Response(null, { status: result.status === 200 ? 204 : result.status });
    }
    const type = result.status >= 400 ? 'application/problem+json' : 'application/json';
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': type },
    });
  });

  return {
    fetchMock,
    set: (key: string, route: Route) => {
      table[key] = route;
    },
    calls: (method: string, path: string) =>
      sent.filter((c) => c.method === method && c.path === path),
    restore: () => fetchMock.mockRestore(),
  };
}

// ---------- builders ----------

export function txn(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 't-1',
    amount: '46.80',
    occurred_at: '2026-11-05T02:42:00Z',
    merchant: 'Greenfield Market',
    note: null,
    source: 'manual',
    receipt_id: null,
    category: { id: 'c-groceries', name: 'Groceries', icon: 'groceries' },
    item_count: 0,
    created_at: '2026-11-05T02:42:00Z',
    updated_at: '2026-11-05T02:42:00Z',
    ...overrides,
  };
}

export function budgetStatus(overrides: Partial<Record<string, unknown>> = {}, budget = {}) {
  return {
    budget: {
      id: 'b-1',
      category: { id: 'c-dining', name: 'Dining out', icon: 'dining' },
      label: 'Dining out',
      period_type: 'monthly',
      start_date: '2026-11-01',
      end_date: null,
      limit_amount: '2000.00',
      alerts_enabled: true,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
      ...budget,
    },
    state: 'active',
    period_start: '2026-11-01',
    period_end: '2026-11-30',
    spent: '1930.00',
    remaining: '70.00',
    percent_used: 97,
    level: 'near',
    days_left: 26,
    safe_daily_amount: '2.69',
    on_pace: false,
    ...overrides,
  };
}
