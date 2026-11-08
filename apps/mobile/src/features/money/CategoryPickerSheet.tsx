import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useCategories, type Category } from '../../api/hooks';
import { AppText, BottomSheet, CheckIcon } from '../../components';
import { colors, font, radius, spacing } from '../../theme';
import { CategoryIcon } from './CategoryIcon';
import { ErrorState, LoadingBlocks } from './StateViews';

export const OVERALL = 'overall';

export type CategoryPickerSheetProps = {
  visible: boolean;
  /** Selected category id, or OVERALL. */
  value: string | null;
  onSelect: (category: Category | typeof OVERALL) => void;
  onClose: () => void;
  /** Budget form: adds "All spending" for an overall budget. */
  includeOverall?: boolean;
};

/** "What was it for?" sheet (TxnCategory.html). Picking a row selects it and closes. */
export function CategoryPickerSheet({
  visible,
  value,
  onSelect,
  onClose,
  includeOverall,
}: CategoryPickerSheetProps) {
  const categories = useCategories();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <AppText variant="eyebrow">Category</AppText>
          <AppText variant="sheetTitle" accessibilityRole="header">
            What was it for?
          </AppText>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Done"
          hitSlop={8}
          style={styles.done}
        >
          <AppText style={styles.doneText}>Done</AppText>
        </Pressable>
      </View>

      {categories.isPending ? (
        <LoadingBlocks label="Loading categories" heights={[64, 64, 64]} />
      ) : categories.isError ? (
        <ErrorState
          message={categories.error.message}
          onRetry={() => categories.refetch()}
          retrying={categories.isFetching}
        />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {includeOverall ? (
            <Row
              label="All spending (overall)"
              icon={null}
              selected={value === OVERALL}
              first
              onPress={() => onSelect(OVERALL)}
            />
          ) : null}
          {categories.data.map((category, index) => (
            <Row
              key={category.id}
              label={category.name}
              icon={category.icon}
              selected={value === category.id}
              first={!includeOverall && index === 0}
              onPress={() => onSelect(category)}
            />
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

function Row({
  label,
  icon,
  selected,
  first,
  onPress,
}: {
  label: string;
  icon: string | null;
  selected: boolean;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        !first && styles.divider,
        selected && styles.rowSelected,
        pressed && styles.pressed,
      ]}
    >
      <CategoryIcon icon={icon} size={44} />
      <AppText style={styles.rowLabel}>{label}</AppText>
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <CheckIcon size={14} color={colors.textOnPrimary} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end' },
  flex: { flex: 1 },
  done: { minHeight: 44, justifyContent: 'center', paddingLeft: spacing.md },
  doneText: { ...font(700), fontSize: 15, color: colors.primaryLink },
  list: {
    maxHeight: 440,
    borderRadius: radius.listCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listContent: { overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowSelected: { backgroundColor: colors.surfaceTint },
  pressed: { opacity: 0.8 },
  rowLabel: { ...font(600), flex: 1, fontSize: 15, color: colors.text },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
