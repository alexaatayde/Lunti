import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { useToastStore } from '../../src/stores/toast';
import { mockApi, problem, reply, txn } from '../../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);
jest.mock('@react-native-community/datetimepicker', () => ({
  DateTimePickerAndroid: { open: jest.fn() },
}));

const appDir = './app';
let api: ReturnType<typeof mockApi>;

// Load the route tree once, outside any single test's timeout (see preloadRoutes.ts).
beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  useToastStore.setState({ message: null, onUndo: undefined });
  resetFakeSupabase(fakeSession());
  queryClient.clear();
  api = mockApi({
    'POST /api/v1/transactions': (_req: Request, body: Record<string, unknown>) =>
      reply(201, { ...txn({ id: 't-new', ...body }), budget_alerts: [] }),
  });
});

afterEach(() => api.restore());

async function openAddForm() {
  const router = await renderRouter(appDir, { initialUrl: '/transactions' });
  await fireEvent.press(await screen.findByRole('button', { name: 'Add transaction' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Enter manually' }));
  expect(await screen.findByText('New expense')).toBeOnTheScreen();
  // Defaults to the first category once categories load.
  await screen.findByText('Groceries', { exact: true });
  return router;
}

describe('Expense form (add)', () => {
  it('shows validation errors and sends nothing when the amount is missing or zero', async () => {
    await openAddForm();

    await fireEvent.press(screen.getByRole('button', { name: 'Save expense' }));
    expect(await screen.findByText('Enter an amount.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Amount in pesos'), '0.00');
    await fireEvent.press(screen.getByRole('button', { name: 'Save expense' }));
    expect(await screen.findByText('Amount must be more than ₱0.')).toBeOnTheScreen();

    expect(api.calls('POST', '/api/v1/transactions')).toHaveLength(0);
  });

  it('records an expense with an exact decimal string, then returns with a toast', async () => {
    const router = await openAddForm();

    await fireEvent.changeText(screen.getByLabelText('Amount in pesos'), '6.5');
    await fireEvent.changeText(screen.getByLabelText('Store'), '  Corner Café ');
    await fireEvent.changeText(screen.getByLabelText('Note'), 'Morning coffee');
    await fireEvent.press(screen.getByRole('button', { name: /^Category, Groceries/ }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Dining out' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save expense' }));

    await waitFor(() => expect(api.calls('POST', '/api/v1/transactions')).toHaveLength(1));
    const body = api.calls('POST', '/api/v1/transactions')[0].body as Record<string, string>;
    expect(body).toMatchObject({
      amount: '6.50',
      category_id: 'c-dining',
      merchant: 'Corner Café',
      note: 'Morning coffee',
    });
    expect(new Date(body.occurred_at).getTime()).not.toBeNaN();

    expect(await screen.findByText('Transaction saved. Budget updated.')).toBeOnTheScreen();
    await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
  });

  it('mentions a budget alert returned by the server', async () => {
    api.set('POST /api/v1/transactions', () =>
      reply(201, {
        ...txn(),
        budget_alerts: [
          {
            budget_id: 'b-1',
            label: 'Groceries',
            level: 'near',
            spent: '90.00',
            limit_amount: '100.00',
            remaining: '10.00',
          },
        ],
      }),
    );
    await openAddForm();

    await fireEvent.changeText(screen.getByLabelText('Amount in pesos'), '40');
    await fireEvent.press(screen.getByRole('button', { name: 'Save expense' }));

    expect(
      await screen.findByText(
        'Transaction saved. Budget updated. Your Groceries budget is near its limit.',
      ),
    ).toBeOnTheScreen();
  });

  it('shows server field errors next to the field and stays open', async () => {
    api.set('POST /api/v1/transactions', () =>
      problem(422, 'The request has invalid fields.', [
        { field: 'category_id', message: 'Choose one of your categories.', code: 'x' },
      ]),
    );
    const router = await openAddForm();

    await fireEvent.changeText(screen.getByLabelText('Amount in pesos'), '10');
    await fireEvent.press(screen.getByRole('button', { name: 'Save expense' }));

    expect(await screen.findByText('Choose one of your categories.')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/expense-form');
  });

  it('keeps the form and offers to try again when the server is down', async () => {
    api.set('POST /api/v1/transactions', () => problem(503, 'down'));
    await openAddForm();

    await fireEvent.changeText(screen.getByLabelText('Amount in pesos'), '10');
    await fireEvent.press(screen.getByRole('button', { name: 'Save expense' }));

    expect(
      await screen.findByText('Lunti is temporarily unavailable. Please try again shortly.'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Amount in pesos').props.value).toBe('10');
  });
});

describe('Expense form (edit)', () => {
  it('prefills from the API and saves only through PATCH', async () => {
    api.set('GET /api/v1/transactions/t-1', {
      ...txn({ note: 'Weekly shop' }),
      items: [],
      budgets: [],
    });
    api.set('PATCH /api/v1/transactions/t-1', (_req: Request, body: Record<string, unknown>) =>
      reply(200, { ...txn(body), budget_alerts: [] }),
    );
    await renderRouter(appDir, { initialUrl: '/expense-form?mode=edit&id=t-1' });

    expect(await screen.findByDisplayValue('46.80')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Greenfield Market')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Weekly shop')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Amount in pesos'), '50');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.calls('PATCH', '/api/v1/transactions/t-1')).toHaveLength(1));
    expect(api.calls('PATCH', '/api/v1/transactions/t-1')[0].body).toMatchObject({
      amount: '50.00',
      category_id: 'c-groceries',
      merchant: 'Greenfield Market',
      note: 'Weekly shop',
    });
    expect(api.calls('POST', '/api/v1/transactions')).toHaveLength(0);
  });
});
