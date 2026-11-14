import { useState, type ReactNode, type Ref } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';

import { colors, font, radius, shadows, sizes, spacing } from '../theme';
import { AppText } from './AppText';
import { AlertCircleIcon } from './icons';

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  /** Icon at the start of the field (mail, lock, search…). Colored textFaint by convention. */
  leftIcon?: ReactNode;
  /** Element at the end of the field, e.g. a show-password button. */
  right?: ReactNode;
  /** Error message; turns the border red and is announced to screen readers. */
  error?: string;
  /** Hide the visible label (still used for accessibility), e.g. the search field. */
  hideLabel?: boolean;
  /** Field height. Forms use 52 (default); the search field uses 44. */
  height?: number;
  /** Lets forms move focus to the next field. */
  ref?: Ref<TextInputInstance>;
};

/**
 * Labelled input (SignIn.html). Focused = 1.5 px primary border + 4 px soft ring.
 */
export function TextField({
  label,
  leftIcon,
  right,
  error,
  hideLabel,
  height = sizes.input,
  ref,
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {hideLabel ? null : <AppText variant="label">{label}</AppText>}
      <View
        style={[
          styles.field,
          { minHeight: height },
          right ? styles.fieldWithRight : null,
          focused && styles.focused,
          !!error && styles.errored,
        ]}
      >
        {leftIcon}
        <TextInput
          {...inputProps}
          ref={ref}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          accessibilityHint={error ?? inputProps.accessibilityHint}
          placeholderTextColor={colors.textMuted}
          cursorColor={colors.primary}
          selectionColor={colors.primary}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={styles.input}
        />
        {right}
      </View>
      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <AlertCircleIcon size={14} color={colors.dangerText} strokeWidth={2.2} />
          <AppText variant="meta" color={colors.dangerText}>
            {error}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderInput,
  },
  fieldWithRight: { paddingRight: 6 },
  focused: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    boxShadow: shadows.focusRing,
  },
  errored: { borderWidth: 1.5, borderColor: colors.dangerText },
  input: {
    flex: 1,
    minWidth: 0,
    // Fills the field's height (which grows with large system fonts).
    alignSelf: 'stretch',
    padding: 0,
    ...font(400),
    fontSize: 15,
    color: colors.text,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
});
