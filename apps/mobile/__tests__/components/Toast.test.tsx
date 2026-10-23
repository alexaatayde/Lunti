import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Toast } from '../../src/components/Toast';

describe('Toast', () => {
  afterEach(() => jest.useRealTimers());

  it('renders nothing when hidden', async () => {
    await render(<Toast visible={false} message="Transaction saved. Budget updated." />);

    expect(screen.queryByText('Transaction saved. Budget updated.')).toBeNull();
  });

  it('shows the message without Undo by default', async () => {
    await render(<Toast visible message="Transaction saved. Budget updated." />);

    expect(screen.getByText('Transaction saved. Budget updated.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('shows Undo when a handler is given and calls it', async () => {
    const onUndo = jest.fn();
    await render(
      <Toast visible message="Transaction deleted. Budget updated." onUndo={onUndo} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('hides itself after the duration', async () => {
    jest.useFakeTimers();
    const onHide = jest.fn();
    await render(<Toast visible message="Saved" onHide={onHide} duration={4000} />);

    expect(onHide).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
