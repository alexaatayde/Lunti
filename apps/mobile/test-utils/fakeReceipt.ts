/** Receipt API responses for scan tests (synthetic "ZZ Test" data). */
import type { Receipt } from '../src/api/hooks';

export function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'draft',
    created_at: '2026-11-11T02:42:00Z',
    ocr_engine: 'google_vision',
    simulated: false,
    failure_reason: null,
    draft: {
      merchant: 'ZZ TEST MART',
      occurred_at: '2026-11-11T02:42:00Z',
      total: '140.00',
      subtotal: '149.50',
      discount: '9.50',
      vat: '10.00',
      items: [
        {
          name: 'BEAR BRAND 33G',
          quantity: '3',
          unit: null,
          unit_price: '12.50',
          discount: '0',
          line_total: '37.50',
          needs_review: false,
        },
        {
          name: 'EGGS LARGE',
          quantity: '1',
          unit: null,
          unit_price: '112.00',
          discount: '0',
          line_total: '112.00',
          needs_review: false,
        },
      ],
      items_total: '140.00',
    },
    confidence: { store: 86, items: 90, total: 89 },
    flags: [],
    suggested_category: { id: 'c-groceries', name: 'Groceries', icon: 'groceries' },
    possible_duplicate: null,
    transaction_id: null,
    image_url: null,
    ...overrides,
  };
}

export function failedReceipt(reason: 'unreadable' | 'no_amounts' = 'unreadable'): Receipt {
  return receipt({
    status: 'failed',
    failure_reason: reason,
    draft: null,
    confidence: null,
    suggested_category: null,
  });
}
