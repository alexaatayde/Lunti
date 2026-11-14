/**
 * Phase 8D.1: Home at 200 % system font size (emulator findings from Phase 8C):
 * - "Groceries" broke mid-word ("Grocerie/s") because name, amount and share shared one line.
 * - The floating "Scan receipt" pill grew with the text and covered more of the content.
 */
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { DENSE_FONT_SCALE, Fab, LARGE_TEXT_SCALE } from '../../src/components';
import { queryClient } from '../../src/api/queryClient';
import { useSessionStore } from '../../src/stores/session';
import { sizes } from '../../src/theme';
import { budgetStatus, EMPTY_SUMMARY, mockApi } from '../../test-utils/fakeApi';
import { fakeSession, resetFakeSupabase } from '../../test-utils/fakeSupabase';
import { PRELOAD_TIMEOUT_MS, preloadRoutes } from '../../test-utils/preloadRoutes';

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 412, height: 915, scale: 2.625, fontScale: mockFontScale }),
}));
jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

let api: ReturnType<typeof mockApi>;

beforeAll(() => preloadRoutes(), PRELOAD_TIMEOUT_MS);

beforeEach(() => {
  mockFontScale = 1;
  useSessionStore.setState({ status: 'loading', session: null });
  resetFakeSupabase(fakeSession());
  queryClient.clear();
  api = mockApi();
  api.set('GET /api/v1/budgets/status', [
    budgetStatus(
      { spent: '512.40', remaining: '337.60', percent_used: 60, level: 'none', safe_daily_amount: '28.13', on_pace: true },
      { id: 'b-all', category: null, label: 'Overall', limit_amount: '850.00' },
    ),
  ]);
  api.set('GET /api/v1/transactions/summary', {
    ...EMPTY_SUMMARY,
    total: '512.40',
    count: 3,
    by_category: [
      { category: { id: 'c-groceries', name: 'Groceries', icon: 'groceries' }, total: '400.00', count: 2, share_pct: 78 },
      { category: { id: 'c-dining', name: 'Dining out', icon: 'dining' }, total: '112.40', count: 1, share_pct: 22 },
    ],
  });
});

afterEach(() => api.restore());

describe('Fab', () => {
  it('keeps its labelled pill at normal sizes, with the label capped so it fits the pill', async () => {
    await render(<Fab label="Scan receipt" onPress={() => {}} />);
    expect(screen.getByText('Scan receipt').props.maxFontSizeMultiplier).toBe(DENSE_FONT_SCALE);
  });

  it('compact: a round icon button that is still announced and at least 48 dp', async () => {
    const onPress = jest.fn();
    await render(<Fab label="Scan receipt" onPress={onPress} compact />);
    const button = screen.getByRole('button', { name: 'Scan receipt' });
    expect(screen.queryByText('Scan receipt')).toBeNull();
    const style = StyleSheet.flatten(button.props.style);
    expect(style.width).toBe(sizes.fab);
    expect(style.height).toBe(sizes.fab);
    expect(sizes.fab).toBeGreaterThanOrEqual(48);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Home at large font sizes', () => {
  it('normal font size: the Lunti design is unchanged (one line per category, labelled pill)', async () => {
    await renderRouter('./app', { initialUrl: '/home' });
    expect(await screen.findByText('₱400.00')).toBeOnTheScreen();
    expect(screen.queryByTestId('category-figures-c-groceries')).toBeNull();
    expect(screen.getByText('Scan receipt')).toBeOnTheScreen();
  });

  it.each([LARGE_TEXT_SCALE, 2])(
    'at %sx the category name gets its own line and the scan button turns icon-only',
    async (scale) => {
      mockFontScale = scale;
      await renderRouter('./app', { initialUrl: '/home' });

      const figures = await screen.findByTestId('category-figures-c-groceries');
      expect(within(figures).getByText('₱400.00')).toBeOnTheScreen();
      expect(within(figures).getByText('78%')).toBeOnTheScreen();
      // The name is not squeezed onto the same line as the figures.
      expect(within(figures).queryByText('Groceries')).toBeNull();
      expect(screen.getByText('Groceries')).toBeOnTheScreen();
      // Screen readers still get the whole row in one announcement.
      expect(screen.getByLabelText('Groceries: ₱400.00, 78% of spending')).toBeOnTheScreen();

      expect(screen.queryByText('Scan receipt')).toBeNull();
      expect(screen.getByRole('button', { name: 'Scan receipt' })).toBeOnTheScreen();
    },
  );

  it('just below the threshold (1.3x) keeps the normal layout', async () => {
    mockFontScale = 1.3;
    await renderRouter('./app', { initialUrl: '/home' });
    expect(await screen.findByText('₱400.00')).toBeOnTheScreen();
    expect(screen.queryByTestId('category-figures-c-groceries')).toBeNull();
    expect(screen.getByText('Scan receipt')).toBeOnTheScreen();
  });
});
