import {
  answeredText,
  dueText,
  isOpen,
  notificationsBackLabel,
  notificationTone,
  quantityText,
  sourceLabel,
  suggestionLine,
  timeAgo,
  unitPriceText,
} from '../../src/features/lists/display';
import { itemSchema, toItemBody } from '../../src/features/lists/ItemSheet';
import { listItem, notification, suggestion } from '../../test-utils/fakeApi';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

type S = Parameters<typeof suggestionLine>[0];
type I = Parameters<typeof quantityText>[0] & Parameters<typeof sourceLabel>[0];
type N = Parameters<typeof notificationTone>[0];
const s = (o = {}) => suggestion(o) as unknown as S;
const item = (o = {}) => listItem(o) as unknown as I;
const n = (o = {}) => notification(o) as unknown as N;

it('describes when a restock is due', () => {
  expect([-3, -1, 0, 1, 5].map(dueText)).toEqual([
    'Due 3 days ago',
    'Due yesterday',
    'Due today',
    'Due tomorrow',
    'Due in 5 days',
  ]);
  expect(suggestionLine(s())).toBe('Every ~7 days · Due in 2 days');
  expect(suggestionLine(s({ quantity: '2.000', avg_interval_days: '12.20' }))).toBe(
    'Every ~12 days · Due in 2 days · qty 2 tray',
  );
});

it('formats list items without float maths', () => {
  expect(quantityText(item({ quantity: '0.500', unit: 'kg' }))).toBe('0.5 kg');
  expect(unitPriceText(item())).toBe('2 × ₱15.75');
  expect(unitPriceText(item({ quantity: '1.000' }))).toBeNull();
  expect(sourceLabel(item({ source: 'suggested' }))).toBe('Restock');
  expect(sourceLabel(item())).toBeNull();
});

it('validates items like the API', () => {
  const ok = itemSchema.safeParse({ name: ' Eggs ', quantity: '1.5', unit: '', price: '95.5' });
  expect(ok.success && toItemBody(ok.data)).toEqual({
    name: 'Eggs',
    quantity: '1.5',
    unit: null,
    est_price: '95.5',
  });
  for (const bad of [
    { name: '', quantity: '1', unit: '', price: '' },
    { name: 'Eggs', quantity: '0', unit: '', price: '' },
    { name: 'Eggs', quantity: '1.2345', unit: '', price: '' },
    { name: 'Eggs', quantity: '1', unit: '', price: '1.999' },
  ]) {
    expect(itemSchema.safeParse(bad).success).toBe(false);
  }
});

it('picks notification tones so status is not color alone', () => {
  expect(notificationTone(n())).toBe('danger');
  expect(notificationTone(n({ level: 'near' }))).toBe('warn');
  expect(notificationTone(n({ type: 'replenishment', level: null }))).toBe('restock');
  expect(notificationTone(n({ type: 'shopping', level: null }))).toBe('list');
});

it('shows relative times and answered suggestions', () => {
  const now = new Date('2026-11-13T06:00:00Z'); // 2 pm Manila
  expect(timeAgo('2026-11-13T05:59:40Z', now)).toBe('Just now');
  expect(timeAgo('2026-11-13T05:15:00Z', now)).toBe('45m ago');
  expect(timeAgo('2026-11-13T02:00:00Z', now)).toBe('4h ago');
  expect(timeAgo('2026-11-12T02:00:00Z', now)).toBe('Yesterday');
  expect(timeAgo('2026-10-20T02:00:00Z', now)).toBe('Oct 20');
  expect(isOpen(s())).toBe(true);
  expect(answeredText(s({ status: 'added' }))).toBe('Added to your list');
  expect(answeredText(s({ status: 'pending' }))).toBeNull();
});

it('labels the Notifications Back link with where it returns to', () => {
  expect(notificationsBackLabel('profile')).toBe('Profile');
  expect(notificationsBackLabel('home')).toBe('Home');
  expect(notificationsBackLabel(undefined)).toBe('Home'); // direct link: Back lands on Home
});
