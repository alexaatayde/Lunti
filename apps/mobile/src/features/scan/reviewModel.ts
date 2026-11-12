/**
 * Receipt review form: OCR draft → editable values → confirm request (SRS 3.1.2).
 * Validation mirrors the API (AGENTS.md §7.1 step 4): required fields, amounts ≥ 0,
 * items minus the receipt discount equal the total within ±₱0.01.
 */
import { z } from 'zod';

import type { Receipt, ReceiptConfirm, ReceiptFlag } from '../../api/hooks';
import { fromCentavos, lineTotal, normalizeQuantity, toCentavos } from '../../lib/centavos';
import { toAmountString } from '../../lib/money';
import { amountField } from '../money/schemas';

const EARLIEST = new Date('2000-01-01T00:00:00Z');
const ONE_DAY_MS = 86_400_000;
const MONEY_TEXT = /^\d*(\.\d{0,2})?$/;
const QTY_TEXT = /^\d+(\.\d{1,3})?$/;

const moneyOrZero = z
  .string()
  .trim()
  .refine((v) => MONEY_TEXT.test(v), { error: 'Use numbers with up to 2 decimals.' });

export const itemSchema = z.object({
  key: z.string(),
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter the item name.' })
    .max(120, { error: 'Use 120 characters or fewer.' }),
  quantity: z
    .string()
    .trim()
    .refine((v) => QTY_TEXT.test(v) && /[1-9]/.test(v), {
      error: 'Use a quantity above 0 (up to 3 decimals).',
    }),
  unit: z.string().nullable(),
  unitPrice: moneyOrZero.refine((v) => /\d/.test(v), { error: 'Enter the price.' }),
  discount: moneyOrZero,
});

export type ReviewItem = z.input<typeof itemSchema>;

export const reviewSchema = z
  .object({
    merchant: z.string().trim().max(120, { error: 'Use 120 characters or fewer.' }),
    occurredAt: z
      .date()
      .refine((d) => d >= EARLIEST, { error: 'That date is too far in the past.' })
      .refine((d) => d.getTime() <= Date.now() + ONE_DAY_MS, {
        error: "Date can't be in the future.",
      }),
    categoryId: z.string().min(1, { error: 'Choose a category.' }),
    total: amountField,
    discount: moneyOrZero,
    note: z.string().trim().max(500, { error: 'Use 500 characters or fewer.' }),
    items: z.array(itemSchema).max(200, { error: 'Up to 200 items.' }),
  })
  .superRefine((values, ctx) => {
    const sums = totals(values);
    if (values.items.length === 0) {
      if (sums.discount !== null && sums.discount > 0n) {
        ctx.addIssue({
          code: 'custom',
          path: ['discount'],
          message: 'Add the items the discount applies to, or remove it.',
        });
      }
      return;
    }
    if (sums.lineErrors.length) {
      for (const index of sums.lineErrors) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'discount'],
          message: "The discount is more than the item's price.",
        });
      }
      return;
    }
    if (sums.mismatch && sums.net !== null && sums.total !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['total'],
        message: `Items come to ${peso(sums.net)} but the total is ${peso(sums.total)}.`,
      });
    }
  });

export type ReviewValues = z.input<typeof reviewSchema>;

function peso(cents: bigint): string {
  const [whole, frac] = fromCentavos(cents).split('.');
  return `₱${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

/** Item line totals, their sum minus the receipt discount, and whether that matches the total. */
export function totals(values: Pick<ReviewValues, 'items' | 'discount' | 'total'>) {
  const lines = values.items.map((i) => lineTotal(i.quantity, i.unitPrice, i.discount));
  const lineErrors = lines.flatMap((l, index) => (l !== null && l < 0n ? [index] : []));
  const valid = lines.every((l) => l !== null);
  const itemsSum = valid ? lines.reduce<bigint>((a, b) => a + (b as bigint), 0n) : null;
  const discount = toCentavos(values.discount || '0');
  const total = toCentavos(values.total);
  const net = itemsSum !== null && discount !== null ? itemsSum - discount : null;
  const diff = net !== null && total !== null ? net - total : null;
  return {
    lines,
    lineErrors,
    itemsSum,
    discount,
    net,
    total,
    mismatch: values.items.length > 0 && diff !== null && (diff > 1n || diff < -1n),
  };
}

let keySeq = 0;
export const newItemKey = () => `item-${++keySeq}`;

/** Default form values from the OCR draft. Missing date → now (flagged on screen). */
export function draftToForm(
  receipt: Receipt,
  fallbackCategoryId: string,
  now: Date = new Date(),
): ReviewValues {
  const draft = receipt.draft;
  return {
    merchant: draft?.merchant ?? '',
    occurredAt: draft?.occurred_at ? new Date(draft.occurred_at) : now,
    categoryId: receipt.suggested_category?.id ?? fallbackCategoryId,
    total: draft?.total ?? '',
    discount: draft && toCentavos(draft.discount) ? draft.discount : '',
    note: '',
    items: (draft?.items ?? []).map((item) => ({
      key: newItemKey(),
      name: item.name,
      quantity: normalizeQuantity(item.quantity),
      unit: item.unit ?? null,
      unitPrice: item.unit_price,
      discount: toCentavos(item.discount) ? item.discount : '',
    })),
  };
}

export function formToConfirm(values: ReviewValues): ReceiptConfirm {
  return {
    category_id: values.categoryId,
    occurred_at: values.occurredAt.toISOString(),
    merchant: values.merchant.trim() || null,
    note: values.note.trim() || null,
    total: toAmountString(values.total),
    discount: values.discount.trim() ? toAmountString(values.discount) : '0.00',
    items: values.items.map((item) => ({
      name: item.name.trim(),
      quantity: normalizeQuantity(item.quantity),
      unit: item.unit,
      unit_price: toAmountString(item.unitPrice),
      discount: item.discount.trim() ? toAmountString(item.discount) : '0.00',
    })),
  };
}

/** The first flag for a field (shown under it with a warning icon and words). */
export function flagFor(flags: ReceiptFlag[], field: ReceiptFlag['field']): ReceiptFlag | undefined {
  return flags.find((f) => f.field === field);
}

/** Confidence chip wording: below 80 % asks the user to check the field. */
export const LOW_CONFIDENCE_PCT = 80;
