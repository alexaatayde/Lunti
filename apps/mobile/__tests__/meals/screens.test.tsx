import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { useToastStore } from '../../src/stores/toast';
import {
  ingredient,
  listItem,
  mockApi,
  pantryItem,
  pantryPage,
  problem,
  recipe,
  recipeDetail,
  reply,
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

function withoutRetries(run: () => Promise<void>) {
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  return run().finally(() => queryClient.setDefaultOptions(defaults));
}

describe('Meals', () => {
  async function open() {
    const router = await renderRouter(appDir, { initialUrl: '/meals' });
    expect(await screen.findByText('Ideas & savings', {}, { timeout: 4000 })).toBeOnTheScreen();
    return router;
  }

  it('shows the best recipe, more ideas and an honest insight label', async () => {
    api.set('GET /api/v1/recipes/recommendations', {
      items: [
        recipe({ match_pct: 100, missing: [], missing_cost: '0.00' }),
        recipe({ id: 'r-2', name: 'Tortang talong', match_pct: 33 }),
      ],
      budget_label: 'Groceries',
      budget_remaining: '35.00',
      over_budget_count: 2,
    });
    api.set('GET /api/v1/insights', {
      items: [
        {
          id: 'in-1',
          type: 'spending',
          message: "You've spent ₱600.00 so far this month.",
          engine: 'summary',
          generated_at: '2026-11-13T00:00:00Z',
        },
      ],
      need_more_data: false,
      placeholder: null,
    });
    await open();

    expect(await screen.findByText('100% match')).toBeOnTheScreen();
    expect(screen.getByText('Nothing to buy')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Tortang talong, 33% match, 1 to buy · about ₱10.00' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        /2 more ideas are hidden: the known estimated cost of their missing items is more than the ₱35.00 left in your Groceries budget/,
      ),
    ).toBeOnTheScreen();
    expect(await screen.findByText("You've spent ₱600.00 so far this month.")).toBeOnTheScreen();
    expect(screen.getByText('Summary')).toBeOnTheScreen();
  });

  it('shows empty states for a new user', async () => {
    await open();
    expect(await screen.findByText('No recipe ideas yet')).toBeOnTheScreen();
    expect(screen.getByText('Add a few weeks of purchases.')).toBeOnTheScreen();
  });

  it('adds missing ingredients to the list', async () => {
    api.set('GET /api/v1/recipes/recommendations', {
      items: [recipe()],
      budget_label: null,
      budget_remaining: null,
      over_budget_count: 0,
    });
    api.set('POST /api/v1/recipes/r-1/add-missing', () =>
      reply(200, { added: [listItem({ name: 'Onion', source: 'recipe' })], already_on_list: [] }),
    );
    await open();
    await fireEvent.press(
      await screen.findByRole('button', {
        name: 'Add missing ingredients for Scrambled eggs with tomatoes to list',
      }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().message).toBe('Added 1 item to your list.'),
    );
  });

  it('dismisses an insight', async () => {
    api.set('GET /api/v1/insights', {
      items: [
        {
          id: 'in-1',
          type: 'budget',
          message: 'Your Groceries budget is at 95%: ₱5.00 left.',
          engine: 'ai',
          generated_at: '2026-11-13T00:00:00Z',
        },
      ],
      need_more_data: false,
      placeholder: null,
    });
    api.set('POST /api/v1/insights/in-1/dismiss', () => reply(200, {}));
    await open();
    expect(await screen.findByText('AI Insight')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Hide this insight' }));
    await waitFor(() => expect(api.calls('POST', '/api/v1/insights/in-1/dismiss')).toHaveLength(1));
  });

  it('shows an error with retry for recommendations', () =>
    withoutRetries(async () => {
      let fail = true;
      api.set('GET /api/v1/recipes/recommendations', () =>
        fail
          ? problem(503, 'Service unavailable.')
          : reply(200, {
              items: [],
              budget_label: null,
              budget_remaining: null,
              over_budget_count: 0,
            }),
      );
      await renderRouter(appDir, { initialUrl: '/meals' });
      await fireEvent.press(
        await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 }),
      );
      fail = false;
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('No recipe ideas yet')).toBeOnTheScreen();
    }));
});

describe('Pantry', () => {
  async function open() {
    await renderRouter(appDir, { initialUrl: '/meals/pantry' });
    expect(
      await screen.findByText('Your kitchen, at a glance', {}, { timeout: 4000 }),
    ).toBeOnTheScreen();
  }

  const page = pantryPage({
    items: [
      pantryItem(),
      pantryItem({
        id: 'pi-2',
        name: 'Spinach',
        quantity: '1.000',
        unit: 'bunch',
        days_left: 1,
        state: 'use_soon',
        estimated_expiry: '2026-11-14',
        confirmed: true,
      }),
    ],
    use_first: [
      pantryItem({
        id: 'pi-2',
        name: 'Spinach',
        quantity: '1.000',
        unit: 'bunch',
        days_left: 1,
        state: 'use_soon',
      }),
    ],
    in_stock_count: 2,
    use_soon_count: 1,
    estimated_count: 1,
  });

  it('separates estimated and confirmed amounts and lists what to use first', async () => {
    api.set('GET /api/v1/pantry', page);
    await open();
    expect(await screen.findByLabelText('2 In stock')).toBeOnTheScreen();
    expect(
      screen.getByText('1 amount is estimated from receipts. Adjust any to confirm it.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Best before in 1 day')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Edit Eggs, 12 pcs, estimated' })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: 'Edit Spinach, 1 bunch · Best before in 1 day, confirmed',
      }),
    ).toBeOnTheScreen();
  });

  it('adjusts an amount with − and +', async () => {
    api.set('GET /api/v1/pantry', page);
    api.set('PATCH /api/v1/pantry/pi-1', (_r: Request, body: unknown) =>
      reply(200, pantryItem({ ...(body as object), confirmed: true })),
    );
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Less Eggs' }));
    await waitFor(() =>
      expect(api.calls('PATCH', '/api/v1/pantry/pi-1')[0].body).toEqual({ quantity: '11' }),
    );
  });

  it('edits an item and saves amount, unit and date', async () => {
    api.set('GET /api/v1/pantry', page);
    api.set('PATCH /api/v1/pantry/pi-1', () =>
      reply(200, pantryItem({ quantity: '6.000', confirmed: true })),
    );
    await open();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Edit Eggs, 12 pcs, estimated' }),
    );
    await fireEvent.changeText(await screen.findByLabelText('Amount'), '6');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.calls('PATCH', '/api/v1/pantry/pi-1')[0].body).toEqual({
        quantity: '6',
        unit: 'pcs',
        estimated_expiry: null,
      }),
    );
    await waitFor(() => expect(useToastStore.getState().message).toBe('Eggs updated.'));
  });

  it('shows the empty state', async () => {
    await open();
    expect(await screen.findByText('Your pantry is empty')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Scan a receipt' })).toBeOnTheScreen();
  });
});

