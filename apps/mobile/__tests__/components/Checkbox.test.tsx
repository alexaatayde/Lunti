import { fireEvent, render, screen } from '@testing-library/react-native';

import { Checkbox } from '../../src/components/Checkbox';

describe('Checkbox', () => {
  it('exposes its checked state and toggles on press', async () => {
    const onChange = jest.fn();
    await render(<Checkbox label="Keep me signed in" checked={false} onChange={onChange} />);

    const box = screen.getByRole('checkbox', { name: 'Keep me signed in' });
    expect(box).not.toBeChecked();

    await fireEvent.press(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('unchecks when already checked', async () => {
    const onChange = jest.fn();
    await render(<Checkbox label="Keep me signed in" checked onChange={onChange} />);

    const box = screen.getByRole('checkbox', { name: 'Keep me signed in' });
    expect(box).toBeChecked();
    await fireEvent.press(box);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('meets the 44 px touch target', async () => {
    await render(<Checkbox label="Keep me signed in" checked={false} onChange={() => {}} />);

    expect(screen.getByRole('checkbox')).toHaveStyle({ minHeight: 44 });
  });
});
