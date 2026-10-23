import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

describe('test setup', () => {
  it('renders a React Native component', async () => {
    await render(<Text>Lunti</Text>);
    expect(screen.getByText('Lunti')).toBeTruthy();
  });
});
