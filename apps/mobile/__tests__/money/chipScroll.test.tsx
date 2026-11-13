/**
 * D3 (emulator validation 2026-11-13): opening Transactions from an Analytics category selected
 * that chip but left it past the right edge of the chip row, so nothing looked selected.
 */
import { render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { createRef, type ComponentRef } from 'react';
import { ScrollView } from 'react-native';

import { queryClient } from '../../src/api/queryClient';
import { revealOffset } from '../../src/features/money/chipScroll';
import { useSessionStore } from '../../src/stores/session';
import { mockApi } from '../../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

describe('revealOffset', () => {
  const viewport = { offset: 0, width: 390 };

  it('leaves a fully visible chip alone', () => {
    expect(revealOffset({ x: 100, width: 80 }, viewport, 20)).toBeNull();
  });

  it('scrolls right just far enough to show a chip past the right edge, with margin', () => {
    expect(revealOffset({ x: 700, width: 90 }, viewport, 20)).toBe(420);
  });

  it('scrolls left to a chip before the left edge, never below 0', () => {
    expect(revealOffset({ x: 300, width: 80 }, { offset: 500, width: 390 }, 20)).toBe(280);
    expect(revealOffset({ x: 10, width: 80 }, { offset: 200, width: 390 }, 20)).toBe(0);
  });

  it('waits until the row has been measured', () => {
    expect(revealOffset({ x: 700, width: 90 }, { offset: 0, width: 0 })).toBeNull();
  });
});

type ScrollToTarget = { scrollTo: (o: { x: number; animated: boolean }) => void };

describe('Transactions chip row', () => {
  let api: ReturnType<typeof mockApi>;
  let scrollTo: jest.SpyInstance;
  let scrollViewPrototype: ScrollToTarget;

  beforeAll(async () => {
    // The ScrollView test double keeps scrollTo on one shared prototype: spy on that.
    const probe = createRef<ComponentRef<typeof ScrollView>>();
    const { unmount } = await render(<ScrollView ref={probe} />);
    scrollViewPrototype = Object.getPrototypeOf(probe.current);
    await unmount();
    await preloadRoutes();
  }, PRELOAD_TIMEOUT_MS);

  beforeEach(() => {
    useSessionStore.setState({ status: 'loading', session: null });
    resetFakeSupabase(fakeSession());
    queryClient.clear();
    api = mockApi();
    scrollTo = jest.spyOn(scrollViewPrototype, 'scrollTo');
  });

  afterEach(() => {
    api.restore();
    scrollTo.mockRestore();
  });

  const layout = (testID: string, values: Record<string, number>) =>
    fireEvent(screen.getByTestId(testID), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, height: 44, width: 0, ...values } },
    });

  /** A 390-wide row: month chip, All and Groceries on screen; Household and Others off it. */
  async function openFromAnalytics() {
    await renderRouter('./app', { initialUrl: '/transactions?category=c-others&month=2026-11' });
    await screen.findByTestId('chip-c-others');
    await layout('category-chips', { width: 390 });
    await layout('chip-all', { x: 150, width: 60 });
    await layout('chip-c-groceries', { x: 220, width: 110 });
    await layout('chip-c-household', { x: 560, width: 110 });
    await layout('chip-c-others', { x: 700, width: 90 });
  }

  it('scrolls the category opened from Analytics into view, without animation', async () => {
    await openFromAnalytics();

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ x: 420, animated: false });
    // The filter from Analytics is kept.
    expect(screen.getByRole('button', { name: 'Others', selected: true })).toBeOnTheScreen();
    expect(api.calls('GET', '/api/v1/transactions')[0].query.get('category_id')).toBe('c-others');
  });

  it('retries when Android clamped the first jump because the content width was not known', async () => {
    await openFromAnalytics();
    // The native row ignored the scrollTo (still at 0), then reports its content size.
    await fireEvent.scroll(screen.getByTestId('category-chips'), {
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
    scrollTo.mockClear();

    await fireEvent(screen.getByTestId('category-chips'), 'contentSizeChange', 820, 44);
    expect(scrollTo).toHaveBeenCalledWith({ x: 420, animated: false });

    // Once the row really is there, later size changes leave it alone.
    await fireEvent.scroll(screen.getByTestId('category-chips'), {
      nativeEvent: { contentOffset: { x: 420, y: 0 } },
    });
    scrollTo.mockClear();
    await fireEvent(screen.getByTestId('category-chips'), 'contentSizeChange', 820, 44);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not jump for a chip already on screen, but reveals one that is not', async () => {
    await openFromAnalytics();
    // The user scrolls back to the start of the row.
    await fireEvent.scroll(screen.getByTestId('category-chips'), {
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
    scrollTo.mockClear();

    await fireEvent.press(screen.getByRole('button', { name: 'Groceries' }));
    expect(screen.getByRole('button', { name: 'Groceries', selected: true })).toBeOnTheScreen();
    expect(scrollTo).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Groceries' })); // back to All
    expect(screen.getByRole('button', { name: 'All', selected: true })).toBeOnTheScreen();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('reveals the chip when a new Analytics link arrives while the tab stays open', async () => {
    await openFromAnalytics();
    await fireEvent.scroll(screen.getByTestId('category-chips'), {
      nativeEvent: { contentOffset: { x: 0, y: 0 } },
    });
    scrollTo.mockClear();

    await act(async () => router.setParams({ category: 'c-household' }));

    expect(screen.getByRole('button', { name: 'Household', selected: true })).toBeOnTheScreen();
    expect(scrollTo).toHaveBeenCalledWith({ x: 300, animated: false });
  });
});
