/** How a budget's status reads on screen. Figures come from the API; this only picks words. */
import type { BudgetStatus } from '../../api/hooks';
import type { BadgeTone, ProgressTone } from '../../components';
import { absMoney, formatMoney, isNegativeMoney } from '../../lib/money';
import { formatLongDate, formatPeriod, fromDateKey } from '../../lib/dates';

export const PERIOD_LABELS = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom',
} as const;

export function periodText(status: BudgetStatus, now = new Date()): string {
  const range = formatPeriod(status.period_start, status.period_end, now);
  return `${PERIOD_LABELS[status.budget.period_type]} · ${range}`;
}

/** Status badge (never color alone: each has an icon and words). */
export function levelBadge(
  status: BudgetStatus,
): { label: string; tone: BadgeTone } | null {
  if (status.state === 'upcoming') {
    return { label: `Starts ${formatLongDate(fromDateKey(status.period_start))}`, tone: 'neutral' };
  }
  if (status.state === 'ended') return { label: 'Ended', tone: 'neutral' };
  if (status.level === 'exceeded') return { label: 'Exceeded', tone: 'danger' };
  if (status.level === 'near') return { label: 'Near limit', tone: 'warn' };
  return null;
}

export function progressTone(status: BudgetStatus): ProgressTone {
  if (status.level === 'exceeded') return 'danger';
  if (status.level === 'near') return 'warn';
  return 'normal';
}

/** Fraction for the progress bar (display only; the percentage itself comes from the API). */
export function progressValue(status: BudgetStatus): number {
  return status.percent_used / 100;
}

/** "₱70.00 left" or "Over by ₱20.00". */
export function remainingText(remaining: string): string {
  return isNegativeMoney(remaining)
    ? `Over by ${formatMoney(absMoney(remaining))}`
    : `${formatMoney(remaining)} left`;
}

/** "₱1,930.00 of ₱2,000.00 · 97%" */
export function usageText(status: BudgetStatus): string {
  return `${formatMoney(status.spent)} of ${formatMoney(status.budget.limit_amount)} · ${status.percent_used}%`;
}

/** Message for a budget alert returned by a save, e.g. "Groceries budget is near its limit." */
export function alertText(alert: { label: string; level: 'near' | 'exceeded' }): string {
  const name = alert.label === 'Overall' ? 'Your overall budget' : `Your ${alert.label} budget`;
  return alert.level === 'exceeded' ? `${name} is used up.` : `${name} is near its limit.`;
}

/** The budget Home features: overall monthly, else any monthly, else the first active one. */
export function featuredBudget(statuses: BudgetStatus[]): BudgetStatus | undefined {
  const active = statuses.filter((s) => s.state === 'active');
  return (
    active.find((s) => !s.budget.category && s.budget.period_type === 'monthly') ??
    active.find((s) => s.budget.period_type === 'monthly') ??
    active[0]
  );
}
