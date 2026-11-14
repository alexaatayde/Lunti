import { Text, useWindowDimensions, type TextProps } from 'react-native';

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

/**
 * System font scale from which side-by-side layouts switch to their large-text form (stacked
 * rows, icon-only floating button). Android's steps are 0.85 / 1 / 1.15 / 1.3 / 1.5 / 1.8 / 2.
 */
export const LARGE_TEXT_SCALE = 1.5;

/** True when the user's system font size is LARGE_TEXT_SCALE or more. Re-renders on change. */
export function useLargeText(): boolean {
  return useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;
}

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
