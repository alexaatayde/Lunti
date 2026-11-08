/**
 * Money arrives from the API as decimal strings ("1284.60", "-20.00"). This module only
 * formats them — it never does arithmetic, so no float rounding can creep in (AGENTS.md §4.2).
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** "1284.6" → "₱1,284.60"; "-20" → "-₱20.00". Unparseable input is shown as "₱—". */
export function formatMoney(value: string | null | undefined, currency = '₱'): string {
  const match = DECIMAL.exec((value ?? '').trim());
  if (!match) return `${currency}—`;
  const [, minus, whole, fraction = ''] = match;
  const cents = (fraction + '00').slice(0, 2);
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const isZero = /^0*$/.test(whole) && /^0*$/.test(fraction);
  return `${minus && !isZero ? '-' : ''}${currency}${grouped}.${cents}`;
}

/** Drops the minus sign: "-20.00" → "20.00" (for "Over by ₱20.00"). */
export function absMoney(value: string): string {
  return value.trim().replace(/^-/, '');
}

export function isNegativeMoney(value: string): boolean {
  return /^-\d*\.?\d*[1-9]/.test(value.trim());
}

/** Normalizes what the user typed in an amount field for the API ("6.5" → "6.50"). */
export function toAmountString(input: string): string {
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(input.trim());
  if (!match) return input.trim();
  const whole = match[1] || '0';
  const cents = ((match[2] ?? '') + '00').slice(0, 2);
  return `${whole.replace(/^0+(?=\d)/, '')}.${cents}`;
}
