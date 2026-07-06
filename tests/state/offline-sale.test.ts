// Phase 6.5 — buildOfflineSale: the pure builder for an OFFLINE sale. It produces
// (1) the durable SALE_CREATE op the sync engine drains, carrying the ivaPct +
// exchangeRate CAPTURED at sale time, and (2) the local PENDING_SYNC receipt shown
// on the success screen (no invoice # yet — the server mints it on sync).
import { describe, expect, test } from 'vitest';
import { buildOfflineSale } from '@/state/offlineSale';
import type { CartItem, Client } from '@/types';

const cola = {
  _id: 'p_cola',
  name: 'Coca-Cola 600ml',
  sku: 'COCA',
  barcode: '7591234567890',
  price: 1.5,
  qty: 2,
  glyph: '🥤',
  exempt: false,
  stock: 5,
  categoryId: 'c1',
  minStock: 5,
} as unknown as CartItem;

const maria = {
  _id: 'c_maria',
  name: 'María González',
  taxPrefix: 'V',
  taxId: '5.123.456',
  kind: 'person',
  createdAt: 0,
} as unknown as Client;

const base = {
  cart: [cola],
  client: maria,
  total: 3.39,
  method: 'cash',
  splits: [{ method: 'cash', amount: 3.39 }],
  ivaPct: 13,
  exchangeRate: 36,
  now: 1_700_000_000_000,
};

describe('buildOfflineSale', () => {
  test('SALE_CREATE payload carries the client id, items, and the CAPTURED rate/IVA', () => {
    const { payload } = buildOfflineSale({ ...base, tendered: 5 });
    expect(payload.clientId).toBe('c_maria');
    expect(payload.items).toEqual([{ productId: 'p_cola', qty: 2 }]);
    expect(payload.method).toBe('cash');
    expect(payload.tendered).toBe(5);
    // The rate + IVA are frozen at sale time — this is what §6.5 is all about.
    expect(payload.ivaPct).toBe(13);
    expect(payload.exchangeRate).toBe(36);
    expect(payload.soldAt).toBe(base.now);
  });

  test('completedSale is a PENDING_SYNC receipt (no invoice) with item + client snapshots', () => {
    const { completedSale } = buildOfflineSale(base);
    expect(completedSale.invoice).toBeNull();
    expect(completedSale.pendingSync).toBe(true);
    expect(completedSale.total).toBe(3.39);
    expect(completedSale.items).toEqual([
      expect.objectContaining({
        productId: 'p_cola',
        name: 'Coca-Cola 600ml',
        qty: 2,
        price: 1.5,
      }),
    ]);
    expect(completedSale.client?.name).toBe('María González');
    expect(completedSale.ivaPct).toBe(13);
    expect(completedSale.exchangeRate).toBe(36);
  });

  test('omits tendered when not provided (card/split sales)', () => {
    const { payload, completedSale } = buildOfflineSale(base);
    expect('tendered' in payload).toBe(false);
    expect(completedSale.tendered).toBeUndefined();
  });
});
