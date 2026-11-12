import {
  categorySlices,
  changeText,
  comparisonNote,
  patternBadge,
  patternLine,
  trendBars,
  trendTitle,
  visiblePatterns,
  windowLabels,
} from '../../src/features/analytics/display';
import { analyticsSummary, productPattern } from '../../test-utils/fakeApi';

type Summary = Parameters<typeof changeText>[0];
type Pattern = Parameters<typeof patternLine>[0];
const summary = (o: Partial<Record<string, unknown>> = {}) =>
  analyticsSummary(o) as unknown as Summary;
const pattern = (o: Partial<Record<string, unknown>> = {}) =>
  productPattern(o) as unknown as Pattern;
const cat = (id: string, total: string, share_pct: number) => ({
  category: { id, name: id, icon: null },
  total,
  count: 1,
  share_pct,
});

describe('comparison', () => {
  it('describes less spending as savings, with the API figures', () => {
    expect(
      changeText(
        summary({
          total: '8760.00',
          previous_total: '9950.00',
          change_amount: '-1190.00',
          change_pct: -12,
        }),
      ),
    ).toEqual({ direction: 'down', text: '12% less · ₱1,190.00 saved so far' });
  });

  it('describes more spending, and tiny changes that round to 0%', () => {
    expect(
      changeText(summary({ change_amount: '250.50', change_pct: 25, total: '1250.50' })),
    ).toEqual({
      direction: 'up',
      text: '25% more · ₱250.50 more so far',
    });
    expect(
      changeText(summary({ change_amount: '0.40', change_pct: 0, total: '100.40' })).text,
    ).toBe('Under 1% more · ₱0.40 more so far');
  });

  it('never invents a percentage without previous spending', () => {
    expect(changeText(summary())).toEqual({
      direction: 'none',
      text: 'No spending recorded yet',
    });
    expect(changeText(summary({ total: '50.00', change_amount: '50.00' })).text).toBe(
      'No spending last month to compare with',
    );
    expect(
      changeText(
        summary({
          period: 'weekly',
          total: '5.00',
          previous_total: '5.00',
          change_pct: 0,
        }),
      ),
    ).toEqual({ direction: 'same', text: 'Same as last week so far' });
  });

  it('labels the two windows', () => {
    const now = new Date('2026-10-21T04:00:00Z');
    expect(windowLabels(summary(), now)).toEqual({
      current: 'Oct 1–21',
      previous: 'Sep 1–21',
    });
    expect(
      windowLabels(summary({ period: 'daily', start: '2026-10-21', end: '2026-10-21' }), now),
    ).toEqual({ current: 'Today so far', previous: 'Yesterday' });
  });

  it('says both windows stop at the same time of day', () => {
    expect(comparisonNote(summary())).toBe('Both periods counted to the same day, up to 6:00 pm.');
    expect(
      comparisonNote(summary({ period: 'daily', compared_until: '2026-10-20T10:00:00Z' })),
    ).toBe('Both days counted up to 6:00 pm.');
  });
});

describe('category slices', () => {
  it('keeps up to five categories as they are', () => {
    const slices = categorySlices([cat('a', '60.00', 60), cat('b', '40.00', 40)], '100.00');
    expect(slices.map((s) => [s.name, s.total, s.pct])).toEqual([
      ['a', '60.00', 60],
      ['b', '40.00', 40],
    ]);
  });

  it('sums the rest into Others in exact centavos', () => {
    const slices = categorySlices(
      [
        cat('a', '3680.00', 42),
        cat('b', '1930.00', 22),
        cat('c', '1580.00', 18),
        cat('d', '960.00', 11),
        cat('e', '400.10', 5),
        cat('f', '209.90', 2),
      ],
      '8760.00',
    );
    expect(slices).toHaveLength(5);
    expect(slices[4]).toEqual({
      key: 'others',
      name: 'Others',
      categoryId: null,
      total: '610.00',
      pct: 7,
    });
  });
});

describe('trend', () => {
  it('scales bars to the highest week and marks future weeks', () => {
    const s = summary({
      trend: [
        {
          start: '2026-10-01',
          end: '2026-10-07',
          total: '2450.00',
          is_future: false,
        },
        {
          start: '2026-10-08',
          end: '2026-10-14',
          total: '3330.00',
          is_future: false,
        },
        {
          start: '2026-10-15',
          end: '2026-10-21',
          total: '0.00',
          is_future: false,
        },
        {
          start: '2026-10-22',
          end: '2026-10-31',
          total: '0.00',
          is_future: true,
        },
      ],
    });
    const bars = trendBars(s);
    expect(bars.map((b) => [b.label, b.height, b.peak, b.future])).toEqual([
      ['Wk 1', 0.735, false, false],
      ['Wk 2', 1, true, false],
      ['Wk 3', 0, false, false],
      ['Wk 4', 0, false, true],
    ]);
    expect(bars[0].description).toBe('Week 1, Oct 1 to 7: ₱2,450.00');
    expect(bars[3].description).toBe('Week 4, Oct 22 to 31: not yet');
    expect(trendTitle(s)).toBe('By week, October');
  });

  it('labels days by weekday', () => {
    const s = summary({
      period: 'weekly',
      trend_granularity: 'day',
      trend: [
        {
          start: '2026-10-19',
          end: '2026-10-19',
          total: '40.00',
          is_future: false,
        },
      ],
    });
    expect(trendBars(s)[0]).toMatchObject({
      label: 'Mon',
      description: 'Mon, Oct 19: ₱40.00',
    });
    expect(trendTitle(s)).toBe('By day, this week');
  });
});

describe('purchase patterns', () => {
  it('describes a pattern with interval, last purchase and average spend', () => {
    expect(patternLine(pattern())).toBe('Every ~12 days · last Oct 11 · avg ₱285.00');
    expect(patternBadge(pattern())).toEqual({
      label: 'High confidence',
      tone: 'success',
    });
  });

  it('never shows an interval for insufficient data', () => {
    const p = pattern({
      data_tier: 'insufficient',
      purchase_count: 2,
      avg_interval_days: null,
      confidence: '0.000',
    });
    expect(patternLine(p)).toBe('Bought 2 times · no pattern yet');
    expect(patternBadge(p)).toEqual({
      label: 'Insufficient data',
      tone: 'dashed',
    });
  });

  it('distinguishes limited data and irregular timing', () => {
    expect(patternBadge(pattern({ data_tier: 'limited', confidence: '0.700' })).label).toBe(
      'Limited data',
    );
    expect(patternBadge(pattern({ confidence: '0.400' })).label).toBe('Irregular timing');
  });

  it('hides products bought only once', () => {
    const once = pattern({ data_tier: 'insufficient', purchase_count: 1 });
    const twice = pattern({ data_tier: 'insufficient', purchase_count: 2 });
    expect(visiblePatterns([once, twice, pattern()])).toEqual([twice, pattern()]);
  });
});
