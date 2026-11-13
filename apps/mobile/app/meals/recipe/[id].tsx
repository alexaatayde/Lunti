/**
 * Recipe detail (not designed yet — AGENTS.md §13; built in the existing style). Shows each
 * ingredient's availability from the pantry and adds missing ones to the grocery list.
 * The catalog has ingredients only; cooking steps aren't part of it yet.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRecipe, type Ingredient } from '../../../src/api/hooks';
import {
  AlertTriangleIcon,
  AppText,
  Badge,
  Button,
  Card,
  CheckIcon,
  ChevronLeftIcon,
  PlusIcon,
} from '../../../src/components';
import {
  amountText,
  INGREDIENT_STATUS,
  missingText,
  recipeMeta,
  usesText,
} from '../../../src/features/meals/display';
import { useAddMissing } from '../../../src/features/meals/RecipeCard';
import { ErrorState, LoadingBlocks } from '../../../src/features/money/StateViews';
import { formatMoney } from '../../../src/lib/money';
import { colors, spacing } from '../../../src/theme';

const ICON = {
  available: <CheckIcon size={16} color={colors.primaryChipText} />,
  check_amount: <AlertTriangleIcon size={16} color={colors.warnStrong} />,
  missing: <PlusIcon size={16} color={colors.dangerText} />,
} as const;

export default function RecipeScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const recipe = useRecipe(id);
  const add = useAddMissing();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/meals'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeftIcon size={22} color={colors.text} />
          <AppText variant="body" color={colors.text}>
            Back
          </AppText>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
      >
        {recipe.isPending ? (
          <LoadingBlocks label="Loading recipe" heights={[120, 260]} />
        ) : recipe.isError ? (
          <ErrorState
            message={recipe.error.message}
            onRetry={() => recipe.refetch()}
            retrying={recipe.isFetching}
          />
        ) : (
          <>
            <View style={styles.header}>
              <AppText variant="meta">{recipeMeta(recipe.data)}</AppText>
              <AppText variant="pageTitle" accessibilityRole="header">
                {recipe.data.name}
              </AppText>
              <View style={styles.tags}>
                <Badge label={`${recipe.data.match_pct}% match`} tone="success" />
                <AppText variant="meta">{missingText(recipe.data)}</AppText>
              </View>
              <AppText variant="body">{usesText(recipe.data)}</AppText>
            </View>
            <Card size="list" padding={0}>
              {recipe.data.ingredients.map((ing, i) => (
                <IngredientRow key={`${ing.name}-${i}`} ingredient={ing} border={i > 0} />
              ))}
            </Card>
            {recipe.data.check_amount_count > 0 ? (
              <AppText variant="meta">
                “Check amount” means the receipt didn’t say how much, so Lunti can’t tell if it’s
                enough.
              </AppText>
            ) : null}
            {recipe.data.missing.length > 0 ? (
              <Button
                label="Add missing to list"
                loading={add.isPending}
                onPress={() => void add.run(recipe.data.id)}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function IngredientRow({ ingredient: ing, border }: { ingredient: Ingredient; border: boolean }) {
  const status = INGREDIENT_STATUS[ing.status];
  return (
    <View
      style={[styles.row, border && styles.border]}
      accessible
      accessibilityLabel={`${ing.name}, ${amountText(ing.quantity, ing.unit)}: ${status}${ing.est_price ? `, about ${formatMoney(ing.est_price)}` : ing.status === 'missing' ? ', price unknown' : ''}`}
    >
      {ICON[ing.status]}
      <View style={styles.flex}>
        <AppText variant="rowTitle">{ing.name.charAt(0).toUpperCase() + ing.name.slice(1)}</AppText>
        <AppText variant="meta">
          {amountText(ing.quantity, ing.unit)} ·{' '}
          {ing.pantry_item_name ? `${status} (${ing.pantry_item_name})` : status}
        </AppText>
      </View>
      {ing.est_price ? (
        <AppText variant="meta">~{formatMoney(ing.est_price)}</AppText>
      ) : ing.status === 'missing' ? (
        <AppText variant="meta">Price unknown</AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: spacing.screen, paddingVertical: spacing.sm },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  content: { padding: spacing.screen, paddingTop: 0, gap: spacing.lg },
  header: { gap: spacing.sm },
  tags: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    minHeight: 56,
  },
  border: { borderTopWidth: 1, borderTopColor: colors.border },
  flex: { flex: 1 },
});
