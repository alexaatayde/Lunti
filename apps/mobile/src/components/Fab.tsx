import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, font, radius, shadows, sizes, spacing } from '../theme';
import { AppText, DENSE_FONT_SCALE } from './AppText';
import { CameraIcon } from './icons';

export type FabProps = {
  label: string;
  onPress?: () => void;
  /** Defaults to the camera icon ("Scan receipt"). */
  icon?: ReactNode;
  /** Override placement; by default bottom-right, 104 px up so it clears the nav bar. */
  style?: StyleProp<ViewStyle>;
  /**
   * Icon-only round button (same height, still announced by `label`). Screens pass this at
   * large system font sizes so the floating button covers as little content as possible.
   */
  compact?: boolean;
};

/** Floating pill button (Home.html "Scan receipt"). */
export function Fab({ label, onPress, icon, style, compact = false }: FabProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.fab, compact && styles.compact, pressed && styles.pressed, style]}
    >
      {icon ?? <CameraIcon size={compact ? 24 : 20} color={colors.textOnPrimary} />}
      {compact ? null : (
        // Fixed-height pill: the label grows a little with the system font, never past the pill.
        <AppText style={styles.label} maxFontSizeMultiplier={DENSE_FONT_SCALE}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.screen,
    bottom: sizes.floatingBottom,
    zIndex: 5,
    height: sizes.fab,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAction,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    boxShadow: shadows.fab,
  },
  compact: {
    width: sizes.fab,
    paddingLeft: 0,
    paddingRight: 0,
    justifyContent: 'center',
  },
  pressed: { opacity: 0.9 },
  label: { ...font(600), fontSize: 15, lineHeight: 20, color: colors.textOnPrimary },
});
