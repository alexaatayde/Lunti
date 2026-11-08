/**
 * Dates are shown in the app's time zone (Asia/Manila), the same one the API uses for
 * budget periods and date filters, so "today" means the same thing on both sides.
 */

export const APP_TIME_ZONE = 'Asia/Manila';

const parts = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: APP_TIME_ZONE, ...options }).format(date);

/** Local calendar date "YYYY-MM-DD" in the app time zone. */
export function localDateKey(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** "YYYY-MM-DD" → Date at noon UTC (safe from day shifts when only the date matters). */
export function fromDateKey(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

export function addDays(key: string, days: number): string {
  const d = fromDateKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayKey(now = new Date()): string {
  return localDateKey(now);
}

/** "8:15 am" */
export function formatTime(date: Date): string {
  // Android's Intl puts a narrow no-break space (U+202F) before AM/PM; normalize it.
  return parts(date, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(
    /[\s\u202f]*([AP])M$/i,
    (_, p: string) => ` ${p.toLowerCase()}m`,
  );
}

/** "Thu, May 21" */
export function formatWeekdayDate(date: Date): string {
  return parts(date, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "May 21" */
export function formatShortDate(date: Date): string {
  return parts(date, { month: 'short', day: 'numeric' });
}

/** "Nov 1, 2026" */
export function formatLongDate(date: Date): string {
  return parts(date, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Today, May 21" / "Yesterday, May 20" / "Mon, May 18" */
export function formatRelativeDay(date: Date, now = new Date()): string {
  const key = localDateKey(date);
  const today = todayKey(now);
  if (key === today) return `Today, ${formatShortDate(date)}`;
  if (key === addDays(today, -1)) return `Yesterday, ${formatShortDate(date)}`;
  return formatWeekdayDate(date);
}

/** Section header on Transactions: "TODAY · THU, MAY 21", "MON, MAY 18". */
export function formatDayHeader(key: string, now = new Date()): string {
  const date = fromDateKey(key);
  const label = formatWeekdayDate(date);
  const today = todayKey(now);
  if (key === today) return `Today · ${label}`;
  if (key === addDays(today, -1)) return `Yesterday · ${label}`;
  return label;
}

export type MonthKey = { year: number; month: number }; // month 1–12

export function currentMonth(now = new Date()): MonthKey {
  const [y, m] = todayKey(now).split('-').map(Number);
  return { year: y, month: m };
}

export function shiftMonth({ year, month }: MonthKey, by: number): MonthKey {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** First and last day of a month as "YYYY-MM-DD" (for `from` / `to` filters). */
export function monthRange({ year, month }: MonthKey): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/** "May" (or "May 2025" when not the current year). */
export function formatMonth(m: MonthKey, now = new Date()): string {
  const date = new Date(Date.UTC(m.year, m.month - 1, 15));
  const name = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date);
  return m.year === currentMonth(now).year ? name : `${name} ${m.year}`;
}

/** "Oct 1–31", "Oct 19–25", "Oct 5 – Nov 4", "Today" for a single current day. */
export function formatPeriod(startKey: string, endKey: string, now = new Date()): string {
  if (startKey === endKey) {
    return startKey === todayKey(now) ? 'Today' : formatShortDate(fromDateKey(startKey));
  }
  const start = fromDateKey(startKey);
  const end = fromDateKey(endKey);
  const sameMonth = startKey.slice(0, 7) === endKey.slice(0, 7);
  if (sameMonth) return `${formatShortDate(start)}–${Number(endKey.slice(8))}`;
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

/** Days from start to end, inclusive. */
export function daysInclusive(startKey: string, endKey: string): number {
  const ms = fromDateKey(endKey).getTime() - fromDateKey(startKey).getTime();
  return Math.round(ms / 86_400_000) + 1;
}
