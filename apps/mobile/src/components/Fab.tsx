import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, font, radius, shadows, sizes, spacing } from '../theme';
import { AppText } from './AppText';
import { CameraIcon } from './icons';

export type FabProps = {
  label: string;
  onPress?: () => void;
  /** Defaults to the camera icon ("Scan receipt"). */
  icon?: ReactNode;
  /** Override placement; by default bottom-right, 104 px up so it clears the nav bar. */
  style?: StyleProp<ViewStyle>;
};

/** Floating pill button (Home.html "Scan receipt"). */
export function Fab({ label, onPress, icon, style }: FabProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.fab, pressed && styles.pressed, style]}
    >
      {icon ?? <CameraIcon size={20} color={colors.textOnPrimary} />}
      <AppText style={styles.label}>{label}</AppText>
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
  pressed: { opacity: 0.9 },
  label: { ...font(600), fontSize: 15, lineHeight: 20, color: colors.textOnPrimary },
});
