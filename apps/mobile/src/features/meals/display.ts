/** Text for the pantry, recipes and insights. Pure; amounts and money come from the API. */
import type { Ingredient, Insight, PantryItem, RecipeSummary } from '../../api/hooks';
import { normalizeQuantity } from '../../lib/centavos';
import { formatMoney } from '../../lib/money';

export function amountText(quantity: string, unit: string | null | undefined): string {
  return `${normalizeQuantity(quantity)}${unit ? ` ${unit}` : ''}`;
}

/** Relative to the best-before date the user set; no food-safety claim either way. */
export function daysLeftText(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  if (days < 0) return 'Past your best-before date';
  if (days === 0) return 'Best before today';
  return `Best before in ${days} ${days === 1 ? 'day' : 'days'}`;
}

export function pantryMeta(item: PantryItem): string {
  const parts = [amountText(item.quantity, item.unit)];
  const days = daysLeftText(item.days_left);
  if (days && item.state !== 'depleted') parts.push(days);
  return parts.join(' · ');
}

export const INGREDIENT_STATUS: Record<Ingredient['status'], string> = {
  available: 'You have it',
  check_amount: 'Check amount',
  missing: 'Need to buy',
};

export function recipeMeta(r: Pick<RecipeSummary, 'prep_time_minutes' | 'servings'>): string {
  return `${r.prep_time_minutes} min · ${r.servings} ${r.servings === 1 ? 'serving' : 'servings'}`;
}

export function usesText(r: RecipeSummary): string {
  const have = r.available_count + r.check_amount_count;
  return `Uses ${have} of ${r.total_count} ingredients you already have.`;
}

/** "Nothing to buy" / "2 to buy · about ₱120.00" / "+ 1 without a price" */
export function missingText(r: RecipeSummary): string {
  const count = r.missing.length;
  if (count === 0) return 'Nothing to buy';
  const priced = count - r.missing_unpriced_count;
  if (priced === 0) return `${count} to buy · price unknown`;
  const unpriced = r.missing_unpriced_count ? ` + ${r.missing_unpriced_count} without a price` : '';
  return `${count} to buy · about ${formatMoney(r.missing_cost)}${unpriced}`;
}

export function engineLabel(insight: Insight): string {
  return insight.engine === 'ai' ? 'AI Insight' : 'Summary';
}
