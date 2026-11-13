import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { queryClient } from '../src/api/queryClient';
import { useSessionStore } from '../src/stores/session';
import { mockApi } from '../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../test-utils/fakeSupabase';

jest.mock('../src/lib/supabase', () => require('../test-utils/fakeSupabase').supabaseModuleMock);

// Renders the real app/ directory to check navigation. Screens with data get an empty fake API.
const appDir = './app';

let api: ReturnType<typeof mockApi>;

describe('navigation (signed in)', () => {
  beforeEach(() => {
    useSessionStore.setState({ status: 'loading', session: null });
    resetFakeSupabase(fakeSession());
    queryClient.clear();
    api = mockApi();
  });

  afterEach(() => api.restore());

  it('starts on the Home tab with Home selected', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/' });

    expect(router.getPathname()).toBe('/home');
    expect(screen.getByRole('tab', { name: 'Home' })).toBeSelected();
    expect(await screen.findByText('Today, at a glance')).toBeOnTheScreen();
  });

  it('switches tabs from the bottom nav', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/home' });

    await fireEvent.press(screen.getByRole('tab', { name: 'Transactions' }));

    expect(router.getPathname()).toBe('/transactions');
    expect(screen.getByRole('tab', { name: 'Transactions' })).toBeSelected();
  });

  it('opens transaction detail with the bottom nav kept', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/transactions/abc' });

    expect(router.getPathname()).toBe('/transactions/abc');
    // The fake API has no such transaction.
    expect(await screen.findByText('This transaction no longer exists.')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Transactions' })).toBeSelected();
  });

  it.each([
    ['/analytics', 'Analytics'],
    ['/budget', 'Budgets'],
    ['/meals', 'Ideas & savings'],
    ['/meals/pantry', 'Pantry'],
    ['/meals/grocery-list', 'Grocery list'],
    ['/budget/new', 'New budget'],
    ['/profile', 'Profile'],
    ['/notifications', 'Notifications'],
    ['/scan/camera', 'Scan receipt'],
    ['/scan/review', 'Scan receipt'],
    ['/scan/failed', 'Scan receipt'],
    ['/expense-form?mode=add', 'New expense'],
    ['/expense-form?mode=edit&id=42', 'Edit transaction'],
    ['/add-transaction', 'How do you want to add it?'],
    ['/category-picker', 'Choose category'],
    ['/dev/components', 'Component gallery'],
  ])('%s shows the "%s" screen', async (url, title) => {
    await renderRouter(appDir, { initialUrl: url });

    expect(
      (await screen.findAllByRole('header')).some((h) => h.props.children === title),
    ).toBe(true);
  });
});
