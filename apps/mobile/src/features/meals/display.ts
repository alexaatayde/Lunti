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

/** Status words; "Not enough" when the pantry has some, but less than the recipe needs. */
export function ingredientStatusText(ing: Pick<Ingredient, 'status' | 'not_enough'>): string {
  return ing.status === 'missing' && ing.not_enough ? 'Not enough' : INGREDIENT_STATUS[ing.status];
}

/**
 * What the pantry has for this ingredient, saying whether it's an estimate:
 * "You have about 2 pcs (estimate)" / "You have 2 pcs" / null when nothing matched.
 */
export function haveText(
  ing: Pick<Ingredient, 'have_quantity' | 'have_unit' | 'have_confirmed'>,
): string | null {
  if (ing.have_quantity === null || ing.have_quantity === undefined) return null;
  const amount = amountText(ing.have_quantity, ing.have_unit);
  return ing.have_confirmed ? `You have ${amount}` : `You have about ${amount} (estimate)`;
}

function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function servingsText(servings: number): string {
  return `${servings} ${servings === 1 ? 'serving' : 'servings'}`;
}

type Times = Pick<RecipeSummary, 'prep_time_minutes' | 'cook_time_minutes' | 'total_time_minutes'>;

/** prep + cook; an API from before migration 0005 sends only prep_time (the whole time). */
function totalMinutes(r: Partial<Times> & Pick<Times, 'prep_time_minutes'>): number {
  return r.total_time_minutes ?? r.prep_time_minutes;
}

/** Card meta: total time (prep + cook) and servings. */
export function recipeMeta(
  r: Partial<Times> & Pick<RecipeSummary, 'prep_time_minutes' | 'servings'>,
): string {
  return `${minutes(totalMinutes(r))} · ${servingsText(r.servings)}`;
}

/** [label, value] rows for the recipe detail; cooking time only when the recipe has one. */
export function timeRows(r: Partial<Times> & Pick<Times, 'prep_time_minutes'>): [string, string][] {
  if (!r.cook_time_minutes) return [['Total time', minutes(totalMinutes(r))]];
  return [
    ['Prep', minutes(r.prep_time_minutes)],
    ['Cook', minutes(r.cook_time_minutes)],
    ['Total', minutes(totalMinutes(r))],
  ];
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
