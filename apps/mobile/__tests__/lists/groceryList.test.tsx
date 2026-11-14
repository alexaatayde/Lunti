import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { useToastStore } from '../../src/stores/toast';
import {
  LIST_ID,
  listItem,
  mockApi,
  problem,
  reply,
  shoppingList,
  suggestion,
} from '../../test-utils/fakeApi';
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
const ITEMS = `/api/v1/shopping-lists/${LIST_ID}/items`;
let api: ReturnType<typeof mockApi>;

// Load the route tree once, outside any single test's timeout (see preloadRoutes.ts).
beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  useToastStore.setState({ message: null, onUndo: undefined });
  resetFakeSupabase(fakeSession());
  queryClient.clear();
  api = mockApi();
});

afterEach(() => api.restore());

async function open() {
  await renderRouter(appDir, { initialUrl: '/meals/grocery-list' });
  expect(await screen.findByText('Estimated cart total', {}, { timeout: 4000 })).toBeOnTheScreen();
}

it('shows the API totals, budget check, items and restock suggestions', async () => {
  api.set('GET /api/v1/shopping-lists', [
    shoppingList({
      items: [
        listItem(),
        listItem({
          id: 'i-2',
          name: 'Eggs (12)',
          source: 'suggested',
          quantity: '1.000',
          est_price: '95.00',
          line_estimate: '95.00',
        }),
        listItem({
          id: 'i-3',
          name: 'Salt',
          est_price: null,
          line_estimate: null,
          quantity: '1.000',
          is_purchased: true,
        }),
      ],
      open_count: 2,
      purchased_count: 1,
      estimated_total: '126.50',
      unpriced_count: 0,
      budget: {
        budget_id: 'b-1',
        label: 'Groceries',
        period_type: 'monthly',
        remaining: '800.00',
        remaining_after: '673.50',
        percent_left_after: 67,
      },
    }),
  ]);
  api.set('GET /api/v1/replenishment/suggestions', [suggestion()]);
  await open();

  expect(screen.getByLabelText('Estimated cart total ₱126.50')).toBeOnTheScreen();
  expect(screen.getByText('of ₱800.00 left in your Groceries budget')).toBeOnTheScreen();
  expect(screen.getByText('67% budget left after this cart')).toBeOnTheScreen();
  expect(screen.getByText('2 × ₱15.75')).toBeOnTheScreen();
  expect(screen.getByText('Restock')).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: 'Salt, picked up' })).toBeOnTheScreen();
  expect(await screen.findByText('Running low?')).toBeOnTheScreen();
  expect(screen.getByLabelText('Eggs (12). Every ~7 days · Due in 2 days')).toBeOnTheScreen();
});

it('warns when the cart is over the budget', async () => {
  api.set('GET /api/v1/shopping-lists', [
    shoppingList({
      estimated_total: '900.00',
      budget: {
        budget_id: 'b',
        label: 'Groceries',
        period_type: 'monthly',
        remaining: '800.00',
        remaining_after: '-100.00',
        percent_left_after: 0,
      },
    }),
  ]);
  await open();
  expect(screen.getByText('Over budget')).toBeOnTheScreen();
  expect(screen.getByText("This cart is ₱100.00 over what's left")).toBeOnTheScreen();
});

it('answers a suggestion through the API', async () => {
  api.set('GET /api/v1/replenishment/suggestions', [suggestion()]);
  api.set('POST /api/v1/replenishment/suggestions/s-1/feedback', (_r: Request, body: unknown) =>
    reply(200, { suggestion: suggestion({ status: 'added' }), shopping_item: listItem(), body }),
  );
  await open();

  await fireEvent.press(await screen.findByRole('button', { name: 'Add Eggs (12) to list' }));
  await waitFor(() =>
    expect(api.calls('POST', '/api/v1/replenishment/suggestions/s-1/feedback')[0].body).toEqual({
      action: 'add_to_list',
    }),
  );
  await waitFor(() => expect(useToastStore.getState().message).toBe('Added to your grocery list.'));
});

it('offers the other answers under More', async () => {
  api.set('GET /api/v1/replenishment/suggestions', [suggestion()]);
  api.set('POST /api/v1/replenishment/suggestions/s-1/feedback', () =>
    reply(200, { suggestion: suggestion({ status: 'dismissed' }), shopping_item: null }),
  );
  await open();

  await fireEvent.press(await screen.findByRole('button', { name: 'More options for Eggs (12)' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'I bought it elsewhere' }));
  await waitFor(() =>
    expect(api.calls('POST', '/api/v1/replenishment/suggestions/s-1/feedback')[0].body).toEqual({
      action: 'bought_elsewhere',
    }),
  );
});

