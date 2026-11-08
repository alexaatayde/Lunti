import { groupByDay, rowMeta } from '../../src/features/money/transactionList';
import {
  daysInclusive,
  formatDayHeader,
  formatPeriod,
  formatRelativeDay,
  formatTime,
  localDateKey,
  monthRange,
  shiftMonth,
} from '../../src/lib/dates';
import { txn } from '../../test-utils/fakeApi';

// 2026-11-05 10:00 in Manila.
const NOW = new Date('2026-11-05T02:00:00Z');

describe('dates (Asia/Manila)', () => {
  it('uses Manila days, not the device or UTC day', () => {
    // 23:30 UTC on Nov 4 is 07:30 on Nov 5 in Manila.
    expect(localDateKey(new Date('2026-11-04T23:30:00Z'))).toBe('2026-11-05');
    expect(formatTime(new Date('2026-11-04T23:30:00Z'))).toBe('7:30 am');
    expect(formatTime(new Date('2026-11-05T10:05:00Z'))).toBe('6:05 pm');
  });

  it('labels today and yesterday', () => {
    expect(formatRelativeDay(new Date('2026-11-05T00:15:00Z'), NOW)).toBe('Today, Nov 5');
    expect(formatRelativeDay(new Date('2026-11-04T05:00:00Z'), NOW)).toBe('Yesterday, Nov 4');
    expect(formatDayHeader('2026-11-05', NOW)).toBe('Today · Thu, Nov 5');
    expect(formatDayHeader('2026-11-02', NOW)).toBe('Mon, Nov 2');
  });

  it('builds month ranges and periods', () => {
    expect(monthRange({ year: 2028, month: 2 })).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(formatPeriod('2026-10-01', '2026-10-31', NOW)).toBe('Oct 1–31');
    expect(formatPeriod('2026-10-05', '2026-11-04', NOW)).toBe('Oct 5 – Nov 4');
    expect(formatPeriod('2026-11-05', '2026-11-05', NOW)).toBe('Today');
    expect(daysInclusive('2026-11-01', '2026-11-15')).toBe(15);
  });
});

describe('transaction list helpers', () => {
  it('groups newest-first transactions by Manila day', () => {
    const sections = groupByDay(
      [
        txn({ id: 'a', occurred_at: '2026-11-05T01:00:00Z' }),
        txn({ id: 'b', occurred_at: '2026-11-04T17:00:00Z' }), // Nov 5, 01:00 Manila
        txn({ id: 'c', occurred_at: '2026-11-04T10:00:00Z' }), // Nov 4
      ] as never,
      NOW,
    );
    expect(sections.map((s) => [s.title, s.data.map((t) => t.id)])).toEqual([
      ['Today · Thu, Nov 5', ['a', 'b']],
      ['Yesterday · Wed, Nov 4', ['c']],
    ]);
  });

  it('describes a row like the design', () => {
    expect(rowMeta(txn() as never)).toBe('Groceries · Manual');
    expect(rowMeta(txn({ source: 'receipt', item_count: 7 }) as never)).toBe(
      'Groceries · Scanned · 7 items',
    );
  });
});
