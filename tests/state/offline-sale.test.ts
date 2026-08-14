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

// The receipt must not depend on whether the sale was online. Every CONSUMER of a
// line snapshot became unit-aware; this is the offline PRODUCER, and it silently
// dropped the unit — the same cart printed `1.5 kg` synced and a bare `1.5` here.
describe('buildOfflineSale — the receipt carries the base unit', () => {
  const cheese = {
    _id: 'p_queso',
    name: 'Queso llanero',
    sku: 'QUESO',
    barcode: '7591000001111',
    price: 8,
    qty: 1.5,
    unit: 'kilogram',
    exempt: false,
    stock: 10,
    categoryId: 'c1',
    minStock: 1,
  } as unknown as CartItem;

  test('a measured product keeps its unit on the offline receipt', () => {
    const { completedSale } = buildOfflineSale({ ...base, cart: [cheese] });
    expect(completedSale.items[0].unit).toBe('kilogram');
  });

  test('the SYNC payload deliberately does not carry the unit', () => {
    // The op sends { productId, qty } and nothing else: on sync the server
    // snapshots the unit from the LIVE product, exactly as it does for price and
    // name. Sending it from here would be asking the server to trust a figure
    // the client supplied — the receipt is a local view, not a source of truth.
    const { payload } = buildOfflineSale({ ...base, cart: [cheese] });
    expect(payload.items[0]).toEqual({ productId: 'p_queso', qty: 1.5 });
  });

  test('a counted product carries no unit, exactly as the server omits it', () => {
    // snapshotLines drops the default so a line stays byte-identical to every
    // line already stored. The offline builder mirrors that rule rather than
    // inventing its own.
    const { completedSale } = buildOfflineSale(base);
    expect(completedSale.items[0]).not.toHaveProperty('unit');
  });
});
