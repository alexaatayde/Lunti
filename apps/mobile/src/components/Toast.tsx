import { useEffect } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, font, radius, shadows, sizes, spacing } from '../theme';
import { AppText } from './AppText';
import { CheckIcon } from './icons';

export type ToastProps = {
  visible: boolean;
  message: string;
  /** Shows the Undo button (e.g. after delete). */
  onUndo?: () => void;
  undoLabel?: string;
  /** Called when the toast times out. */
  onHide?: () => void;
  /** Auto-hide delay in ms; 0 keeps it open. Default 4000. */
  duration?: number;
  /** Override placement; by default it floats 104 px above the bottom, clearing the nav bar. */
  style?: StyleProp<ViewStyle>;
};

/** Dark pill above the nav with a green check and optional Undo (Transactions.dc.html). */
export function Toast({
  visible,
  message,
  onUndo,
  undoLabel = 'Undo',
  onHide,
  duration = 4000,
  style,
}: ToastProps) {
  useEffect(() => {
    if (!visible || !duration || !onHide) return;
    const timer = setTimeout(onHide, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, onHide]);

  if (!visible) return null;

  return (
    <View
      style={[styles.toast, style]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="toast"
    >
      <CheckIcon size={18} color={colors.toastAccent} />
      <AppText style={styles.message}>{message}</AppText>
      {onUndo ? (
        <Pressable
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel={undoLabel}
          hitSlop={6}
          style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
        >
          <AppText style={styles.undoText}>{undoLabel}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: sizes.floatingBottom,
    zIndex: 6,
    minHeight: 48,
    paddingVertical: 6,
    paddingRight: 6,
    paddingLeft: spacing.lg,
    borderRadius: radius.toast,
    backgroundColor: colors.toastBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    boxShadow: shadows.toast,
  },
  message: { ...font(400), flex: 1, fontSize: 14, lineHeight: 20, color: colors.toastText },
  undo: {
    height: 36,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  undoText: { ...font(700), fontSize: 14, lineHeight: 20, color: colors.toastAccent },
});
