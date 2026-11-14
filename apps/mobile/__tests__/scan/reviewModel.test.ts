import { fromCentavos, lineTotal, normalizeQuantity, toCentavos, toMilli } from '../../src/lib/centavos';
import {
  hintFor,
  draftToForm,
  formToConfirm,
  reviewSchema,
  totals,
  type ReviewValues,
} from '../../src/features/scan/reviewModel';
import { receipt } from '../../test-utils/fakeReceipt';

describe('centavos', () => {
  it('parses and formats exactly', () => {
    expect(toCentavos('12.5')).toBe(1250n);
    expect(toCentavos('0.01')).toBe(1n);
    expect(toCentavos('1.005')).toBeNull();
    expect(toCentavos('-1')).toBeNull();
    expect(fromCentavos(1250n)).toBe('12.50');
    expect(fromCentavos(-5n)).toBe('-0.05');
    expect(toMilli('0.525')).toBe(525n);
  });

  it('rounds quantity × price half up like the API', () => {
    expect(lineTotal('0.525', '120.00', '3.15')).toBe(5985n);
    expect(lineTotal('0.333', '1.50')).toBe(50n); // 0.4995 → 0.50
    expect(lineTotal('3', '0.335')).toBeNull(); // prices have at most 2 decimals
    expect(lineTotal('abc', '1')).toBeNull();
    // 0.1 + 0.2 style float errors can't happen
    expect(lineTotal('3', '0.10')).toBe(30n);
  });

  it('normalizes quantities', () => {
    expect(normalizeQuantity('2.000')).toBe('2');
    expect(normalizeQuantity('0.50')).toBe('0.5');
  });
});

describe('review form', () => {
  const base = (): ReviewValues => draftToForm(receipt(), 'c-groceries', new Date());

  it('starts from the OCR draft', () => {
    const values = base();
    expect(values.merchant).toBe('ZZ TEST MART');
    expect(values.total).toBe('140.00');
    expect(values.discount).toBe('9.50');
    expect(values.categoryId).toBe('c-groceries');
    expect(values.items.map((i) => [i.name, i.quantity, i.unitPrice])).toEqual([
      ['BEAR BRAND 33G', '3', '12.50'],
      ['EGGS LARGE', '1', '112.00'],
    ]);
  });

  it('uses now when the receipt has no date', () => {
    const now = new Date('2026-11-11T03:00:00Z');
    const values = draftToForm(
      receipt({ draft: { ...receipt().draft!, occurred_at: null } }),
      'c-groceries',
      now,
    );
    expect(values.occurredAt).toBe(now);
  });

  it('builds the confirm request', () => {
    const body = formToConfirm({ ...base(), merchant: '  ', note: ' Weekly shop ' });
    expect(body).toMatchObject({
      category_id: 'c-groceries',
      merchant: null,
      note: 'Weekly shop',
      total: '140.00',
      discount: '9.50',
    });
    expect(body.items?.[0]).toEqual({
      name: 'BEAR BRAND 33G',
      quantity: '3',
      unit: null,
      unit_price: '12.50',
      discount: '0.00',
    });
  });

  it('reconciles items with the total within one centavo', () => {
    expect(totals(base())).toMatchObject({ itemsSum: 14950n, net: 14000n, mismatch: false });
    expect(totals({ ...base(), total: '140.01' }).mismatch).toBe(false);
    expect(totals({ ...base(), total: '150.00' }).mismatch).toBe(true);
  });

  it('rejects a mismatched total with the amounts in the message', () => {
    const result = reviewSchema.safeParse({ ...base(), total: '150.00' });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path[0] === 'total');
    expect(issue?.message).toBe('Items come to ₱140.00 but the total is ₱150.00.');
  });

  it('validates items, discounts and required fields', () => {
    const items = base().items;
    const bad = reviewSchema.safeParse({
      ...base(),
      total: '',
      items: [{ ...items[0], name: ' ', quantity: '0' }],
    });
    const paths = bad.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['total', 'items.0.name', 'items.0.quantity']));

    const tooMuchOff = reviewSchema.safeParse({
      ...base(),
      discount: '',
      total: '1.00',
      items: [{ ...items[0], quantity: '1', unitPrice: '1.00', discount: '2.00' }],
    });
    expect(tooMuchOff.error!.issues[0].path.join('.')).toBe('items.0.discount');

    const noItems = reviewSchema.safeParse({ ...base(), items: [] });
    expect(noItems.error!.issues[0].path).toEqual(['discount']);
    expect(reviewSchema.safeParse({ ...base(), items: [], discount: '' }).success).toBe(true);
  });
});

it('drops a field hint once the user has edited that field (Phase 8C)', () => {
  const flags = [
    { field: 'occurred_at' as const, code: 'ambiguous', message: 'Check the date.' },
    { field: 'merchant' as const, code: 'low_confidence', message: 'Check the store.' },
  ];
  expect(hintFor(flags, 'occurred_at', false)?.message).toBe('Check the date.');
  expect(hintFor(flags, 'occurred_at', true)).toBeUndefined();
  expect(hintFor(flags, 'merchant', false)?.message).toBe('Check the store.');
  expect(hintFor(flags, 'total', false)).toBeUndefined();
});
