import { absMoney, formatMoney, isNegativeMoney, toAmountString } from '../../src/lib/money';

describe('formatMoney', () => {
  it.each([
    ['1284.60', '₱1,284.60'],
    ['1284.6', '₱1,284.60'],
    ['6.75', '₱6.75'],
    ['0', '₱0.00'],
    ['0.00', '₱0.00'],
    ['-20.00', '-₱20.00'],
    ['-0.00', '₱0.00'],
    ['9999999999.99', '₱9,999,999,999.99'],
    ['0.1', '₱0.10'],
  ])('%s → %s', (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });

  it('never rounds through floats', () => {
    // As a JS number this would print 0.30000000000000004.
    expect(formatMoney('0.30')).toBe('₱0.30');
    // Above 2^53 a float would lose the cents.
    expect(formatMoney('90071992547409.93')).toBe('₱90,071,992,547,409.93');
  });

  it.each([null, undefined, '', 'abc', '1.2.3'])('shows a dash for %p', (input) => {
    expect(formatMoney(input as string | null | undefined)).toBe('₱—');
  });
});

describe('helpers', () => {
  it('detects negative amounts', () => {
    expect(isNegativeMoney('-20.00')).toBe(true);
    expect(isNegativeMoney('-0.00')).toBe(false);
    expect(isNegativeMoney('20.00')).toBe(false);
    expect(absMoney('-20.00')).toBe('20.00');
  });

  it.each([
    ['6.5', '6.50'],
    ['6', '6.00'],
    ['.5', '0.50'],
    ['007.25', '7.25'],
    ['6.', '6.00'],
  ])('normalizes typed amount %s → %s', (input, expected) => {
    expect(toAmountString(input)).toBe(expected);
  });
});
