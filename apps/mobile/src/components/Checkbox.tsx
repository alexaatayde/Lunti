import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, sizes, spacing } from '../theme';
import { AppText } from './AppText';
import { CheckIcon } from './icons';

export type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label. A string is styled as body text; pass a node for custom text. */
  label: ReactNode;
  /** Spoken label; required when `label` is not a plain string. */
  accessibilityLabel?: string;
  /** Shows a red box so the error is not conveyed by text color alone. */
  invalid?: boolean;
  /** Align the box with the first line of a multi-line label (SignUp.html consents). */
  alignTop?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * 18 px box + label (SignIn.html "Keep me signed in", SignUp.html consents).
 * The whole row is the touch target, at least 44 px tall.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  accessibilityLabel,
  invalid,
  alignTop,
  style,
  testID,
}: CheckboxProps) {
  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel ?? (typeof label === 'string' ? label : undefined)}
      hitSlop={4}
      style={({ pressed }) => [
        styles.row,
        alignTop ? styles.alignTop : null,
        pressed && styles.pressed,
        style,
      ]}
    >
      <View
        style={[
          styles.box,
          checked ? styles.checked : null,
          invalid && !checked ? styles.invalid : null,
          alignTop ? styles.boxTop : null,
        ]}
      >
        {checked ? <CheckIcon size={14} color={colors.textOnPrimary} strokeWidth={3} /> : null}
      </View>
      <View style={styles.label}>
        {typeof label === 'string' ? (
          <AppText variant="body" style={styles.labelText}>
            {label}
          </AppText>
        ) : (
          label
        )}
      </View>
    </Pressable>
  );
}

const BOX = 18;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    minHeight: sizes.touchTarget,
  },
  alignTop: { alignItems: 'flex-start', minHeight: 0, paddingVertical: spacing.xxs },
  pressed: { opacity: 0.7 },
  box: {
    width: BOX,
    height: BOX,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.controlBorder,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  boxTop: { marginTop: 1 },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
  invalid: { borderColor: colors.dangerText },
  label: { flex: 1 },
  labelText: { fontSize: 13, lineHeight: 18, color: colors.textBody },
});
