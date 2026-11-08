import { Pressable, StyleSheet, View } from 'react-native';

import { colors, font, radius, shadows, spacing } from '../theme';
import { AppText } from './AppText';

export type SegmentedControlProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** `large` = 48 px (Budget.html Budget/Profile), `regular` = 44 px (BudgetCreate.html period). */
  size?: 'regular' | 'large';
};

/** Pill track with a white selected segment (Budget.html, BudgetCreate.html). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  size = 'regular',
}: SegmentedControlProps<T>) {
  return (
    <View
      style={[styles.track, { minHeight: size === 'large' ? 52 : 48 }]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.selected,
              pressed && !selected && styles.pressed,
            ]}
          >
            <AppText
              style={[styles.label, selected ? styles.labelSelected : styles.labelIdle]}
              numberOfLines={1}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: spacing.xs,
    borderRadius: radius.button,
    backgroundColor: colors.surfaceMuted,
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  selected: { backgroundColor: colors.surface, boxShadow: shadows.segment },
  pressed: { opacity: 0.7 },
  label: { fontSize: 15, lineHeight: 20 },
  labelSelected: { ...font(700), color: colors.primaryChipText },
  labelIdle: { ...font(500), color: colors.textMuted },
});
