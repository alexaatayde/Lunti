import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { useToastStore } from '../../src/stores/toast';
import { mockApi, notification, problem, reply, suggestion } from '../../test-utils/fakeApi';
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
const LIST = '/api/v1/notifications';
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

const restock = notification({
  id: 'n-2',
  type: 'replenishment',
  level: null,
  title: 'Eggs (12) may be running low',
  body: 'You usually buy Eggs (12) every ~7 days. Add it to your list?',
  deep_link: '/meals/grocery-list',
  suggestion: suggestion(),
  read_at: '2026-11-12T00:00:00Z',
  created_at: '2026-10-20T01:00:00Z',
});

async function open() {
  const router = await renderRouter(appDir, { initialUrl: '/notifications' });
  expect(await screen.findByText('Notify me about', {}, { timeout: 4000 })).toBeOnTheScreen();
  return router;
}

it('groups new and earlier notifications from the API', async () => {
  api.set(`GET ${LIST}`, { items: [notification(), restock], unread_count: 1 });
  await open();

  expect(await screen.findByText('New · 1')).toBeOnTheScreen();
  expect(screen.getByText('Earlier')).toBeOnTheScreen();
  expect(screen.getByText('Groceries budget exceeded')).toBeOnTheScreen();
  expect(screen.getByText('2h ago')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Add Eggs (12) to list' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'I still have some Eggs (12)' })).toBeOnTheScreen();
});

it('opens a budget alert, marking it read', async () => {
  api.set(`GET ${LIST}`, { items: [notification()], unread_count: 1 });
  api.set(`POST ${LIST}/n-1/read`, () =>
    reply(200, notification({ read_at: '2026-11-13T00:00:00Z' })),
  );
  const router = await open();

  await fireEvent.press(
    await screen.findByRole('link', { name: 'View budget: Groceries budget exceeded' }),
  );
  await waitFor(() => expect(api.calls('POST', `${LIST}/n-1/read`)).toHaveLength(1));
  await waitFor(() => expect(router.getPathname()).toBe('/budget'));
});

it('answers a restock reminder from its card', async () => {
  api.set(`GET ${LIST}`, { items: [restock], unread_count: 0 });
  api.set('POST /api/v1/replenishment/suggestions/s-1/feedback', () =>
    reply(200, { suggestion: suggestion({ status: 'modified' }), shopping_item: null }),
  );
  await open();

  await fireEvent.press(await screen.findByRole('button', { name: 'I still have some Eggs (12)' }));
  await waitFor(() =>
    expect(api.calls('POST', '/api/v1/replenishment/suggestions/s-1/feedback')[0].body).toEqual({
      action: 'still_have',
    }),
  );
});

it('shows what happened to an answered suggestion instead of the buttons', async () => {
  api.set(`GET ${LIST}`, {
    items: [{ ...restock, suggestion: suggestion({ status: 'added' }) }],
    unread_count: 0,
  });
  await open();
  expect(await screen.findByText('Added to your list')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Add Eggs (12) to list' })).toBeNull();
});

it('marks all read', async () => {
  api.set(`GET ${LIST}`, { items: [notification()], unread_count: 1 });
  api.set(`POST ${LIST}/read-all`, () => reply(200, { updated: 1 }));
  await open();
  await fireEvent.press(await screen.findByRole('button', { name: 'Mark all read' }));
  await waitFor(() => expect(api.calls('POST', `${LIST}/read-all`)).toHaveLength(1));
});

it('switches a reminder type off', async () => {
  api.set('PUT /api/v1/me/preferences', (_r: Request, body: unknown) => reply(200, body));
  await open();
  expect(screen.getByText('No notifications yet')).toBeOnTheScreen();

  await fireEvent(screen.getByLabelText('Restock reminders'), 'valueChange', false);
  await waitFor(() =>
    expect(api.calls('PUT', '/api/v1/me/preferences')[0].body).toMatchObject({
      notify_replenishment: false,
      notify_budget: true,
    }),
  );
});

it('shows an error with retry', async () => {
  let fail = true;
  api.set(`GET ${LIST}`, () =>
    fail ? problem(503, 'Service unavailable.') : reply(200, { items: [], unread_count: 0 }),
  );
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  try {
    await renderRouter(appDir, { initialUrl: '/notifications' });
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 }),
    );
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No notifications yet')).toBeOnTheScreen();
  } finally {
    queryClient.setDefaultOptions(defaults);
  }
});

it('shows the unread count on the Home bell', async () => {
  api.set(`GET ${LIST}`, { items: [notification()], unread_count: 3 });
  const router = await renderRouter(appDir, { initialUrl: '/home' });
  const bell = await screen.findByRole(
    'button',
    { name: 'Notifications, 3 unread' },
    { timeout: 4000 },
  );
  await fireEvent.press(bell);
  await waitFor(() => expect(router.getPathname()).toBe('/notifications'));
});

it('lists muted items and turns one back on', async () => {
  api.set('GET /api/v1/replenishment/muted', [
    { product: { id: 'p-soap', name: 'Dish soap', unit: null }, muted_at: '2026-11-10T00:00:00Z' },
  ]);
  api.set('DELETE /api/v1/replenishment/muted/p-soap', () => reply(204));
  await open();

  expect(await screen.findByText('Muted items')).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Turn reminders back on for Dish soap' }),
  );
  await waitFor(() =>
    expect(api.calls('DELETE', '/api/v1/replenishment/muted/p-soap')).toHaveLength(1),
  );
  await waitFor(() =>
    expect(useToastStore.getState().message).toBe('Reminders for Dish soap are back on.'),
  );
});

it('hides the muted card when nothing is muted', async () => {
  await open();
  expect(screen.queryByText('Muted items')).toBeNull();
});
