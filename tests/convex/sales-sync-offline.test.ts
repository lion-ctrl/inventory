/// <reference types="vite/client" />
// Phase 6.3 — sales.syncOffline: the idempotent sibling of checkout that drains
// offline sales. Proves idempotent replay (no double-charge), server-side stock
// re-validation with structured §15 conflict codes, and the offline metadata.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import schema from '@convex/schema';
import type { Id } from '@convex/_generated/dataModel';
import { seedBase } from './fixtures';
import type { Fixtures } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx: Fixtures = await t.run(seedBase);
  return { t, fx };
}

const cash = (amount: number) => [{ method: 'cash', amount }];

// A fixed offline sale timestamp — syncOffline must persist THIS, not Date.now().
const SOLD_AT = 1_700_000_000_000;

/** Build syncOffline args with sensible defaults + per-test overrides. */
function syncArgs(
  fx: Fixtures,
  over: {
    idempotencyKey: string;
    items: { productId: Id<'products'>; qty: number }[];
    splits: { method: string; amount: number }[];
    token?: string;
    clientId?: Id<'clients'>;
    deviceId?: string;
    tendered?: number;
    soldAt?: number;
    ivaPct?: number;
    exchangeRate?: number;
  }
) {
  return {
    token: over.token ?? fx.ownerToken,
    idempotencyKey: over.idempotencyKey,
    deviceId: over.deviceId ?? 'device-1',
    clientId: over.clientId ?? fx.clientId,
    items: over.items,
    method: 'cash',
    splits: over.splits,
    ...(over.tendered !== undefined ? { tendered: over.tendered } : {}),
    // Captured at sale time (§6.5). Defaults match the seeded settings (ivaPct 13)
    // so the existing money-math assertions are unchanged.
    ivaPct: over.ivaPct ?? 13,
    exchangeRate: over.exchangeRate ?? 36,
    soldAt: over.soldAt ?? SOLD_AT,
  };
}

