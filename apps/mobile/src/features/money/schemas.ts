/**
 * Expense and budget form validation (react-hook-form + zod, AGENTS.md §8). Mirrors the API:
 * amounts > 0 with at most 2 decimals and ≤ 9,999,999,999.99; store ≤ 120; note ≤ 500;
 * expense dates from 2000 to no more than a day ahead; custom budgets need an end date.
 */
import { z } from 'zod';

/** NUMERIC(12,2) maximum, compared as text so no float is involved. */
const MAX_WHOLE_DIGITS = 10;

export const amountField = z
  .string()
  .trim()
  .min(1, { error: 'Enter an amount.' })
  .refine((v) => /^\d*(\.\d{0,2})?$/.test(v) && /\d/.test(v), {
    error: 'Use numbers with up to 2 decimals.',
  })
  .refine((v) => /[1-9]/.test(v), { error: 'Amount must be more than ₱0.' })
  .refine((v) => (v.split('.')[0].replace(/^0+/, '') || '0').length <= MAX_WHOLE_DIGITS, {
    error: 'That amount is too large.',
  });

const EARLIEST = new Date('2000-01-01T00:00:00Z');
const ONE_DAY_MS = 86_400_000;

export const expenseSchema = z.object({
  amount: amountField,
  categoryId: z.string().min(1, { error: 'Choose a category.' }),
  occurredAt: z
    .date()
    .refine((d) => d >= EARLIEST, { error: 'That date is too far in the past.' })
    .refine((d) => d.getTime() <= Date.now() + ONE_DAY_MS, {
      error: "Date can't be in the future.",
    }),
  merchant: z.string().trim().max(120, { error: 'Use 120 characters or fewer.' }),
  note: z.string().trim().max(500, { error: 'Use 500 characters or fewer.' }),
});

export type ExpenseFormValues = z.input<typeof expenseSchema>;

export const PERIODS = ['daily', 'weekly', 'monthly', 'custom'] as const;
export type Period = (typeof PERIODS)[number];

export const budgetSchema = z
  .object({
    /** Category id, or "overall". */
    categoryId: z.string().min(1, { error: 'Choose a category.' }),
    periodType: z.enum(PERIODS),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().nullable(),
    limit: amountField,
    alertsEnabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.periodType === 'custom' && !v.endDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Choose an end date.' });
    }
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must be on or after the start date.',
      });
    }
  });

export type BudgetFormValues = z.input<typeof budgetSchema>;
