/** Text for restock suggestions, list items and notifications. Pure; money comes from the API. */
import type { AppNotification, ShoppingListItem, Suggestion } from '../../api/hooks';
import { addDays, formatShortDate, localDateKey, todayKey } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { normalizeQuantity } from '../../lib/centavos';

export function dueText(daysUntil: number): string {
  if (daysUntil < -1) return `Due ${-daysUntil} days ago`;
  if (daysUntil === -1) return 'Due yesterday';
  if (daysUntil === 0) return 'Due today';
  if (daysUntil === 1) return 'Due tomorrow';
  return `Due in ${daysUntil} days`;
}

/** "Every ~7 days · due in 2 days" */
export function suggestionLine(s: Suggestion): string {
  const days = s.avg_interval_days ? Math.max(1, Math.round(Number(s.avg_interval_days))) : null;
  const every = days ? `Every ~${days} ${days === 1 ? 'day' : 'days'}` : null;
  const qty = s.quantity ? `${normalizeQuantity(s.quantity)} ${s.product.unit ?? ''}`.trim() : null;
  return [every, dueText(s.days_until), qty ? `qty ${qty}` : null].filter(Boolean).join(' · ');
}

/** "2 kg", "1 bag", "0.5" */
export function quantityText(item: Pick<ShoppingListItem, 'quantity' | 'unit'>): string {
  return `${normalizeQuantity(item.quantity)}${item.unit ? ` ${item.unit}` : ''}`;
}

/** "2 × ₱15.75" when more than one, else null. */
export function unitPriceText(item: ShoppingListItem): string | null {
  if (!item.est_price || normalizeQuantity(item.quantity) === '1') return null;
  return `${normalizeQuantity(item.quantity)} × ${formatMoney(item.est_price)}`;
}

export function sourceLabel(item: ShoppingListItem): string | null {
  if (item.source === 'suggested') return 'Restock';
  if (item.source === 'recipe') return 'From a recipe';
  return null;
}

/** "Just now", "2h ago", "Yesterday", "Oct 20" */
export function timeAgo(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const key = localDateKey(then);
  if (key === todayKey(now)) return `${Math.floor(minutes / 60)}h ago`;
  if (key === addDays(todayKey(now), -1)) return 'Yesterday';
  return formatShortDate(then);
}

export type NotificationTone = 'danger' | 'warn' | 'restock' | 'list';

export function notificationTone(n: AppNotification): NotificationTone {
  if (n.type === 'budget') return n.level === 'exceeded' ? 'danger' : 'warn';
  return n.type === 'replenishment' ? 'restock' : 'list';
}

/** What happened to a restock suggestion, for a card that can no longer be answered. */
export function answeredText(s: Suggestion): string | null {
  if (s.status === 'pending' || s.status === 'modified') return null;
  return s.status === 'added' ? 'Added to your list' : 'Answered';
}

export const isOpen = (s: Suggestion | null | undefined) =>
  !!s && (s.status === 'pending' || s.status === 'modified');
