import { stepQuantity } from '../../app/meals/pantry';
import {
  amountText,
  daysLeftText,
  engineLabel,
  missingText,
  pantryMeta,
  recipeMeta,
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
