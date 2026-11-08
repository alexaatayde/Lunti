import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { useToastStore } from '../../src/stores/toast';
import {
  budgetStatus,
  EMPTY_SUMMARY,
  mockApi,
  problem,
  reply,
  txn,
} from '../../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);
jest.mock('@react-native-community/datetimepicker', () => ({
  DateTimePickerAndroid: { open: jest.fn() },
}));

const appDir = './app';
let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  useToastStore.setState({ message: null, onUndo: undefined });
  resetFakeSupabase(fakeSession());
  queryClient.clear();
  api = mockApi();
});

afterEach(() => api.restore());

function withoutRetries(run: () => Promise<void>) {
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  return run().finally(() => queryClient.setDefaultOptions(defaults));
}

describe('Transactions', () => {
  it('lists real transactions with the month summary', async () => {
    api.set('GET /api/v1/transactions', {
      items: [
        txn(),
        txn({
          id: 't-2',
          amount: '6.75',
          merchant: 'Corner Café',
          category: { id: 'c-dining', name: 'Dining out', icon: 'dining' },
        }),
      ],
      next_cursor: null,
    });
    api.set('GET /api/v1/transactions/summary', {
      ...EMPTY_SUMMARY,
      total: '1284.60',
      count: 42,
      receipt_count: 31,
      manual_count: 11,
    });

    await renderRouter(appDir, { initialUrl: '/transactions' });

    expect(await screen.findByText('Greenfield Market')).toBeOnTheScreen();
    expect(screen.getByText('Corner Café')).toBeOnTheScreen();
    expect(screen.getByText('₱46.80')).toBeOnTheScreen();
    expect(screen.getByText('₱1,284.60')).toBeOnTheScreen();
    expect(screen.getByText('42 transactions')).toBeOnTheScreen();
    expect(screen.getByText('31 scanned')).toBeOnTheScreen();
    expect(screen.getByText('11 manual')).toBeOnTheScreen();
    // The current month is requested.
    const query = api.calls('GET', '/api/v1/transactions')[0].query;
    expect(query.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(query.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('filters by category and opens a transaction', async () => {
    api.set('GET /api/v1/transactions', { items: [txn()], next_cursor: null });
    api.set('GET /api/v1/transactions/t-1', { ...txn(), items: [], budgets: [] });
    const router = await renderRouter(appDir, { initialUrl: '/transactions' });

    await fireEvent.press(await screen.findByRole('button', { name: 'Transport' }));
    await waitFor(() =>
      expect(
        api.calls('GET', '/api/v1/transactions').some((c) => c.query.get('category_id') === 'c-transport'),
      ).toBe(true),
    );

    await fireEvent.press(await screen.findByRole('button', { name: /^Greenfield Market/ }));
    await waitFor(() => expect(router.getPathname()).toBe('/transactions/t-1'));
  });

  it('shows an empty state with a way to add', async () => {
    await renderRouter(appDir, { initialUrl: '/transactions' });

    expect(await screen.findByText(/^No transactions in /)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeOnTheScreen();
  });

  it('shows an error with retry', async () => {
    api.set('GET /api/v1/transactions', () => problem(500, 'boom'));
    await withoutRetries(async () => {
      await renderRouter(appDir, { initialUrl: '/transactions' });
      expect(await screen.findByText('Something went wrong. Please try again.')).toBeOnTheScreen();

      api.set('GET /api/v1/transactions', { items: [txn()], next_cursor: null });
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Greenfield Market')).toBeOnTheScreen();
    });
  });
});

describe('Budget', () => {
  it('shows each budget with status in words, not color alone', async () => {
    api.set('GET /api/v1/budgets/status', [
      budgetStatus(
        { level: 'none', spent: '8760.00', remaining: '6240.00', percent_used: 58 },
        { id: 'b-all', category: null, label: 'Overall', limit_amount: '15000.00' },
      ),
      budgetStatus(),
      budgetStatus(
        {
          period_start: '2026-11-02',
          period_end: '2026-11-08',
          spent: '520.00',
          remaining: '-20.00',
          percent_used: 104,
          level: 'exceeded',
        },
        {
          id: 'b-2',
          label: 'Transport',
          period_type: 'weekly',
          limit_amount: '500.00',
          category: { id: 'c-transport', name: 'Transport', icon: 'transport' },
        },
      ),
    ]);

    await renderRouter(appDir, { initialUrl: '/budget' });

    expect(await screen.findByText('Overall')).toBeOnTheScreen();
    expect(screen.getByText('₱6,240.00 left')).toBeOnTheScreen();
    expect(screen.getByText('Near limit')).toBeOnTheScreen();
    expect(screen.getByText('₱1,930.00 of ₱2,000.00 · 97%')).toBeOnTheScreen();
    expect(screen.getByText('₱70.00 left')).toBeOnTheScreen();
    expect(screen.getByText('Exceeded')).toBeOnTheScreen();
    expect(screen.getByText('Over by ₱20.00')).toBeOnTheScreen();
    expect(screen.getByText('Weekly · Nov 2–8')).toBeOnTheScreen();
  });

  it('deletes a budget after confirming', async () => {
    api.set('GET /api/v1/budgets/status', [budgetStatus()]);
    api.set('DELETE /api/v1/budgets/b-1', () => reply(204));
    await renderRouter(appDir, { initialUrl: '/budget' });

    await fireEvent.press(await screen.findByRole('button', { name: 'Delete Dining out budget' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.calls('DELETE', '/api/v1/budgets/b-1')).toHaveLength(1));
    expect(await screen.findByText('Budget deleted. Your transactions are kept.')).toBeOnTheScreen();
  });

  it('creates a custom budget', async () => {
    api.set('POST /api/v1/budgets', (_r: Request, body: Record<string, unknown>) =>
      reply(201, budgetStatus({}, body)),
    );
    const router = await renderRouter(appDir, { initialUrl: '/budget' });

    await fireEvent.press(await screen.findByRole('button', { name: 'Create a budget' }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Category, not chosen/ }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Groceries' }));
    await fireEvent.changeText(screen.getByLabelText('Spending limit in pesos'), '2500');
    await fireEvent.press(screen.getByRole('button', { name: 'Save budget' }));

    await waitFor(() => expect(api.calls('POST', '/api/v1/budgets')).toHaveLength(1));
    expect(api.calls('POST', '/api/v1/budgets')[0].body).toMatchObject({
      category_id: 'c-groceries',
      period_type: 'monthly',
      limit_amount: '2500.00',
      alerts_enabled: true,
    });
    await waitFor(() => expect(router.getPathname()).toBe('/budget'));
  });

  it('requires an end date for a custom budget', async () => {
    await renderRouter(appDir, { initialUrl: '/budget/new' });

    await fireEvent.press(await screen.findByRole('tab', { name: 'Custom' }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Category, not chosen/ }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'All spending (overall)' }));
    await fireEvent.changeText(screen.getByLabelText('Spending limit in pesos'), '100');
    await fireEvent.press(screen.getByRole('button', { name: 'Save budget' }));

    expect(await screen.findByText('Choose an end date.')).toBeOnTheScreen();
    expect(api.calls('POST', '/api/v1/budgets')).toHaveLength(0);
  });
});

describe('Home', () => {
  it('shows the featured budget and spending by category from the API', async () => {
    api.set('GET /api/v1/budgets/status', [
      budgetStatus(
        {
          spent: '512.40',
          remaining: '337.60',
          percent_used: 60,
          level: 'none',
          safe_daily_amount: '28.13',
          on_pace: true,
        },
        { id: 'b-all', category: null, label: 'Overall', limit_amount: '850.00' },
      ),
    ]);
    api.set('GET /api/v1/transactions/summary', {
      ...EMPTY_SUMMARY,
      total: '512.40',
      count: 3,
      by_category: [
        {
          category: { id: 'c-groceries', name: 'Groceries', icon: 'groceries' },
          total: '400.00',
          count: 2,
          share_pct: 78,
        },
        {
          category: { id: 'c-dining', name: 'Dining out', icon: 'dining' },
          total: '112.40',
          count: 1,
          share_pct: 22,
        },
      ],
    });

    await renderRouter(appDir, { initialUrl: '/home' });

    expect(await screen.findByText('₱337.60')).toBeOnTheScreen();
    expect(screen.getByText('₱28.13')).toBeOnTheScreen();
    expect(screen.getByText("You're right on a steady pace")).toBeOnTheScreen();
    expect(await screen.findByText('60% of cap')).toBeOnTheScreen();
    expect(screen.getByText('₱400.00')).toBeOnTheScreen();
    expect(screen.getByText('₱112.40')).toBeOnTheScreen();
    expect(screen.getByText('78%')).toBeOnTheScreen();
    expect(screen.getByLabelText('Dining out: ₱112.40, 22% of spending')).toBeOnTheScreen();
  });

  it('invites the user to set a budget when there is none', async () => {
    await renderRouter(appDir, { initialUrl: '/home' });

    expect(await screen.findByRole('button', { name: 'Set a budget' })).toBeOnTheScreen();
    expect(await screen.findByText('Nothing spent yet this month')).toBeOnTheScreen();
  });
});

describe('Transaction detail', () => {
  const detail = {
    ...txn(),
    items: [],
    budgets: [
      {
        budget_id: 'b-1',
        label: 'Groceries',
        period_type: 'monthly',
        period_start: '2026-11-01',
        period_end: '2026-11-30',
        limit_amount: '850.00',
        spent: '512.40',
        remaining: '337.60',
        remaining_without_this: '384.40',
        percent_used: 60,
        level: 'none',
      },
    ],
  };

  it('shows the budget impact and deletes with Undo', async () => {
    api.set('GET /api/v1/transactions/t-1', detail);
    api.set('DELETE /api/v1/transactions/t-1', () => reply(204));
    api.set('POST /api/v1/transactions', () => reply(201, { ...txn(), budget_alerts: [] }));
    api.set('GET /api/v1/transactions', { items: [txn()], next_cursor: null });
    const router = await renderRouter(appDir, { initialUrl: '/transactions' });
    await fireEvent.press(await screen.findByRole('button', { name: /^Greenfield Market/ }));

    expect(await screen.findByText('₱337.60')).toBeOnTheScreen();
    expect(screen.getByText('Manual entry')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Delete transaction' }));
    expect(await screen.findByText('₱384.40')).toBeOnTheScreen(); // "goes back up to"
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.calls('DELETE', '/api/v1/transactions/t-1')).toHaveLength(1));
    expect(await screen.findByText('Transaction deleted. Budget updated.')).toBeOnTheScreen();
    await waitFor(() => expect(router.getPathname()).toBe('/transactions'));

    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.calls('POST', '/api/v1/transactions')).toHaveLength(1));
    expect(api.calls('POST', '/api/v1/transactions')[0].body).toEqual({
      amount: '46.80',
      category_id: 'c-groceries',
      occurred_at: '2026-11-05T02:42:00Z',
      merchant: 'Greenfield Market',
      note: null,
    });
    expect(await screen.findByText('Transaction restored. Budget updated.')).toBeOnTheScreen();
  });

  it('keeps the transaction when the user chooses "Keep it"', async () => {
    api.set('GET /api/v1/transactions/t-1', detail);
    await renderRouter(appDir, { initialUrl: '/transactions/t-1' });

    await fireEvent.press(await screen.findByRole('button', { name: 'Delete transaction' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Keep it' }));

    expect(api.calls('DELETE', '/api/v1/transactions/t-1')).toHaveLength(0);
  });
});
