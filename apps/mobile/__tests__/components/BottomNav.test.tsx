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
