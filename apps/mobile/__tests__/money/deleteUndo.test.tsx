/**
 * D4 (Android write-flow validation 2026-11-13): Undo after deleting a transaction did nothing.
 *
 * Root cause: the delete's onSuccess removed the open detail query, so the still-open screen
 * refetched it (a 404) and swapped to its loading state, unmounting the delete dialog while it
 * was open. On Android an unmounted open Modal can leave its invisible full-screen window on top,
 * swallowing every touch — including the Undo toast. Jest can't render native windows, so these
 * tests pin the conditions that caused it, plus Undo's own guarantees.
 */
import { router as nav } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

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

const appDir = './app';
const DETAIL = '/api/v1/transactions/t-1';
let api: ReturnType<typeof mockApi>;

const detail = { ...txn(), items: [], budgets: [] };

beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  useSessionStore.setState({ status: 'loading', session: null });
  useToastStore.setState({ message: null, onUndo: undefined });
  resetFakeSupabase(fakeSession());
  queryClient.clear();
  api = mockApi();
  api.set(`GET ${DETAIL}`, detail);
  api.set(`DELETE ${DETAIL}`, () => reply(204));
  api.set('GET /api/v1/transactions', { items: [txn()], next_cursor: null });
  api.set('POST /api/v1/transactions', () => reply(201, { ...txn(), budget_alerts: [] }));
});

afterEach(() => api.restore());

async function deleteFromDetail() {
  const router = await renderRouter(appDir, { initialUrl: '/transactions' });
  await fireEvent.press(await screen.findByRole('button', { name: /^Greenfield Market/ }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Delete transaction' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(api.calls('DELETE', DETAIL)).toHaveLength(1));
  expect(await screen.findByText('Transaction deleted. Budget updated.')).toBeOnTheScreen();
  await waitFor(() => expect(router.getPathname()).toBe('/transactions'));
  return router;
}

it('never refetches the deleted transaction (the 404 that unmounted the open dialog)', async () => {
  await deleteFromDetail();
  await waitFor(() => expect(api.calls('GET', '/api/v1/transactions').length).toBeGreaterThan(1));

  // Only the first load of the detail; nothing after the DELETE.
  expect(api.calls('GET', DETAIL)).toHaveLength(1);
  // The rest of the money data still refreshes (list, budgets, ...).
  expect(api.calls('GET', '/api/v1/budgets/status').length).toBeGreaterThan(0);
});

it('keeps the open delete dialog up even if the screen drops back to loading', async () => {
  let release: () => void = () => {};
  await renderRouter(appDir, { initialUrl: '/transactions' });
  await fireEvent.press(await screen.findByRole('button', { name: /^Greenfield Market/ }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Delete transaction' }));
  expect(screen.getByText('Delete this transaction?')).toBeOnTheScreen();

  // The old delete's onSuccess dropped this query while the dialog was open, so the open
  // screen lost its data and reloaded (a 404). Reset reproduces that loss directly.
  api.set(`GET ${DETAIL}`, () => new Promise((resolve) => (release = () => resolve(reply(200, detail)))));
  await act(async () => {
    void queryClient.resetQueries({ queryKey: ['transactions', 'detail', 't-1'] });
  });
  expect(await screen.findByLabelText('Loading transaction')).toBeOnTheScreen();

  // The dialog was not unmounted (on Android that left an invisible window over the app).
  expect(screen.getByText('Delete this transaction?')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Keep it' })).toBeOnTheScreen();
  await act(async () => release());
  await fireEvent.press(screen.getByRole('button', { name: 'Keep it' }));
  expect(screen.queryByText('Delete this transaction?')).toBeNull();
  expect(api.calls('DELETE', DETAIL)).toHaveLength(0);
});

it('does not mention a receipt photo for a manual transaction', async () => {
  await renderRouter(appDir, { initialUrl: '/transactions' });
  await fireEvent.press(await screen.findByRole('button', { name: /^Greenfield Market/ }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Delete transaction' }));
  expect(screen.getByText('It will be removed from your history.')).toBeOnTheScreen();
  expect(screen.queryByText(/receipt and its photo/)).toBeNull();
});

it('restores with Undo after moving to another tab', async () => {
  const router = await deleteFromDetail();
  await act(async () => nav.navigate('/home'));
  await waitFor(() => expect(router.getPathname()).toBe('/home'));

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

it('restores only once, however many times Undo fires', async () => {
  await deleteFromDetail();
  const { onUndo } = useToastStore.getState();
  expect(onUndo).toBeDefined();

  // A double tap can reach the handler twice before the toast hides.
  await act(async () => {
    onUndo?.();
    onUndo?.();
  });

  await waitFor(() => expect(api.calls('POST', '/api/v1/transactions')).toHaveLength(1));
  await act(async () => onUndo?.());
  expect(api.calls('POST', '/api/v1/transactions')).toHaveLength(1);
});

it('says so when the restore fails, without retrying behind the user', async () => {
  api.set('POST /api/v1/transactions', () => problem(503, 'Service unavailable.'));
  await deleteFromDetail();

  await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));

  expect(await screen.findByText(/^Couldn't restore it\./)).toBeOnTheScreen();
  expect(api.calls('POST', '/api/v1/transactions')).toHaveLength(1);
});

it('warns that a scanned receipt and its photo go too, and offers no Undo', async () => {
  api.set(`GET ${DETAIL}`, { ...detail, source: 'receipt', receipt_id: 'r-1' });
  await renderRouter(appDir, { initialUrl: '/transactions/t-1' });
  await fireEvent.press(await screen.findByRole('button', { name: 'Delete transaction' }));
  expect(screen.getByText(/The scanned receipt and its photo are deleted too\./)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));

  expect(await screen.findByText('Transaction deleted. Budget updated.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
});