describe('sales.syncOffline', () => {
  test('creates an official sale on first sync — shared money math, offline soldAt preserved', async () => {
    const { t, fx } = await setup();
    const sale = await t.mutation(
      api.sales.syncOffline,
      syncArgs(fx, {
        idempotencyKey: 'idem-first',
        items: [
          { productId: fx.cola, qty: 2 },
          { productId: fx.agua, qty: 1 },
        ],
        splits: cash(4.19),
        tendered: 5,
      })
    );

    // Same money path as checkout: subtotal 3.80, taxable base 3.00, IVA 0.39.
    expect(sale.subtotal).toBe(3.8);
    expect(sale.tax).toBe(0.39);
    expect(sale.total).toBe(4.19);
    // Official invoice number is minted server-side from the seeded counter.
    expect(sale.invoiceNumber).toBe('00000043');
    // The OFFLINE sale time is preserved verbatim — not overwritten with now().
    expect(sale.soldAt).toBe(SOLD_AT);
    // Snapshots + offline metadata are frozen onto the sale.
    expect(sale.cashierName).toBe('Carlos Méndez');
    expect(sale.idempotencyKey).toBe('idem-first');
    expect(sale.deviceId).toBe('device-1');
  });

  test('stamps the IVA % and Bs rate CAPTURED at sale time, NOT live settings (Bs volatility, §6.5)', async () => {
    const { t, fx } = await setup();
    // The sale was made OFFLINE when IVA was 10% and the Bs rate was 50; the
    // server's live settings differ (seeded ivaPct 13). The synced sale must keep
    // the captured values — total computed with 10%, exchangeRate stamped 50 —
    // never re-priced with today's rate.
    const sale = await t.mutation(
      api.sales.syncOffline,
      syncArgs(fx, {
        idempotencyKey: 'idem-rate',
        items: [{ productId: fx.cola, qty: 2 }], // 2 × 1.50 = 3.00, fully taxable
        splits: cash(3.3),
        ivaPct: 10,
        exchangeRate: 50,
      })
    );
    expect(sale.subtotal).toBe(3.0);
    expect(sale.tax).toBe(0.3); // 10% of 3.00, NOT the live 13%
    expect(sale.total).toBe(3.3);
    expect(sale.ivaPct).toBe(10); // captured at sale time, not live 13
    expect(sale.exchangeRate).toBe(50); // captured at sale time, not live rate
  });

  test('replaying the SAME idempotencyKey returns the SAME sale — no duplicate, counter + stock advance once', async () => {
    const { t, fx } = await setup();
    const args = syncArgs(fx, {
      idempotencyKey: 'idem-replay',
      items: [{ productId: fx.cola, qty: 2 }],
      splits: cash(3.39),
    });

    const first = await t.mutation(api.sales.syncOffline, args);
    const replay = await t.mutation(api.sales.syncOffline, args);

    // The replay returns the EXACT same sale row, not a new one.
    expect(replay._id).toBe(first._id);

    const after = await t.run(async (ctx) => ({
      count: (await ctx.db.query('sales').collect()).length,
      cola: await ctx.db.get('products', fx.cola),
      settings: await ctx.db.get('settings', fx.settingsId),
    }));
    // One sale, one stock decrement, one invoice number consumed — never twice.
    expect(after.count).toBe(1);
    expect(after.cola!.stock).toBe(22); // 24 − 2, applied once
    expect(after.settings!.nextInvoiceNumber).toBe(44); // 43 → 44, once
  });

  test('stores idempotencyKey + deviceId and is retrievable via the by_idempotencyKey index', async () => {
    const { t, fx } = await setup();
    const sale = await t.mutation(
      api.sales.syncOffline,
      syncArgs(fx, {
        idempotencyKey: 'idem-store',
        deviceId: 'device-42',
        items: [{ productId: fx.cola, qty: 1 }],
        splits: cash(1.7),
      })
    );

    const stored = await t.run(async (ctx) => {
      const doc = await ctx.db.get('sales', sale._id);
      const byIndex = await ctx.db
        .query('sales')
        .withIndex('by_idempotencyKey', (q) =>
          q.eq('idempotencyKey', 'idem-store')
        )
        .unique();
      return { doc, byIndex };
    });

    expect(stored.doc!.idempotencyKey).toBe('idem-store');
    expect(stored.doc!.deviceId).toBe('device-42');
    // The index resolves the exact row — this is what the replay lookup uses.
    expect(stored.byIndex!._id).toBe(sale._id);
  });

  test('insufficient stock → structured ConvexError STOCK_INSUFFICIENT (no sale, no stock consumed)', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(
        api.sales.syncOffline,
        syncArgs(fx, {
          idempotencyKey: 'idem-stock',
          items: [{ productId: fx.cafe, qty: 3 }], // café stock is 2
          splits: cash(19.66),
        })
      )
    ).rejects.toMatchObject({ data: { code: 'STOCK_INSUFFICIENT' } });

    // The rejected sync is fully rolled back: no sale row, no stock consumed.
    const after = await t.run(async (ctx) => ({
      count: (await ctx.db.query('sales').collect()).length,
      cafe: await ctx.db.get('products', fx.cafe),
    }));
    expect(after.count).toBe(0);
    expect(after.cafe!.stock).toBe(2);
  });

  test('paused product is STILL SOLD offline (a consummated sale outranks a later pause)', async () => {
    const { t, fx } = await setup();
    const before = await t.run(
      async (ctx) => (await ctx.db.get('products', fx.pintura))!.stock
    );
    // The cashier sold this product offline; the server paused it AFTER. Since
    // syncOffline passes enforceSellable:false, the already-charged sale is
    // ACCEPTED (not rejected) — the pause is a post-sale condition the cashier
    // could not have known. The stock is still decremented (the sale is real).
    const sale = await t.mutation(
      api.sales.syncOffline,
      syncArgs(fx, {
        idempotencyKey: 'idem-paused',
        items: [{ productId: fx.pintura, qty: 1 }], // sellable: false on the server
        splits: cash(25.43),
      })
    );
    expect(sale.idempotencyKey).toBe('idem-paused');
    expect(sale.items.map((i) => i.productId)).toContain(fx.pintura);
    const after = await t.run(
      async (ctx) => (await ctx.db.get('products', fx.pintura))!.stock
    );
    expect(after).toBe(before - 1);
  });

  test('deleted product → structured PRODUCT_DELETED', async () => {
    const { t, fx } = await setup();
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert('products', {
        barcode: '7590000000000',
        sku: 'GONE',
        name: 'Producto fantasma',
        price: 1,
        stock: 9,
        minStock: 0,
        categoryId: fx.categoryId,
      });
      await ctx.db.delete('products', id);
      return id;
    });
    await expect(
      t.mutation(
        api.sales.syncOffline,
        syncArgs(fx, {
          idempotencyKey: 'idem-deleted',
          items: [{ productId: gone, qty: 1 }],
          splits: cash(1.13),
        })
      )
    ).rejects.toMatchObject({ data: { code: 'PRODUCT_DELETED' } });
  });

  test('deleted client → structured CUSTOMER_NOT_FOUND', async () => {
    const { t, fx } = await setup();
    const goneClient = await t.run(async (ctx) => {
      const id = await ctx.db.insert('clients', {
        name: 'Temp',
        taxPrefix: 'V',
        taxId: '1.111.111',
        kind: 'person',
        createdAt: Date.now(),
      });
      await ctx.db.delete('clients', id);
      return id;
    });
    await expect(
      t.mutation(
        api.sales.syncOffline,
        syncArgs(fx, {
          idempotencyKey: 'idem-noclient',
          clientId: goneClient,
          items: [{ productId: fx.cola, qty: 1 }],
          splits: cash(1.7),
        })
      )
    ).rejects.toMatchObject({ data: { code: 'CUSTOMER_NOT_FOUND' } });
  });

  test('inactive employee cannot sync (shares the requireSession gate)', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(
        api.sales.syncOffline,
        syncArgs(fx, {
          token: fx.inactiveToken,
          idempotencyKey: 'idem-inactive',
          items: [{ productId: fx.cola, qty: 1 }],
          splits: cash(1.7),
        })
      )
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });
});