describe('Recipe detail', () => {
  it('shows each ingredient with text status, not just color', async () => {
    api.set(
      'GET /api/v1/recipes/r-1',
      recipeDetail({
        ingredients: [
          ingredient(),
          ingredient({
            name: 'tomato',
            quantity: '2.000',
            status: 'check_amount',
            pantry_item_name: 'Tomatoes',
            have_quantity: '1.000',
            have_unit: 'bag',
          }),
          ingredient({
            name: 'onion',
            quantity: '1.000',
            status: 'missing',
            pantry_item_name: null,
            have_quantity: null,
            have_unit: null,
            have_confirmed: null,
            est_price: '10.00',
          }),
          ingredient({
            name: 'garlic',
            quantity: '1.000',
            unit: 'head',
            status: 'missing',
            pantry_item_name: null,
            have_quantity: null,
            have_unit: null,
            have_confirmed: null,
            est_price: null,
          }),
        ],
      }),
    );
    api.set('POST /api/v1/recipes/r-1/add-missing', () =>
      reply(200, { added: [], already_on_list: ['Onion'] }),
    );
    await renderRouter(appDir, { initialUrl: '/meals/recipe/r-1' });

    expect(
      await screen.findByText('Scrambled eggs with tomatoes', {}, { timeout: 4000 }),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('eggs, needs 4 pcs. You have it. You have about 6 pcs (estimate)'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('tomato, needs 2 pcs. Check amount. You have about 1 bag (estimate)'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('onion, needs 1 pcs. Need to buy. about ₱10.00'),
    ).toBeOnTheScreen();
    // An unknown price is shown as unknown, never as ₱0.
    expect(
      screen.getByLabelText('garlic, needs 1 head. Need to buy. price unknown'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Price unknown')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /Add 1 missing ingredient to/ }));
    await waitFor(() =>
      expect(useToastStore.getState().message).toBe(
        'Those items are already on your grocery list.',
      ),
    );
  });

  it('shows times, servings, staples and numbered steps', async () => {
    api.set('GET /api/v1/recipes/r-1', recipeDetail());
    await renderRouter(appDir, { initialUrl: '/meals/recipe/r-1' });

    expect(
      await screen.findByText('Scrambled eggs with tomatoes', {}, { timeout: 4000 }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Prep: 3 min')).toBeOnTheScreen();
    expect(screen.getByLabelText('Cook: 7 min')).toBeOnTheScreen();
    expect(screen.getByLabelText('Total: 10 min')).toBeOnTheScreen();
    expect(screen.getByLabelText('Serves: 2 servings')).toBeOnTheScreen();
    expect(screen.getByText('Cooking oil · Salt')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Step 1 of 3. Dice the tomatoes and the onion.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Step 3 of 3. Add the eggs and stir until set.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('recipe-photo-placeholder', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('says when the pantry has some, but not enough', async () => {
    api.set('GET /api/v1/recipes/r-1', recipeDetail());
    await renderRouter(appDir, { initialUrl: '/meals/recipe/r-1' });

    expect(
      await screen.findByLabelText('tomato, needs 2 pcs. Not enough. You have 1 pcs. price unknown', {}, { timeout: 4000 }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Amounts marked “estimate” come from your receipts. Confirm them in Pantry.')).toBeOnTheScreen();
  });

  it('still opens against an API from before migration 0005 (no steps, staples or split times)', async () => {
    const old: Record<string, unknown> = recipeDetail({ prep_time_minutes: 10 });
    for (const k of ['steps', 'staples', 'cook_time_minutes', 'total_time_minutes']) delete old[k];
    api.set('GET /api/v1/recipes/r-1', old);
    await renderRouter(appDir, { initialUrl: '/meals/recipe/r-1' });

    expect(
      await screen.findByText('Cooking steps for this recipe aren’t available yet.', {}, { timeout: 4000 }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Total time: 10 min')).toBeOnTheScreen();
  });

  it('handles a recipe without steps yet', async () => {
    api.set('GET /api/v1/recipes/r-1', recipeDetail({ steps: [], staples: [], cook_time_minutes: 0 }));
    await renderRouter(appDir, { initialUrl: '/meals/recipe/r-1' });

    expect(
      await screen.findByText('Cooking steps for this recipe aren’t available yet.', {}, { timeout: 4000 }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Total time: 10 min')).toBeOnTheScreen();
    expect(screen.queryByText('You’ll also need')).toBeNull();
  });
});
