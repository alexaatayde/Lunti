/**
 * Text and chart data for the Analytics tab (Analytics.html, SRS 3.1.4–3.1.5). Pure functions:
 * every figure comes from the API; the only arithmetic here is exact centavo sums for the
 * "Others" slice and pixel heights for bars.
 */
import type {
  AnalyticsPeriod,
  AnalyticsSummary,
  CategoryTotal,
  ProductPattern,
} from '../../api/hooks';
import { fromCentavos, toCentavos } from '../../lib/centavos';
import { formatPeriod, formatShortDate, formatTime, fromDateKey } from '../../lib/dates';
import { absMoney, formatMoney } from '../../lib/money';

export const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const COMPARED: Record<AnalyticsPeriod, { title: string; previous: string }> = {
  daily: { title: 'Compared with yesterday', previous: 'yesterday' },
  weekly: { title: 'Compared with last week', previous: 'last week' },
  monthly: { title: 'Compared with last month', previous: 'last month' },
};

export function comparisonTitle(period: AnalyticsPeriod): string {
  return COMPARED[period].title;
}

/** "Oct 1–21" / "Today so far", and "Sep 1–21" / "Yesterday". */
export function windowLabels(s: AnalyticsSummary, now = new Date()) {
  return {
    current: s.period === 'daily' ? 'Today so far' : formatPeriod(s.start, s.end, now),
    previous:
      s.period === 'daily' ? 'Yesterday' : formatPeriod(s.previous_start, s.previous_end, now),
  };
}

/**
 * Today isn't over, so the API stops the previous window at the same time of day. Say so,
 * so the comparison is never read as a partial period against a full one.
 */
export function comparisonNote(s: AnalyticsSummary): string {
  const time = formatTime(new Date(s.compared_until));
  return s.period === 'daily'
    ? `Both days counted up to ${time}.`
    : `Both periods counted to the same day, up to ${time}.`;
}

export type Change = {
  direction: 'down' | 'up' | 'same' | 'none';
  text: string;
};

/** "12% less · ₱1,190.00 saved so far" — direction is also shown with an arrow icon. */
export function changeText(s: AnalyticsSummary): Change {
  const previous = COMPARED[s.period].previous;
  if (s.change_pct === null || s.change_pct === undefined) {
    return {
      direction: 'none',
      text:
        toCentavos(s.total) === 0n
          ? 'No spending recorded yet'
          : `No spending ${previous} to compare with`,
    };
  }
  const amount = formatMoney(absMoney(s.change_amount));
  const cents = toCentavos(absMoney(s.change_amount)) ?? 0n;
  if (cents === 0n) return { direction: 'same', text: `Same as ${previous} so far` };
  const pct = Math.abs(s.change_pct);
  // A tiny change can round to 0 %: still say which way it went.
  const pctText = pct === 0 ? 'Under 1%' : `${pct}%`;
  return s.change_amount.trim().startsWith('-')
    ? { direction: 'down', text: `${pctText} less · ${amount} saved so far` }
    : { direction: 'up', text: `${pctText} more · ${amount} more so far` };
}

export type Slice = {
  key: string;
  name: string;
  categoryId: string | null;
  total: string;
  pct: number;
};

/** Top `max - 1` categories, the rest summed into "Others" (exact centavos). */
export function categorySlices(byCategory: CategoryTotal[], total: string, max = 5): Slice[] {
  const slices: Slice[] = byCategory.map((c) => ({
    key: c.category.id,
    name: c.category.name,
    categoryId: c.category.id,
    total: c.total,
    pct: c.share_pct,
  }));
  if (slices.length <= max) return slices;
  const head = slices.slice(0, max - 1);
  const rest = slices.slice(max - 1);
  const restCents = rest.reduce((sum, s) => sum + (toCentavos(s.total) ?? 0n), 0n);
  const totalCents = toCentavos(total) ?? 0n;
  const pct = totalCents > 0n ? Number((restCents * 200n + totalCents) / (totalCents * 2n)) : 0;
  return [
    ...head,
    {
      key: 'others',
      name: 'Others',
      categoryId: null,
      total: fromCentavos(restCents),
      pct,
    },
  ];
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  timeZone: 'UTC',
});

export function trendTitle(s: AnalyticsSummary): string {
  if (s.period === 'monthly') {
    const month = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      timeZone: 'UTC',
    });
    return `By week, ${month.format(fromDateKey(s.start))}`;
  }
  return s.period === 'weekly' ? 'By day, this week' : 'Last 7 days';
}

export type Bar = {
  key: string;
  label: string;
  /** Spoken label: "Week 1, Oct 1 to 7: ₱1,210.50". */
  description: string;
  total: string;
  future: boolean;
  /** 0–1 of the tallest bar. */
  height: number;
  peak: boolean;
};

export function trendBars(s: AnalyticsSummary): Bar[] {
  const cents = s.trend.map((b) => toCentavos(b.total) ?? 0n);
  const max = cents.reduce((m, c) => (c > m ? c : m), 0n);
  return s.trend.map((b, i) => {
    const label =
      s.trend_granularity === 'week' ? `Wk ${i + 1}` : WEEKDAY.format(fromDateKey(b.start));
    const range =
      b.start === b.end
        ? formatShortDate(fromDateKey(b.start))
        : `${formatShortDate(fromDateKey(b.start))} to ${Number(b.end.slice(8))}`;
    const spoken =
      s.trend_granularity === 'week' ? `Week ${i + 1}, ${range}` : `${label}, ${range}`;
    return {
      key: b.start,
      label,
      description: b.is_future ? `${spoken}: not yet` : `${spoken}: ${formatMoney(b.total)}`,
      total: b.total,
      future: b.is_future,
      height: max > 0n ? Number((cents[i] * 1000n) / max) / 1000 : 0,
      peak: max > 0n && cents[i] === max,
    };
  });
}

// ---------- purchase patterns ----------

/** Products bought once say nothing yet; they would only crowd the list. */
export function visiblePatterns(patterns: ProductPattern[]): ProductPattern[] {
  return patterns.filter((p) => p.data_tier !== 'insufficient' || p.purchase_count >= 2);
}

/** "Every ~12 days · last Oct 11 · avg ₱285.00" or "Bought 2 times · no pattern yet". */
export function patternLine(p: ProductPattern): string {
  if (p.data_tier === 'insufficient' || !p.avg_interval_days) {
    return `Bought ${p.purchase_count} ${p.purchase_count === 1 ? 'time' : 'times'} · no pattern yet`;
  }
  const days = Math.max(1, Math.round(Number(p.avg_interval_days)));
  const parts = [`Every ~${days} ${days === 1 ? 'day' : 'days'}`];
  if (p.last_purchased_at) parts.push(`last ${formatShortDate(new Date(p.last_purchased_at))}`);
  if (p.average_spend) parts.push(`avg ${formatMoney(p.average_spend)}`);
  return parts.join(' · ');
}

/** Minimum confidence for "High confidence" — the replenishment threshold (AGENTS.md §7.4). */
export const HIGH_CONFIDENCE = 0.6;

export type PatternBadge = {
  label: string;
  tone: 'success' | 'neutral' | 'dashed';
};

export function patternBadge(p: ProductPattern): PatternBadge {
  if (p.data_tier === 'insufficient') return { label: 'Insufficient data', tone: 'dashed' };
  if (p.data_tier === 'limited') return { label: 'Limited data', tone: 'neutral' };
  return Number(p.confidence) >= HIGH_CONFIDENCE
    ? { label: 'High confidence', tone: 'success' }
    : { label: 'Irregular timing', tone: 'neutral' };
}
