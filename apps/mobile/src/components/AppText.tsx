import { Text, type TextProps } from 'react-native';

import { typography, type TypographyVariant } from '../theme';

export type AppTextProps = TextProps & {
  variant?: TypographyVariant;
  color?: string;
};

/**
 * Largest system font scale text follows by default (Android "Font size" up to 200 %). Dense
 * fixed-height chrome (bottom nav, badges) passes a smaller cap so it never clips.
 */
export const MAX_FONT_SCALE = 2;
export const DENSE_FONT_SCALE = 1.3;
/** Bottom-nav labels: the longest ("Transactions") still fits its fifth of a phone width. */
export const NAV_FONT_SCALE = 1.15;

/** Text with a typography token applied. Extra `style` overrides the variant. */
export function AppText({
  variant = 'body',
  color,
  style,
  maxFontSizeMultiplier = MAX_FONT_SCALE,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[typography[variant], color ? { color } : null, style]}
    />
  );
}
