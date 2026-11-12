/**
 * Exact money arithmetic for the receipt review preview, in integer centavos (BigInt), never
 * floats (DESIGN_HANDOFF.md §5.2). The server recomputes every figure when the receipt is
 * saved; this only lets the screen show the items' sum and whether it matches the total.
 */

const MONEY = /^(\d+)(?:\.(\d{0,2}))?$/;
const QUANTITY = /^(\d+)(?:\.(\d{0,3}))?$/;

/** "12.5" → 1250n; null when it isn't a non-negative amount with up to 2 decimals. */
export function toCentavos(value: string): bigint | null {
  const match = MONEY.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt(((match[2] ?? '') + '00').slice(0, 2));
}

/** "0.525" → 525n (thousandths); null when invalid. */
export function toMilli(value: string): bigint | null {
  const match = QUANTITY.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]) * 1000n + BigInt(((match[2] ?? '') + '000').slice(0, 3));
}

/** 1250n → "12.50"; negative values keep their sign. */
export function fromCentavos(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** quantity × unit price, rounded half up to the centavo, minus the discount (as the API). */
export function lineTotal(quantity: string, unitPrice: string, discount = '0'): bigint | null {
  const q = toMilli(quantity);
  const p = toCentavos(unitPrice);
  const d = toCentavos(discount || '0');
  if (q === null || p === null || d === null) return null;
  return (q * p + 500n) / 1000n - d;
}

/** Trims a typed quantity for display/API: "2.000" → "2", "0.50" → "0.5". */
export function normalizeQuantity(value: string): string {
  const match = QUANTITY.exec(value.trim());
  if (!match) return value.trim();
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