it('adds an item, and shows the duplicate error from the API', async () => {
  api.set(`POST ${ITEMS}`, () => problem(409, 'Lemons is already on your list.'));
  await open();
  expect(screen.getByText('Your list is empty')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: 'Add item' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Add to list' }));
  expect(await screen.findByText('Enter the item name.')).toBeOnTheScreen();
  expect(api.calls('POST', ITEMS)).toHaveLength(0);

  await fireEvent.changeText(screen.getByLabelText('Item'), 'Lemons');
  await fireEvent.changeText(screen.getByLabelText('Estimated price each (₱, optional)'), '15.75');
  await fireEvent.press(screen.getByRole('button', { name: 'Add to list' }));

  expect(await screen.findByText('Lemons is already on your list.')).toBeOnTheScreen();
  expect(api.calls('POST', ITEMS)[0].body).toEqual({
    name: 'Lemons',
    quantity: '1',
    unit: null,
    est_price: '15.75',
  });
});

// Phase 8C: keyboard users move field to field with the Next key, and Done submits.
it('moves Item → Quantity → Unit → Price with the keyboard and submits from the last field', async () => {
  api.set(`POST ${ITEMS}`, () => reply(201, listItem()));
  await open();
  await fireEvent.press(screen.getByRole('button', { name: 'Add item' }));
  const name = await screen.findByLabelText('Item');
  expect(name.props.returnKeyType).toBe('next');
  expect(screen.getByLabelText('Quantity').props.returnKeyType).toBe('next');
  expect(screen.getByLabelText('Unit').props.returnKeyType).toBe('next');
  const price = screen.getByLabelText('Estimated price each (₱, optional)');
  expect(price.props.returnKeyType).toBe('done');

  await fireEvent.changeText(name, 'Lemons');
  await fireEvent(price, 'submitEditing');
  await waitFor(() => expect(api.calls('POST', ITEMS)).toHaveLength(1));
});

it('shows a recipe item with the amount and unit the recipe needs', async () => {
  api.set('GET /api/v1/shopping-lists', [
    shoppingList({
      items: [
        listItem({
          id: 'i-2',
          name: 'Soy sauce',
          quantity: '120.000',
          unit: 'ml',
          est_price: null,
          line_estimate: null,
          source: 'recipe',
          recipe_id: 'r-1',
        }),
      ],
      open_count: 1,
      unpriced_count: 1,
    }),
  ]);
  await open();
  expect(screen.getByText('120 ml')).toBeOnTheScreen();
  expect(screen.getByText('From a recipe')).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Edit Soy sauce, 120 ml, from a recipe' }),
  ).toBeOnTheScreen();
});

it('ticks an item off', async () => {
  api.set('GET /api/v1/shopping-lists', [shoppingList({ items: [listItem()], open_count: 1 })]);
  api.set(`PATCH ${ITEMS}/i-1`, () => reply(200, listItem({ is_purchased: true })));
  await open();

  // Emulator finding: a 28 dp box needs 8 dp of hitSlop each side to reach 44 dp.
  expect(screen.getByRole('checkbox', { name: 'Lemons, to buy' }).props.hitSlop).toBe(8);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Lemons, to buy' }));
  await waitFor(() =>
    expect(api.calls('PATCH', `${ITEMS}/i-1`)[0].body).toEqual({ is_purchased: true }),
  );
});

it('shows an error with retry', async () => {
  let fail = true;
  api.set('GET /api/v1/shopping-lists', () =>
    fail ? problem(503, 'Service unavailable.') : reply(200, [shoppingList()]),
  );
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  try {
    await renderRouter(appDir, { initialUrl: '/meals/grocery-list' });
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 }),
    );
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Estimated cart total')).toBeOnTheScreen();
  } finally {
    queryClient.setDefaultOptions(defaults);
  }
});

it("offers Undo after Don't remind, which turns reminders back on", async () => {
  api.set('GET /api/v1/replenishment/suggestions', [suggestion()]);
  api.set('POST /api/v1/replenishment/suggestions/s-1/feedback', () =>
    reply(200, { suggestion: suggestion({ status: 'dismissed' }), shopping_item: null }),
  );
  api.set('DELETE /api/v1/replenishment/muted/p-eggs', () => reply(204));
  await open();

  await fireEvent.press(await screen.findByRole('button', { name: 'More options for Eggs (12)' }));
  await fireEvent.press(await screen.findByRole('button', { name: "Don't remind me about this" }));
  await waitFor(() =>
    expect(useToastStore.getState().message).toBe("We won't remind you about this item."),
  );
  expect(api.calls('POST', '/api/v1/replenishment/suggestions/s-1/feedback')[0].body).toEqual({
    action: 'dont_remind',
  });

  useToastStore.getState().onUndo?.();
  await waitFor(() =>
    expect(api.calls('DELETE', '/api/v1/replenishment/muted/p-eggs')).toHaveLength(1),
  );
  await waitFor(() =>
    expect(useToastStore.getState().message).toBe('Reminders for Eggs (12) are back on.'),
  );
});
