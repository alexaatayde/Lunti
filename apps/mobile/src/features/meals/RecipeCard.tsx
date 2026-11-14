/** "Cook what's here" card (Meals.html): photo placeholder (no licensed photos yet), no savings
 * claim (no data). */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useAddMissingToList, type RecipeSummary } from '../../api/hooks';
import { AppText, Badge, Button, Card, ClockIcon } from '../../components';
import { showToast } from '../../stores/toast';
import { colors, spacing } from '../../theme';
import { missingText, recipeMeta, usesText } from './display';
import { RecipePhoto } from './RecipePhoto';

export function addMissingMessage(added: number, already: number): string {
  if (added === 0 && already === 0) return 'You already have everything for this.';
  if (added === 0) return 'Those items are already on your grocery list.';
  const items = `${added} item${added === 1 ? '' : 's'}`;
  return already
    ? `Added ${items}; ${already} already on your list.`
    : `Added ${items} to your list.`;
}

export function useAddMissing() {
  const add = useAddMissingToList();
  const run = async (recipeId: string) => {
    try {
      const result = await add.mutateAsync(recipeId);
      showToast(addMissingMessage(result.added.length, result.already_on_list.length));
    } catch (error) {
      showToast(`Couldn't add them. ${(error as Error).message}`);
    }
  };
  return { run, isPending: add.isPending };
}

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const add = useAddMissing();
  return (
    <Card style={styles.card}>
      <RecipePhoto height={112} />
      <View style={styles.top}>
        <View style={styles.meta}>
          <ClockIcon size={16} color={colors.textMuted} />
          <AppText variant="meta">{recipeMeta(recipe)}</AppText>
        </View>
        <Badge label={`${recipe.match_pct}% match`} tone="success" />
      </View>
      <AppText variant="sectionTitle">{recipe.name}</AppText>
      <AppText variant="body">{usesText(recipe)}</AppText>
      <AppText variant="meta">{missingText(recipe)}</AppText>
      <View style={styles.actions}>
        <Button
          label="See recipe"
          onPress={() => router.push(`/meals/recipe/${recipe.id}`)}
          style={styles.flex}
        />
        {recipe.missing.length > 0 ? (
          <Button
            label="Add missing"
            variant="secondary"
            loading={add.isPending}
            accessibilityLabel={`Add missing ingredients for ${recipe.name} to list`}
            onPress={() => void add.run(recipe.id)}
            style={styles.flex}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex: { flex: 1 },
});
