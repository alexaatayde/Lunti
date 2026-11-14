import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, shadows, sizes } from '../theme';

export type IconButtonProps = {
  icon: ReactNode;
  /** Required: icon-only buttons need a spoken label (DESIGN_HANDOFF.md §5.7). */
  accessibilityLabel: string;
  onPress?: () => void;
};

/** Round 44 px primary button, e.g. "+" next to the Transactions title (Transactions.html). */
export function IconButton({ icon, accessibilityLabel, onPress }: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: sizes.iconButton,
    height: sizes.iconButton,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAction,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.iconButton,
  },
  pressed: { opacity: 0.85 },
});
