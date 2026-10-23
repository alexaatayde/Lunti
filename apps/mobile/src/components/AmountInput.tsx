import { StyleSheet, TextInput, View } from 'react-native';

import { colors, font, typography, spacing } from '../theme';
import { AppText } from './AppText';
import { TintCard } from './Card';

export type AmountInputProps = {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  /** Currency symbol. The market is the Philippines, so ₱ by default (DESIGN_HANDOFF.md §6). */
  currency?: string;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * Big amount entry on a tint card (TxnForm.html). Only digits and one decimal point
 * with up to 2 decimals are accepted; the value stays a string (money is never a float).
 */
export function AmountInput({
  value,
  onChangeText,
  label = 'Amount',
  currency = '₱',
  placeholder = '0.00',
  autoFocus,
}: AmountInputProps) {
  const handleChange = (text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    if (/^\d*(\.\d{0,2})?$/.test(cleaned)) onChangeText(cleaned);
  };

  return (
    <TintCard style={styles.card} padding={0}>
      <AppText variant="small" style={styles.label}>
        {label}
      </AppText>
      <View style={styles.row}>
        <AppText style={styles.currency}>{currency}</AppText>
        <TextInput
          value={value}
          onChangeText={handleChange}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          cursorColor={colors.primary}
          selectionColor={colors.primary}
          autoFocus={autoFocus}
          accessibilityLabel={`${label} in pesos`}
          style={styles.input}
        />
      </View>
    </TintCard>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 18, paddingHorizontal: spacing.xl, alignItems: 'center' },
  label: {
    ...font(700),
    letterSpacing: 0.55,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  currency: { ...font(800), fontSize: 26, lineHeight: 32, color: colors.textMuted },
  input: {
    ...typography.moneyXL,
    minWidth: 120,
    maxWidth: 220,
    padding: 0,
    textAlign: 'center',
  },
});
