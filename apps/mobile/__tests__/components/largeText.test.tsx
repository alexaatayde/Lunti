/** Phase 8C: large system font support (Android Font size up to 200 %). */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  AppText,
  Badge,
  BottomNav,
  Button,
  DENSE_FONT_SCALE,
  NAV_FONT_SCALE,
  MAX_FONT_SCALE,
  TextField,
} from '../../src/components';

it('lets text follow the system font size, up to 200 %', async () => {
  await render(<AppText>Hello</AppText>);
  expect(screen.getByText('Hello').props.maxFontSizeMultiplier).toBe(MAX_FONT_SCALE);
  expect(MAX_FONT_SCALE).toBe(2);
});

it('caps fixed-height chrome (badges, bottom nav) so it never clips', async () => {
  await render(<Badge label="66% match" tone="success" />);
  expect(screen.getByText('66% match').props.maxFontSizeMultiplier).toBe(DENSE_FONT_SCALE);
  await render(<BottomNav active="home" onSelect={() => {}} bottomInset={0} />);
  // Emulator at 200 %: 1.3× truncated "Transactions"; nav labels cap lower.
  expect(screen.getByText('Transactions').props.maxFontSizeMultiplier).toBe(NAV_FONT_SCALE);
});

it('buttons and fields grow with the text instead of clipping it, keeping the 44 dp minimum', async () => {
  await render(<Button label="Save expense" />);
  const button = StyleSheet.flatten(screen.getByRole('button', { name: 'Save expense' }).props.style);
  expect(button.height).toBeUndefined();
  expect(button.minHeight).toBeGreaterThanOrEqual(44);

  await render(<TextField label="Email" value="" onChangeText={() => {}} />);
  const input = screen.getByLabelText('Email');
  expect(StyleSheet.flatten(input.props.style).height).toBeUndefined();
});
