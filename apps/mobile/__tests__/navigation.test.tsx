import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { queryClient } from '../src/api/queryClient';
import { useSessionStore } from '../src/stores/session';
import { mockApi } from '../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../test-utils/preloadRoutes';

jest.mock('../src/lib/supabase', () => require('../test-utils/fakeSupabase').supabaseModuleMock);

// Renders the real app/ directory to check navigation. Screens with data get an empty fake API.
const appDir = './app';

let api: ReturnType<typeof mockApi>;

// Load the route tree once, outside any single test's timeout (see preloadRoutes.ts).
beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

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

describe('tabForPathname', () => {
  const { tabForPathname } = jest.requireActual<
    typeof import('../src/features/navigation/activeTab')
  >('../src/features/navigation/activeTab');

  it.each([
    ['/home', 'home'],
    ['/analytics', 'analytics'],
    ['/budget', 'budget'],
    ['/budget/new', 'budget'],
    ['/meals', 'meals'],
    ['/meals/pantry', 'meals'],
    ['/meals/grocery-list', 'meals'],
    ['/transactions', 'transactions'],
    ['/transactions/abc-123', 'transactions'],
    ['/transactions/abc?from=budget', 'transactions'],
    ['/profile', 'budget'],
    ['/notifications', null],
    ['/scan/camera', null],
    ['/expense-form', null],
    ['/', null],
    ['/homework', null],
  ])('%s → %s', (path, tab) => {
    expect(tabForPathname(path)).toBe(tab);
  });
});

describe('active tab highlight follows the router', () => {
  const { BackHandler } = jest.requireActual<typeof import('react-native')>('react-native');
  const { colors } = jest.requireActual<typeof import('../src/theme')>('../src/theme');
  const { router: appRouter } = jest.requireActual<typeof import('expo-router')>('expo-router');
  const { act } = jest.requireActual<typeof import('expo-router/testing-library')>(
    'expo-router/testing-library',
  );
  const { StyleSheet } = jest.requireActual<typeof import('react-native')>('react-native');

  /** The one selected tab, checked through both the a11y state and the visible highlight. */
  function selectedTab(): string | null {
    const selected = screen
      .queryAllByRole('tab')
      .filter((tab) => String(tab.props.testID ?? '').startsWith('tab-'))
      .filter((tab) => tab.props.accessibilityState?.selected);
    const highlighted = ['analytics', 'budget', 'home', 'meals', 'transactions'].filter(
      (key) =>
        screen.queryByTestId(`tab-${key}-highlight`) &&
        StyleSheet.flatten(screen.getByTestId(`tab-${key}-highlight`).props.style)
          .backgroundColor === colors.navActiveBg,
    );
    expect(selected).toHaveLength(highlighted.length);
    expect(selected.length).toBeLessThanOrEqual(1);
    if (selected.length === 0) return null;
    expect(selected[0].props.testID).toBe(`tab-${highlighted[0]}`);
    return highlighted[0];
  }

  /**
   * Android Back: the OS calls the app's hardwareBackPress listeners, newest first, until one
   * handles it (React Navigation registers one per navigator). Capture and replay them exactly.
   */
  type BackListener = Parameters<typeof BackHandler.addEventListener>[1];
  let backListeners: BackListener[] = [];
  let addListener: jest.SpyInstance;
  async function pressAndroidBack() {
    await act(async () => {
      for (const listener of [...backListeners].reverse()) {
        if (listener({} as Parameters<BackListener>[0])) return;
      }
    });
  }

  beforeEach(() => {
    useSessionStore.setState({ status: 'loading', session: null });
    resetFakeSupabase(fakeSession());
    queryClient.clear();
    api = mockApi();
    backListeners = [];
    const original = BackHandler.addEventListener.bind(BackHandler);
    addListener = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((event, handler) => {
        backListeners.push(handler);
        const subscription = original(event, handler);
        return {
          remove: () => {
            backListeners = backListeners.filter((h) => h !== handler);
            subscription.remove();
          },
        };
      });
  });

  afterEach(() => {
    addListener.mockRestore();
    api.restore();
  });

  it('moves with every tab switch, one tab at a time', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/home' });
    expect(selectedTab()).toBe('home');

    for (const [name, key, path] of [
      ['Analytics', 'analytics', '/analytics'],
      ['Budget', 'budget', '/budget'],
      ['Meals', 'meals', '/meals'],
      ['Transactions', 'transactions', '/transactions'],
      ['Home', 'home', '/home'],
    ] as const) {
      await fireEvent.press(screen.getByRole('tab', { name }));
      expect(router.getPathname()).toBe(path);
      expect(selectedTab()).toBe(key);
    }
  });

  it('Android Back from a tab returns to Home and moves the highlight with it', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/home' });
    await fireEvent.press(screen.getByRole('tab', { name: 'Meals' }));
    expect(selectedTab()).toBe('meals');

    await pressAndroidBack();

    expect(router.getPathname()).toBe('/home');
    expect(selectedTab()).toBe('home');
  });

  it('keeps Transactions selected on a deep-linked detail, and after going back to the list', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/transactions' });
    expect(selectedTab()).toBe('transactions');

    await act(async () => appRouter.push('/transactions/abc'));
    expect(router.getPathname()).toBe('/transactions/abc');
    expect(await screen.findByText('This transaction no longer exists.')).toBeOnTheScreen();
    expect(selectedTab()).toBe('transactions');

    await pressAndroidBack();
    expect(router.getPathname()).toBe('/transactions');
    expect(selectedTab()).toBe('transactions');
  });

  it('switches tab from a nested screen and highlights the new tab', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/transactions/abc' });
    expect(await screen.findByText('This transaction no longer exists.')).toBeOnTheScreen();
    expect(selectedTab()).toBe('transactions');

    await fireEvent.press(screen.getByRole('tab', { name: 'Meals' }));

    expect(router.getPathname()).toBe('/meals');
    expect(selectedTab()).toBe('meals');
  });

  it('opens Profile from a deep link with its parent tab (Budget) selected', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/profile' });
    expect(router.getPathname()).toBe('/profile');
    expect(selectedTab()).toBe('budget');
  });

  it('restores the Home highlight when Back leaves Profile opened from Home', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/home' });
    await act(async () => appRouter.push('/profile'));
    expect(selectedTab()).toBe('budget');

    await pressAndroidBack();
    expect(router.getPathname()).toBe('/home');
    expect(selectedTab()).toBe('home');
  });

  it('shows no tab bar on screens outside the tab structure (Pantry), and restores Meals on Back', async () => {
    const router = await renderRouter(appDir, { initialUrl: '/meals' });
    expect(selectedTab()).toBe('meals');

    await act(async () => appRouter.push('/meals/pantry'));
    expect(router.getPathname()).toBe('/meals/pantry');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);

    await pressAndroidBack();
    expect(router.getPathname()).toBe('/meals');
    expect(selectedTab()).toBe('meals');
  });
});
