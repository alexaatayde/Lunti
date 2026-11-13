import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import {
  analyticsSummary,
  mockApi,
  problem,
  productPattern,
  reply,
} from '../../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

const appDir = './app';
const SUMMARY = '/api/v1/analytics/summary';
const PATTERNS = '/api/v1/analytics/patterns';
let api: ReturnType<typeof mockApi>;

// Load the route tree once, outside any single test's timeout (see preloadRoutes.ts).
beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  resetFakeSupabase(fakeSession());
  queryClient.clear();
  api = mockApi();
});

afterEach(() => api.restore());

const october = analyticsSummary({
  total: '8760.00',
  previous_total: '9950.00',
  change_amount: '-1190.00',
  change_pct: -12,
  transaction_count: 41,
  by_category: [
    {
      category: { id: 'c-groceries', name: 'Groceries', icon: 'groceries' },
      total: '3680.00',
      count: 20,
      share_pct: 42,
    },
    {
      category: { id: 'c-dining', name: 'Dining out', icon: 'dining' },
      total: '5080.00',
      count: 21,
      share_pct: 58,
    },
  ],
  trend: [
    {
      start: '2026-10-01',
      end: '2026-10-07',
      total: '2450.00',
      is_future: false,
    },
    {
      start: '2026-10-08',
      end: '2026-10-14',
      total: '3330.00',
      is_future: false,
    },
    {
      start: '2026-10-15',
      end: '2026-10-21',
      total: '2980.00',
      is_future: false,
    },
    { start: '2026-10-22', end: '2026-10-31', total: '0.00', is_future: true },
  ],
});

async function open() {
  const router = await renderRouter(appDir, { initialUrl: '/analytics' });
  expect(await screen.findByText('Category breakdown', {}, { timeout: 4000 })).toBeOnTheScreen();
  return router;
}

it('shows the API figures: comparison, categories, trend and patterns', async () => {
  api.set(`GET ${SUMMARY}`, october);
  api.set(`GET ${PATTERNS}`, [
    productPattern(),
    productPattern({
      product: { id: 'p-soap', name: 'Dish soap', unit: null },
      data_tier: 'insufficient',
      purchase_count: 2,
      avg_interval_days: null,
      confidence: '0.000',
    }),
  ]);
  await open();

  expect(screen.getByText('Compared with last month')).toBeOnTheScreen();
  expect(screen.getAllByText('₱8,760.00').length).toBeGreaterThan(0);
  expect(screen.getByText('₱9,950.00')).toBeOnTheScreen();
  expect(screen.getByLabelText('12% less · ₱1,190.00 saved so far')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Groceries, 42%, ₱3,680.00' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Week 2, Oct 8 to 14: ₱3,330.00')).toBeOnTheScreen();
  expect(screen.getByLabelText('Week 4, Oct 22 to 31: not yet')).toBeOnTheScreen();
  expect(
    await screen.findByLabelText(
      'Rice 5kg. Every ~12 days · last Oct 11 · avg ₱285.00. High confidence',
    ),
  ).toBeOnTheScreen();
  expect(screen.getByText('Bought 2 times · no pattern yet')).toBeOnTheScreen();
  expect(screen.getByText('Insufficient data')).toBeOnTheScreen();
  expect(
    screen.getByText('Both periods counted to the same day, up to 6:00 pm.'),
  ).toBeOnTheScreen();
  expect(api.calls('GET', SUMMARY)[0].query.get('period')).toBe('monthly');
});

it('switches period and asks the API for it', async () => {
  api.set(`GET ${SUMMARY}`, (request: Request) => {
    const period = new URL(request.url).searchParams.get('period');
    return reply(
      200,
      period === 'weekly'
        ? analyticsSummary({
            period: 'weekly',
            trend_granularity: 'day',
            trend: [],
          })
        : analyticsSummary(),
    );
  });
  await open();

  await fireEvent.press(screen.getByRole('tab', { name: 'Weekly' }));

  expect(await screen.findByText('Compared with last week')).toBeOnTheScreen();
  expect(api.calls('GET', SUMMARY).map((c) => c.query.get('period'))).toContain('weekly');
});

it('shows empty states when there is no data yet', async () => {
  await open();
  expect(screen.getByText(/No spending in this period yet/)).toBeOnTheScreen();
  expect(screen.getByLabelText('No spending recorded yet')).toBeOnTheScreen();
  expect(await screen.findByText('No purchase patterns yet')).toBeOnTheScreen();
});

it('shows an error with retry when the summary fails', async () => {
  let fail = true;
  api.set(`GET ${SUMMARY}`, () =>
    fail ? problem(503, 'The database is not configured.') : reply(200, october),
  );
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retry: false },
  });
  try {
    await renderRouter(appDir, { initialUrl: '/analytics' });
    expect(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 }),
    ).toBeOnTheScreen();

    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Category breakdown')).toBeOnTheScreen();
  } finally {
    queryClient.setDefaultOptions(defaults);
  }
});

it('opens the category transactions for that month', async () => {
  api.set(`GET ${SUMMARY}`, october);
  const router = await open();

  await fireEvent.press(screen.getByRole('button', { name: 'Groceries, 42%, ₱3,680.00' }));

  await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
  await waitFor(() => {
    const lists = api.calls('GET', '/api/v1/transactions');
    const last = lists[lists.length - 1];
    expect(last.query.get('category_id')).toBe('c-groceries');
    expect(last.query.get('from')).toBe('2026-10-01');
    expect(last.query.get('to')).toBe('2026-10-31');
  });
});
