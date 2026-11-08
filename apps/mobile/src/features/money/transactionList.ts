import type { Transaction } from '../../api/hooks';
import { formatDayHeader, localDateKey } from '../../lib/dates';

export type Section = { key: string; title: string; data: Transaction[] };

/** Groups newest-first transactions by local day. */
export function groupByDay(items: Transaction[], now = new Date()): Section[] {
  const sections: Section[] = [];
  for (const item of items) {
    const key = localDateKey(new Date(item.occurred_at));
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.data.push(item);
    else sections.push({ key, title: formatDayHeader(key, now), data: [item] });
  }
  return sections;
}

export function rowMeta(t: Transaction): string {
  const parts = [t.category.name, t.source === 'receipt' ? 'Scanned' : 'Manual'];
  if (t.item_count > 0) parts.push(`${t.item_count} ${t.item_count === 1 ? 'item' : 'items'}`);
  return parts.join(' · ');
}
