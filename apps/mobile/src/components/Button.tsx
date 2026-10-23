import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, font, radius, shadows, sizes, spacing } from '../theme';
import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  /** Icon before the label (e.g. check on "Save expense"). Use the variant's text color. */
  leftIcon?: ReactNode;
  /** Icon after the label (e.g. arrow on "Sign in"). */
  rightIcon?: ReactNode;
  disabled?: boolean;
  /** Shows a spinner and blocks presses. */
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const variantStyles: Record<
  ButtonVariant,
  { container: ViewStyle; text: string; weight: 600 | 700; height: number }
> = {
  // SignIn.html / TxnForm.html: 52 px, primary, white 700, green shadow
  primary: {
    container: { backgroundColor: colors.primary, boxShadow: shadows.primaryButton },
    text: colors.textOnPrimary,
    weight: 700,
    height: sizes.buttonPrimary,
  },
  // DESIGN_HANDOFF.md §2: white + border, 48 px
  secondary: {
    container: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderInput,
    },
    text: colors.textStrong,
    weight: 600,
    height: sizes.buttonSecondary,
  },
  // TxnDelete.html "Delete": dangerText fill, white 700
  danger: {
    container: { backgroundColor: colors.dangerText },
    text: colors.textOnPrimary,
    weight: 700,
    height: sizes.buttonSecondary,
  },
  // TxnDelete.html "Keep it" / TxnAddSheet.html "Cancel": grey fill, 600
  ghost: {
    container: { backgroundColor: colors.surfaceMuted },
    text: colors.textStrong,
    weight: 600,
    height: sizes.buttonSecondary,
  },
};

/** Exported so icons passed in can match the label color. */
export const buttonTextColor = (variant: ButtonVariant) => variantStyles[variant].text;

export function Button({
  label,
  onPress,
  variant = 'primary',
  leftIcon,
  rightIcon,
  disabled,
  loading,
  accessibilityLabel,
  style,
  testID,
}: ButtonProps) {
  const v = variantStyles[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        { height: v.height },
        v.container,
        pressed && !inactive && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text} />
      ) : (
        <View style={styles.content}>
          {leftIcon}
          <AppText
            style={[
              styles.label,
              font(v.weight),
              { color: v.text, fontSize: variant === 'primary' ? 16 : 15 },
            ]}
          >
            {label}
          </AppText>
          {rightIcon}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { lineHeight: 20 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
