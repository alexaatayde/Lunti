import { stepQuantity } from '../../app/meals/pantry';
import {
  amountText,
  daysLeftText,
  engineLabel,
  haveText,
  ingredientStatusText,
  missingText,
  pantryMeta,
  recipeMeta,
  timeRows,
  usesText,
} from '../../src/features/meals/display';
import { addMissingMessage } from '../../src/features/meals/RecipeCard';
import { pantryItem, recipe } from '../../test-utils/fakeApi';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

type R = Parameters<typeof missingText>[0];
type P = Parameters<typeof pantryMeta>[0];
const r = (o = {}) => recipe(o) as unknown as R;
const p = (o = {}) => pantryItem(o) as unknown as P;

it('formats pantry amounts and user-set expiry', () => {
  expect(amountText('1.500', 'kg')).toBe('1.5 kg');
  expect(pantryMeta(p())).toBe('12 pcs');
  expect(pantryMeta(p({ days_left: 1 }))).toBe('12 pcs · Best before in 1 day');
  expect(pantryMeta(p({ days_left: 2, state: 'depleted', quantity: '0.000' }))).toBe('0 pcs');
  expect([-1, 0, 1, 5, null].map(daysLeftText)).toEqual([
    'Past your best-before date',
    'Best before today',
    'Best before in 1 day',
    'Best before in 5 days',
    null,
  ]);
});

it('steps quantities without going below zero or using floats', () => {
  expect(stepQuantity('12.000', 1)).toBe('13');
  expect(stepQuantity('1.000', -1)).toBe('0');
  expect(stepQuantity('0.000', -1)).toBe('0');
  expect(stepQuantity('1.500', 1)).toBe('2.5');
  expect(stepQuantity('0.500', -1)).toBe('0');
});

it('describes recipes from the API figures only', () => {
  expect(recipeMeta(r())).toBe('10 min · 2 servings');
  expect(usesText(r())).toBe('Uses 2 of 3 ingredients you already have.');
  expect(missingText(r())).toBe('1 to buy · about ₱10.00');
  expect(missingText(r({ missing: [] }))).toBe('Nothing to buy');
  expect(missingText(r({ missing_cost: '0.00', missing_unpriced_count: 1 }))).toBe(
    '1 to buy · price unknown',
  );
  const two = r({
    missing: [{}, {}],
    missing_cost: '10.00',
    missing_unpriced_count: 1,
  });
  expect(missingText(two)).toBe('2 to buy · about ₱10.00 + 1 without a price');
});

it('labels AI and template insights honestly', () => {
  const insight = { id: 'x', type: 'spending', message: 'm', generated_at: '' } as const;
  expect(engineLabel({ ...insight, engine: 'ai' })).toBe('AI Insight');
  expect(engineLabel({ ...insight, engine: 'summary' })).toBe('Summary');
});

it('summarises what Add missing did', () => {
  expect(addMissingMessage(2, 0)).toBe('Added 2 items to your list.');
  expect(addMissingMessage(1, 1)).toBe('Added 1 item; 1 already on your list.');
  expect(addMissingMessage(0, 2)).toBe('Those items are already on your grocery list.');
});

// ---------- Phase 8C ----------

it('shows total time and servings on cards, and prep / cook / total on the detail', () => {
  expect(recipeMeta({ prep_time_minutes: 3, total_time_minutes: 10, servings: 2 })).toBe('10 min · 2 servings');
  expect(recipeMeta({ prep_time_minutes: 15, total_time_minutes: 75, servings: 1 })).toBe('1 hr 15 min · 1 serving');
  expect(recipeMeta({ prep_time_minutes: 20, total_time_minutes: 120, servings: 4 })).toBe('2 hr · 4 servings');
  // An API from before migration 0005: prep_time was the whole time.
  expect(recipeMeta({ prep_time_minutes: 60, servings: 4 })).toBe('1 hr · 4 servings');
  expect(timeRows({ prep_time_minutes: 60 })).toEqual([['Total time', '1 hr']]);
  expect(timeRows({ prep_time_minutes: 15, cook_time_minutes: 45, total_time_minutes: 60 })).toEqual([
    ['Prep', '15 min'],
    ['Cook', '45 min'],
    ['Total', '1 hr'],
  ]);
  // Admin recipes without a split: one honest total, no "Cook 0 min".
  expect(timeRows({ prep_time_minutes: 40, cook_time_minutes: 0, total_time_minutes: 40 })).toEqual([
    ['Total time', '40 min'],
  ]);
});

it('says what the pantry has, and whether it is an estimate', () => {
  expect(haveText({ have_quantity: '6.000', have_unit: 'pcs', have_confirmed: false })).toBe(
    'You have about 6 pcs (estimate)',
  );
  expect(haveText({ have_quantity: '0.500', have_unit: 'kg', have_confirmed: true })).toBe(
    'You have 0.5 kg',
  );
  expect(haveText({ have_quantity: null, have_unit: null, have_confirmed: null })).toBeNull();
});

it('words "not enough" apart from "need to buy", never by color alone', () => {
  expect(ingredientStatusText({ status: 'missing', not_enough: true })).toBe('Not enough');
  expect(ingredientStatusText({ status: 'missing', not_enough: false })).toBe('Need to buy');
  expect(ingredientStatusText({ status: 'available', not_enough: false })).toBe('You have it');
  expect(ingredientStatusText({ status: 'check_amount', not_enough: false })).toBe('Check amount');
});
