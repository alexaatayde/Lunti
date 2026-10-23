import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, font, radius, spacing } from '../theme';
import { AppText } from './AppText';

export type ChipProps = {
  label: string;
  /** Dot color in front of the label (category chip on TxnForm.html). Omit for no dot. */
  dotColor?: string;
};

/** Static category chip: primaryChipBg + primaryChipText (TxnForm.html "Dining out"). */
export function Chip({ label, dotColor }: ChipProps) {
  return (
    <View style={styles.chip}>
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      <AppText style={styles.chipText}>{label}</AppText>
    </View>
  );
}

export type FilterChipProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  /** Icon before the label, e.g. calendar on the month filter. */
  leading?: ReactNode;
  /** Icon after the label, e.g. chevron on the month filter. */
  trailing?: ReactNode;
  accessibilityLabel?: string;
};

/** Pressable filter pill (Transactions.html). Active = primary bg + white text. */
export function FilterChip({
  label,
  active,
  onPress,
  leading,
  trailing,
  accessibilityLabel,
}: FilterChipProps) {
  const hasIcons = !!(leading || trailing);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        styles.filter,
        hasIcons && styles.filterWithIcons,
        active ? styles.filterActive : styles.filterInactive,
        pressed && styles.pressed,
      ]}
    >
      {leading}
      <AppText
        style={[
          styles.filterText,
          active
            ? styles.filterTextActive
            : hasIcons
              ? styles.filterTextDropdown
              : styles.filterTextInactive,
        ]}
      >
        {label}
      </AppText>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: colors.primaryChipBg,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { ...font(700), fontSize: 13, lineHeight: 18, color: colors.primaryChipText },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 34,
  },
  filterWithIcons: { paddingHorizontal: spacing.md },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterInactive: { backgroundColor: colors.surface, borderColor: colors.borderInput },
  pressed: { opacity: 0.8 },
  filterText: { fontSize: 13, lineHeight: 20 },
  filterTextActive: { ...font(600), color: colors.textOnPrimary },
  filterTextInactive: { ...font(500), color: colors.textBody },
  filterTextDropdown: { ...font(600), color: colors.text },
});
