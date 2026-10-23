import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '../../src/components/Button';

describe('Button', () => {
  it('renders its label as an accessible button and handles presses', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save expense" onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Save expense' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Delete" variant="danger" onPress={onPress} disabled />);

    const button = screen.getByRole('button', { name: 'Delete' });
    await fireEvent.press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
  });

  it('shows a busy state instead of the label while loading', async () => {
    const onPress = jest.fn();
    await render(<Button label="Sign in" onPress={onPress} loading />);

    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeBusy();
    expect(screen.queryByText('Sign in')).toBeNull();

    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
