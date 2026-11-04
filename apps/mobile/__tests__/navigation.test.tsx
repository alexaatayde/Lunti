import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { useSessionStore } from '../src/stores/session';
import { fakeSession, resetFakeSupabase } from '../test-utils/fakeSupabase';

jest.mock('../src/lib/supabase', () => require('../test-utils/fakeSupabase').supabaseModuleMock);

// Renders the real app/ directory to check the navigation skeleton (build step 1).
const appDir = './app';

describe('navigation skeleton (signed in)', () => {
  beforeEach(() => {
    useSessionStore.setState({ status: 'loading', session: null });
    resetFakeSupabase(fakeSession());
  });

  it('starts on the Home tab with Home selected', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/' });

    expect(router.getPathname()).toBe('/home');
    expect(screen.getByRole('tab', { name: 'Home' })).toBeSelected();
    expect(screen.getAllByRole('header').some((h) => h.props.children === 'Home')).toBe(true);
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
    expect(screen.getByText('Transaction abc')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Transactions' })).toBeSelected();
  });

  it.each([
    ['/analytics', 'Analytics'],
    ['/budget', 'Budget'],
    ['/meals', 'Meals'],
    ['/meals/pantry', 'Pantry'],
    ['/meals/grocery-list', 'Grocery list'],
    ['/budget/new', 'New budget'],
    ['/profile', 'Profile'],
    ['/notifications', 'Notifications'],
    ['/scan/camera', 'Scan receipt'],
    ['/scan/review', 'Review receipt'],
    ['/scan/failed', 'Scan failed'],
    ['/expense-form?mode=add', 'New expense'],
    ['/expense-form?mode=edit&id=42', 'Edit expense'],
    ['/add-transaction', 'Add transaction'],
    ['/category-picker', 'Choose category'],
    ['/dev/components', 'Component gallery'],
  ])('%s shows the "%s" screen', async (url, title) => {
    await renderRouter(appDir, { initialUrl: url });

    expect(screen.getAllByRole('header').some((h) => h.props.children === title)).toBe(true);
  });
});
