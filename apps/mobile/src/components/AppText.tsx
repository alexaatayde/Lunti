import { Text, type TextProps } from 'react-native';

import { typography, type TypographyVariant } from '../theme';

export type AppTextProps = TextProps & {
  variant?: TypographyVariant;
  color?: string;
};

/** Text with a typography token applied. Extra `style` overrides the variant. */
export function AppText({ variant = 'body', color, style, ...rest }: AppTextProps) {
  return <Text {...rest} style={[typography[variant], color ? { color } : null, style]} />;
}
