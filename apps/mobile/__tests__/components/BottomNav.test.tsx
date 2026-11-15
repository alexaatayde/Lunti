import { fireEvent, render, screen } from '@testing-library/react-native';

import { BottomNav } from '../../src/components/BottomNav';

describe('BottomNav', () => {
  it('shows the five tabs in design order', async () => {
    await render(<BottomNav active="home" onSelect={jest.fn()} />);

    const labels = screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel);
    expect(labels).toEqual(['Analytics', 'Budget', 'Home', 'Meals', 'Transactions']);
  });

  it('marks only the active tab as selected', async () => {
    await render(<BottomNav active="transactions" onSelect={jest.fn()} />);

    expect(screen.getByRole('tab', { name: 'Transactions' })).toBeSelected();
    for (const name of ['Analytics', 'Budget', 'Home', 'Meals']) {
      expect(screen.getByRole('tab', { name })).not.toBeSelected();
    }
  });

  it('reports the pressed tab', async () => {
    const onSelect = jest.fn();
    await render(<BottomNav active="home" onSelect={onSelect} />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Meals' }));

    expect(onSelect).toHaveBeenCalledWith('meals');
  });
});

describe('BottomNav active highlight', () => {
  const { StyleSheet } = jest.requireActual<typeof import('react-native')>('react-native');
  const { colors, font, radius } = jest.requireActual<typeof import('../../src/theme')>(
    '../../src/theme',
  );
  const highlight = (key: string) => StyleSheet.flatten(screen.getByTestId(`tab-${key}-highlight`).props.style);
  const KEYS = ['analytics', 'budget', 'home', 'meals', 'transactions'];

  it('draws one rounded highlight, behind the active item only', async () => {
    await render(<BottomNav active="meals" onSelect={jest.fn()} />);

    expect(highlight('meals').backgroundColor).toBe(colors.navActiveBg);
    expect(highlight('meals').borderRadius).toBe(radius.iconTileLarge);
    for (const key of KEYS.filter((k) => k !== 'meals')) {
      expect(highlight(key).backgroundColor).toBeUndefined();
    }
  });

  it('moves the highlight when the active tab changes', async () => {
    const view = await render(<BottomNav active="home" onSelect={jest.fn()} />);
    expect(highlight('home').backgroundColor).toBe(colors.navActiveBg);

    await view.rerender(<BottomNav active="budget" onSelect={jest.fn()} />);

    expect(highlight('budget').backgroundColor).toBe(colors.navActiveBg);
    expect(highlight('home').backgroundColor).toBeUndefined();
    expect(screen.getByRole('tab', { name: 'Budget' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Home' })).not.toBeSelected();
  });

  it('selects nothing when the screen belongs to no tab', async () => {
    await render(<BottomNav active={null} onSelect={jest.fn()} />);

    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toBeSelected();
    for (const key of KEYS) expect(highlight(key).backgroundColor).toBeUndefined();
  });

  it('shows the active state with more than color: a bold label', async () => {
    await render(<BottomNav active="home" onSelect={jest.fn()} />);

    const label = (name: string) => StyleSheet.flatten(screen.getByText(name).props.style);
    expect(label('Home')).toMatchObject({ ...font(700), color: colors.navActive });
    expect(label('Meals')).toMatchObject({ ...font(500), color: colors.navInactive });

  });

  it('gives every item at least a 48 dp target and keeps long labels on one line', async () => {
    await render(<BottomNav active="transactions" onSelect={jest.fn()} />);

    for (const tab of screen.getAllByRole('tab')) {
      expect(StyleSheet.flatten(tab.props.style).minHeight).toBeGreaterThanOrEqual(48);
      expect(StyleSheet.flatten(tab.props.style).flex).toBe(1);
    }
    const label = screen.getByText('Transactions');
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(label.props.minimumFontScale).toBeGreaterThanOrEqual(0.85);
  });

  it('respects the gesture-bar inset', async () => {
    await render(<BottomNav active="home" onSelect={jest.fn()} bottomInset={34} />);

    const bar = StyleSheet.flatten(screen.getByTestId('bottom-nav').props.style);
    expect(bar.paddingBottom).toBe(34);
  });
});
