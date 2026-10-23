import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadows, spacing } from '../theme';

export type CardProps = {
  children: ReactNode;
  /** `page` = radius 24 (summary/section cards), `list` = radius 20 (row groups). */
  size?: 'page' | 'list';
  /** Inner padding. List groups usually use 0 and let rows pad themselves. */
  padding?: number;
  style?: StyleProp<ViewStyle>;
};

/** White card with a light border and soft shadow. */
export function Card({ children, size = 'page', padding = spacing.card, style }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        { borderRadius: size === 'page' ? radius.pageCard : radius.listCard, padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Highlight card (budget, summary, hero): surfaceTint + borderTint. */
export function TintCard({ children, size = 'page', padding = 18, style }: CardProps) {
  return (
    <View
      style={[
        styles.tint,
        { borderRadius: size === 'page' ? radius.pageCard : radius.listCard, padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: shadows.card,
    overflow: 'hidden',
  },
  tint: {
    backgroundColor: colors.surfaceTint,
    borderWidth: 1,
    borderColor: colors.borderTint,
    overflow: 'hidden',
  },
});
