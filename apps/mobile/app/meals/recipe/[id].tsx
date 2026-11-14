/**
 * Recipe detail (not designed yet — AGENTS.md §13; built in the existing style and flagged for
 * review). Times and servings, each ingredient with the amount the recipe needs and what the
 * pantry has (estimate or confirmed), basic staples, numbered steps, and "Add missing to list"
 * (adds the recipe's own quantities and units).
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
  haveText,
  ingredientStatusText,
  missingText,
  servingsText,
  timeRows,
  usesText,
} from '../../../src/features/meals/display';
import { useAddMissing } from '../../../src/features/meals/RecipeCard';
import { RecipePhoto } from '../../../src/features/meals/RecipePhoto';
import { ErrorState, LoadingBlocks } from '../../../src/features/money/StateViews';
import { formatMoney } from '../../../src/lib/money';
import { colors, font, radius, spacing } from '../../../src/theme';

const ICON = {
  available: <CheckIcon size={16} color={colors.primaryChipText} />,
  check_amount: <AlertTriangleIcon size={16} color={colors.warnStrong} />,
  missing: <PlusIcon size={16} color={colors.dangerText} />,
} as const;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function RecipeScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const recipe = useRecipe(id);
  const add = useAddMissing();
  // `?? []`: an API from before migration 0005 has no steps or staples; show "not available"
  // instead of crashing while the app and API are on different versions.
  const steps = recipe.data?.steps ?? [];
  const staples = recipe.data?.staples ?? [];

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
          <LoadingBlocks label="Loading recipe" heights={[160, 120, 260]} />
        ) : recipe.isError ? (
          <ErrorState
            message={recipe.error.message}
            onRetry={() => recipe.refetch()}
            retrying={recipe.isFetching}
          />
        ) : (
          <>
            <RecipePhoto height={160} />
            <View style={styles.header}>
              <AppText variant="pageTitle" accessibilityRole="header">
                {recipe.data.name}
              </AppText>
              <View style={styles.tags}>
                <Badge label={`${recipe.data.match_pct}% match`} tone="success" />
                <AppText variant="meta">{missingText(recipe.data)}</AppText>
              </View>
              <AppText variant="body">{usesText(recipe.data)}</AppText>
            </View>

            <View style={styles.facts}>
              {[...timeRows(recipe.data), ['Serves', servingsText(recipe.data.servings)]].map(
                ([label, value]) => (
                  <View
                    key={label}
                    style={styles.fact}
                    accessible
                    accessibilityLabel={`${label}: ${value}`}
                  >
                    <AppText variant="small">{label}</AppText>
                    <AppText variant="rowTitle">{value}</AppText>
                  </View>
                ),
              )}
            </View>

            <AppText variant="sectionTitle" accessibilityRole="header">
              Ingredients
            </AppText>
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
            {recipe.data.ingredients.some((i) => i.have_confirmed === false) ? (
              <AppText variant="meta">
                Amounts marked “estimate” come from your receipts. Confirm them in Pantry.
              </AppText>
            ) : null}
            {recipe.data.missing.length > 0 ? (
              <Button
                label="Add missing to list"
                loading={add.isPending}
                accessibilityLabel={`Add ${recipe.data.missing.length} missing ingredient${recipe.data.missing.length === 1 ? '' : 's'} to grocery list`}
                onPress={() => void add.run(recipe.data.id)}
              />
            ) : null}

            {staples.length > 0 ? (
              <View style={styles.section}>
                <AppText variant="sectionTitle" accessibilityRole="header">
                  You’ll also need
                </AppText>
                <AppText variant="body">{staples.join(' · ')}</AppText>
              </View>
            ) : null}

            <View style={styles.section}>
              <AppText variant="sectionTitle" accessibilityRole="header">
                Steps
              </AppText>
              {steps.length === 0 ? (
                <AppText variant="body">Cooking steps for this recipe aren’t available yet.</AppText>
              ) : (
                steps.map((step, i) => (
                  <View
                    key={i}
                    style={styles.step}
                    accessible
                    accessibilityLabel={`Step ${i + 1} of ${steps.length}. ${step}`}
                  >
                    <View style={styles.stepNumber}>
                      <AppText style={styles.stepNumberText}>{i + 1}</AppText>
                    </View>
                    <AppText variant="bodyLarge" color={colors.text} style={styles.flex}>
                      {step}
                    </AppText>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function IngredientRow({ ingredient: ing, border }: { ingredient: Ingredient; border: boolean }) {
  const status = ingredientStatusText(ing);
  const have = haveText(ing);
  const need = amountText(ing.quantity, ing.unit);
  const price = ing.est_price
    ? `about ${formatMoney(ing.est_price)}`
    : ing.status === 'missing'
      ? 'price unknown'
      : null;
  return (
    <View
      style={[styles.row, border && styles.border]}
      accessible
      accessibilityLabel={[`${ing.name}, needs ${need}`, status, have, price]
        .filter(Boolean)
        .join('. ')}
    >
      {ICON[ing.status]}
      <View style={styles.flex}>
        <AppText variant="rowTitle">{capitalize(ing.name)}</AppText>
        <AppText variant="meta">
          {need} · {status}
        </AppText>
        {have ? (
          <AppText variant="meta" color={ing.not_enough ? colors.dangerText : undefined}>
            {have}
          </AppText>
        ) : null}
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
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fact: {
    flexGrow: 1,
    minWidth: 72,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.iconTile,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderInput,
    gap: spacing.xxs,
  },
  section: { gap: spacing.md },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNumber: {
    minWidth: 28,
    minHeight: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryChipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { ...font(700), fontSize: 14, color: colors.primaryChipText },
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
