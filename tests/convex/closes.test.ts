/// <reference types="vite/client" />
// closes — a cashier counts their physical drawer against what the SERVER
// computed as expected for their window, and learns the per-currency
// difference. Blindness, window continuity and immutability are structural:
// see convex/closes.ts's header comment for why each is not merely a check.
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import type { SplitItem } from '@convex/sales';
import * as closesModule from '@convex/closes';
import schema from '@convex/schema';
import { seedBase } from './fixtures';
import type { Fixtures } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const t = convexTest(schema, modules);
  const fx: Fixtures = await t.run(seedBase);
  return { t, fx };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** Insert a sale directly — the only way to control soldAt, splits and a
 *  per-sale frozen exchangeRate/refund.date (mirrors reports.test.ts). */
async function plantSale(
  { t, fx }: Ctx,
  opts: {
    cashierId: Id<'employees'>;
    soldAt: number;
    total: number;
    invoiceNumber: string;
    splits?: SplitItem[];
    exchangeRate?: number;
    refund?: { date: number; reason: string };
  }
): Promise<Id<'sales'>> {
  return await t.run(async (ctx) => {
    const client = (await ctx.db.get('clients', fx.clientId))!;
    return await ctx.db.insert('sales', {
      invoiceNumber: opts.invoiceNumber,
      clientId: fx.clientId,
      client: {
        name: client.name,
        taxPrefix: client.taxPrefix,
        taxId: client.taxId,
      },
      cashierId: opts.cashierId,
      cashierName: 'Cajero de prueba',
      items: [],
      subtotal: opts.total,
      tax: 0,
      total: opts.total,
      method: opts.splits?.[0]?.method ?? 'cash',
      ...(opts.splits !== undefined ? { splits: opts.splits } : {}),
      ivaPct: 13,
      exchangeRate: opts.exchangeRate ?? 36.5,
      soldAt: opts.soldAt,
      ...(opts.refund ? { refund: opts.refund } : {}),
    });
  });
}

async function plantSupplier({ t }: Ctx): Promise<Id<'suppliers'>> {
  return await t.run((ctx) =>
    ctx.db.insert('suppliers', {
      name: 'Proveedor de prueba',
      taxPrefix: 'J',
      taxId: '40123456-7',
      active: true,
      createdAt: Date.now(),
    })
  );
}

/** Insert a purchase directly — closes must never count these, ever. */
async function plantPurchase(
  { t, fx }: Ctx,
  opts: { supplierId: Id<'suppliers'>; createdAt: number; total: number }
) {
  await t.run((ctx) =>
    ctx.db.insert('purchases', {
      supplierId: opts.supplierId,
      supplierName: 'Proveedor de prueba',
      items: [],
      total: opts.total,
      entered: opts.total,
      currency: 'usd',
      exchangeRate: 36.5,
      createdBy: fx.owner,
      createdByName: 'Carlos Méndez',
      createdAt: opts.createdAt,
    })
  );
}

// ---------------------------------------------------------------------------
// 2.1 — splits, never sale.method, are authoritative
// ---------------------------------------------------------------------------
describe('closes.create — expected cash comes from splits, never from method', () => {
  test('a mixed cash+transfer sale (stored method:"cash") counts only its $10 cash split', async () => {
    const c = await setup();
    const openedAt = Date.now() - DAY;
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 1000,
      total: 50,
      invoiceNumber: '1',
      splits: [
        { method: 'cash', amount: 10 },
        { method: 'transfer', amount: 40 },
      ],
    });

    const result = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 10,
      countedBs: 0,
      openedAt,
    });
    expect(result.expectedUsd).toBe(10); // never 50 — method would have said 'cash'
    expect(result.expectedBs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2.2 — expected Bs is Σ entered, never a reconversion at today's rate
// ---------------------------------------------------------------------------
describe('closes.create — expected Bs is the sum of entered, never a reconversion', () => {
  test('two sales frozen at DIFFERENT exchange rates sum by entered, unaffected by a later rate bump', async () => {
    const c = await setup();
    const openedAt = Date.now() - DAY;
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 1000,
      total: 100,
      invoiceNumber: '1',
      splits: [
        { method: 'cash_bs', amount: 100, entered: 3600, currency: 'bs' },
      ],
      exchangeRate: 36,
    });
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 2000,
      // DIFFERENT usd amount from sale 1 on purpose: with both at $100 the
      // sums coincide (100*36 + 100*40 === 100*38 * 2), so reconverting at ANY
      // single rate produced the same 7600 and the test proved nothing.
      total: 200,
      invoiceNumber: '2',
      splits: [
        { method: 'cash_bs', amount: 200, entered: 8000, currency: 'bs' },
      ],
      exchangeRate: 40,
    });
    // The rate on record is bumped BEFORE closing — must not leak into the sum.
    await c.t.run((ctx) =>
      ctx.db.patch('settings', c.fx.settingsId, { bsRate: 999 })
    );

    const result = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 11600,
      openedAt,
    });
    // 3600 + 8000. Reconverting at ANY single rate misses it: at 40 the sum is
    // 12000, at 36 it is 10800, at 999 it is astronomical. Only summing what was
    // actually typed lands on 11600.
    expect(result.expectedBs).toBe(11600);
  });
});

// ---------------------------------------------------------------------------
// 2.3 — non-drawer splits and purchases never contribute
// ---------------------------------------------------------------------------
describe('closes.create — non-drawer splits and purchases never contribute', () => {
  test('a transfer-only sale and an in-window purchase both leave expected at zero', async () => {
    const c = await setup();
    const openedAt = Date.now() - DAY;
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 1000,
      total: 50,
      invoiceNumber: '1',
      splits: [{ method: 'transfer', amount: 50 }],
    });
    const supplierId = await plantSupplier(c);
    await plantPurchase(c, {
      supplierId,
      createdAt: openedAt + 2000,
      total: 30,
    });

    const result = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt,
    });
    expect(result.expectedUsd).toBe(0);
    expect(result.expectedBs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2.4 — a refund reduces the window containing refund.date, not soldAt's
// ---------------------------------------------------------------------------
describe('closes.create — a refund reduces the window containing refund.date', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a card-only sale refunded in a LATER window reduces that window, never the sale one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));
    const c = await setup();

    const w1Opened = Date.now() - DAY;
    const saleId = await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: Date.now() - 1000,
      total: 50,
      invoiceNumber: '1',
      splits: [{ method: 'card', amount: 50 }],
    });

    // W1 closes while the sale carries NO refund yet — trivially unaffected.
    const w1 = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt: w1Opened,
    });
    expect(w1.expectedUsd).toBe(0);

    // The refund happens after W1 closed; W2's window will cover it.
    await c.t.run((ctx) =>
      ctx.db.patch('sales', saleId, {
        refund: { date: Date.now() + 60_000, reason: 'Producto dañado' },
      })
    );
    vi.advanceTimersByTime(2 * 60_000); // now the refund date is in the past

    const w2 = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      // Physical counts are never negative — the shortfall shows up in
      // `expectedUsd`/`differenceUsd`, not in what was actually counted.
      countedUsd: 0,
      countedBs: 0,
    });
    expect(w2.openedAt).toBe(w1.closedAt); // continuity, unaffected by the fake clock
    expect(w2.expectedUsd).toBe(-50);
  });

  test('a mixed refund (cash_bs + card) reduces both currencies by their own frozen figure', async () => {
    const c = await setup();
    const openedAt = Date.now() - DAY;
    const soldAt = openedAt - 5 * DAY; // sold well before this window opened
    const refundDate = openedAt + 1000; // refunded inside this window

    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt,
      total: 100,
      invoiceNumber: '1',
      splits: [
        { method: 'cash_bs', amount: 27.4, entered: 1000, currency: 'bs' },
        { method: 'card', amount: 20 },
      ],
      refund: { date: refundDate, reason: 'Reembolso mixto' },
    });

    const result = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      // Physical counts are never negative — the shortfall shows up in
      // `expectedUsd`/`expectedBs`, not in what was actually counted.
      countedUsd: 0,
      countedBs: 0,
      openedAt,
    });
    expect(result.expectedBs).toBe(-1000);
    expect(result.expectedUsd).toBe(-20);
  });
});

// ---------------------------------------------------------------------------
// 2.5 — the count is blind: nothing exposes an open window's expected first
// ---------------------------------------------------------------------------
describe('closes — the count is blind', () => {
  test('closes.list returns nothing for a still-open window, even with sales already in it', async () => {
    const c = await setup();
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: Date.now() - 1000,
      total: 30,
      invoiceNumber: '1',
      splits: [{ method: 'cash', amount: 30 }],
    });

    const before = await c.t.query(api.closes.list, {
      token: c.fx.ownerToken,
      scope: 'own',
    });
    expect(before.closes).toEqual([]); // recorded closes only — never an open window
  });
});

// ---------------------------------------------------------------------------
// 2.6 — window continuity + the window is unnameable, not merely rejected
// ---------------------------------------------------------------------------
describe('closes.create — a second close continues exactly where the first left off', () => {
  test('the second row opens at the firsts close; naming a start once a close exists is refused', async () => {
    const c = await setup();
    const first = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt: Date.now() - DAY,
    });

    const second = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
    });
    expect(second.openedAt).toBe(first.closedAt);

    await expect(
      c.t.mutation(api.closes.create, {
        token: c.fx.ownerToken,
        countedUsd: 0,
        countedBs: 0,
        openedAt: Date.now() - DAY,
      })
    ).rejects.toThrow(
      'El cierre continúa desde tu cierre anterior; no puedes elegir la fecha de inicio.'
    );
  });
});

// ---------------------------------------------------------------------------
// 2.7 — a first close needs an explicit start
// ---------------------------------------------------------------------------
describe('closes.create — a first close requires an explicit openedAt', () => {
  test('refuses when no previous close exists and openedAt is missing', async () => {
    const c = await setup();
    await expect(
      c.t.mutation(api.closes.create, {
        token: c.fx.ownerToken,
        countedUsd: 0,
        countedBs: 0,
      })
    ).rejects.toThrow('Indica desde cuándo cuenta este primer cierre.');
  });
});

// ---------------------------------------------------------------------------
// 2.8 — two cashiers' windows never mix
// ---------------------------------------------------------------------------
describe('closes.create — windows never mix between cashiers', () => {
  test('closing as cashier A reflects only cashier As sales, even when B sold in the same window', async () => {
    const c = await setup();
    const openedAt = Date.now() - DAY;
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 1000,
      total: 20,
      invoiceNumber: '1',
      splits: [{ method: 'cash', amount: 20 }],
    });
    await plantSale(c, {
      cashierId: c.fx.cajeroVoid,
      soldAt: openedAt + 2000,
      total: 35,
      invoiceNumber: '2',
      splits: [{ method: 'cash', amount: 35 }],
    });

    const result = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 20,
      countedBs: 0,
      openedAt,
    });
    expect(result.expectedUsd).toBe(20); // never 55
  });
});

// ---------------------------------------------------------------------------
// 2.9 — immutability: nothing to update or delete
// ---------------------------------------------------------------------------
describe('closes — immutability', () => {
  // NOTE: `api.closes` (from `_generated/api`) is Convex's `anyApi` — a bare
  // `Proxy({}, { get })` with no `ownKeys` trap, so `Object.keys(api.closes)`
  // is ALWAYS `[]` by construction, regardless of what the module exports
  // (verified against `convex/server`'s `createApi`). The real module's own
  // exports are what actually proves immutability.
  test('the module exposes exactly create and list — no edit, no delete', () => {
    expect(Object.keys(closesModule).sort()).toEqual(['create', 'list']);
  });
});

// ---------------------------------------------------------------------------
// 2.10 — session-only own close; view_reports required to read another's
// ---------------------------------------------------------------------------
describe('closes — permission model (close own without view_reports, read another needs it)', () => {
  test('cajeroPlain (no view_reports) closes their own drawer but cannot list scope:"all"', async () => {
    const c = await setup();
    // cajeroPlain fixture holds manage_clients only — no view_reports.
    const created = await c.t.mutation(api.closes.create, {
      token: c.fx.cajeroPlainToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt: Date.now() - DAY,
    });
    expect(created.cashierName).toBe('Ana Torres');

    await expect(
      c.t.query(api.closes.list, {
        token: c.fx.cajeroPlainToken,
        scope: 'all',
      })
    ).rejects.toThrow('Sin permisos para esta acción.');

    const ownDefault = await c.t.query(api.closes.list, {
      token: c.fx.cajeroPlainToken,
    });
    expect(ownDefault.closes.length).toBe(1);

    const asOwnerAll = await c.t.query(api.closes.list, {
      token: c.fx.ownerToken,
      scope: 'all',
    });
    expect(asOwnerAll.closes.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2.11 — USD and Bs are counted and compared independently
// ---------------------------------------------------------------------------
describe('closes.create — USD and Bs are compared independently', () => {
  test('a shortfall in one currency does not touch the other', async () => {
    const c = await setup();
    const openedAt = Date.now() - DAY;
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 1000,
      total: 100,
      invoiceNumber: '1',
      splits: [{ method: 'cash', amount: 100 }],
    });
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 2000,
      total: 5000,
      invoiceNumber: '2',
      splits: [
        { method: 'cash_bs', amount: 5000, entered: 5000, currency: 'bs' },
      ],
    });

    const result = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 95,
      countedBs: 5000,
      openedAt,
    });
    expect(result.differenceUsd).toBe(-5);
    expect(result.differenceBs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2.12 — over the read cap REFUSES, never under-reports
// ---------------------------------------------------------------------------
describe('closes.create — refuses over the read cap rather than under-reporting', () => {
  test('more than CLOSE_MAX_SALES (1000) sold rows in the window refuses the close', async () => {
    const c = await setup();
    const openedAt = Date.now() - DAY;
    const snapshot = await c.t.run(async (ctx) => {
      const client = (await ctx.db.get('clients', c.fx.clientId))!;
      return {
        name: client.name,
        taxPrefix: client.taxPrefix,
        taxId: client.taxId,
      };
    });

    await c.t.run(async (ctx) => {
      for (let i = 0; i < 1001; i++) {
        await ctx.db.insert('sales', {
          invoiceNumber: `CAP-${i}`,
          clientId: c.fx.clientId,
          client: snapshot,
          cashierId: c.fx.owner,
          cashierName: 'Cajero de prueba',
          items: [],
          subtotal: 1,
          tax: 0,
          total: 1,
          method: 'cash',
          splits: [{ method: 'cash', amount: 1 }],
          ivaPct: 13,
          exchangeRate: 36.5,
          soldAt: openedAt + 1 + i,
        });
      }
    });

    await expect(
      c.t.mutation(api.closes.create, {
        token: c.fx.ownerToken,
        countedUsd: 0,
        countedBs: 0,
        openedAt,
      })
    ).rejects.toThrow(
      'Tienes más de 1000 ventas sin cerrar. Confirma un cierre parcial para cerrar solo las más recientes.'
    );

    // THE POINT OF THE GUARD: it delays a close, it does not forbid one.
    // Asserting only the rejection is what let the original dead end ship —
    // once a previous close exists the window start is underivable from
    // anything the caller can send, so a refusal with no exit would leave the
    // drawer permanently unclosable. This is the exit, and it must work.
    const partial = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt,
      confirmPartial: true,
    });
    // 1001 planted at $1 each, cap 1000 — the OLDEST is the one left out, so
    // the row admits a counted start later than the window it opened at.
    expect(partial.countedFrom).toBeDefined();
    expect(partial.countedFrom as number).toBeGreaterThan(partial.openedAt);
    expect(partial.expectedUsd).toBe(1000);
    expect(partial.closedAt).toBeGreaterThan(partial.countedFrom as number);
  }, 30_000);

  test('a partial close still leaves the NEXT close continuing from the true end', async () => {
    // The shortfall a partial close leaves behind must not compound:
    // `closedAt` is the real window end regardless of how little was counted,
    // so the following close starts there and no future sale is ever skipped.
    const c = await setup();
    const openedAt = Date.now() - DAY;
    const snapshot = await c.t.run(async (ctx) => {
      const client = (await ctx.db.get('clients', c.fx.clientId))!;
      return {
        name: client.name,
        taxPrefix: client.taxPrefix,
        taxId: client.taxId,
      };
    });
    await c.t.run(async (ctx) => {
      for (let i = 0; i < 1001; i++) {
        await ctx.db.insert('sales', {
          invoiceNumber: `PART-${i}`,
          clientId: c.fx.clientId,
          client: snapshot,
          cashierId: c.fx.owner,
          cashierName: 'Cajero de prueba',
          items: [],
          subtotal: 1,
          tax: 0,
          total: 1,
          method: 'cash',
          splits: [{ method: 'cash', amount: 1 }],
          ivaPct: 13,
          exchangeRate: 36.5,
          soldAt: openedAt + 1 + i,
        });
      }
    });

    const partial = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt,
      confirmPartial: true,
    });
    const next = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
    });
    expect(next.openedAt).toBe(partial.closedAt);
    expect(next.countedFrom).toBeUndefined(); // an ordinary window again
    expect(next.expectedUsd).toBe(0); // nothing sold since — never re-counted
  }, 30_000);

  test('a colleagues volume never consumes THIS cashiers cap', async () => {
    // The original ranged over `by_soldAt` shop-wide and filtered by cashier
    // in memory AFTERWARDS, so with three people on the register a third of
    // the cap locked each of them out. Here the OTHER cashier alone blows past
    // the cap while this cashier has one sale; the close must simply succeed.
    const c = await setup();
    const openedAt = Date.now() - DAY;
    const snapshot = await c.t.run(async (ctx) => {
      const client = (await ctx.db.get('clients', c.fx.clientId))!;
      return {
        name: client.name,
        taxPrefix: client.taxPrefix,
        taxId: client.taxId,
      };
    });
    const other = await c.t.run((ctx) =>
      ctx.db.insert('employees', {
        name: 'Otra cajera',
        email: 'otra@mitienda.com',
        phone: '0000',
        role: 'cajero',
        permissions: 'all',
        pinHash: 'x',
        pinSalt: 'y',
        active: true,
        createdAt: 0,
      })
    );
    await c.t.run(async (ctx) => {
      for (let i = 0; i < 1200; i++) {
        await ctx.db.insert('sales', {
          invoiceNumber: `OTHER-${i}`,
          clientId: c.fx.clientId,
          client: snapshot,
          cashierId: other,
          cashierName: 'Otra cajera',
          items: [],
          subtotal: 1,
          tax: 0,
          total: 1,
          method: 'cash',
          splits: [{ method: 'cash', amount: 1 }],
          ivaPct: 13,
          exchangeRate: 36.5,
          soldAt: openedAt + 1 + i,
        });
      }
    });
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 5000,
      total: 40,
      invoiceNumber: 'MINE-1',
      splits: [{ method: 'cash', amount: 40 }],
    });

    const close = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 40,
      countedBs: 0,
      openedAt,
    });
    expect(close.expectedUsd).toBe(40); // only mine, and no refusal at all
    expect(close.countedFrom).toBeUndefined(); // never went partial
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 2.12b — the REFUND pass has its own cap, and its own proof
// ---------------------------------------------------------------------------
// The sold-pass test above leaves this branch unproven: deleting the refund
// operand from the guard kept all 13 tests green. Two capped reads need two
// probes AND two tests — a forgotten one signs a permanent financial record
// over a truncated set, which is the one thing this whole mutation refuses to
// do. Every sale here is sold OUTSIDE the window and refunded INSIDE it, so
// only the refund probe can overflow.
describe('closes.create — the refund pass is capped on its own terms', () => {
  test('more than CLOSE_MAX_SALES rows refunded in the window refuses the close', async () => {
    const c = await setup();
    const openedAt = Date.now() - 60_000;

    const snapshot = await c.t.run(async (ctx) => {
      const client = (await ctx.db.get('clients', c.fx.clientId))!;
      return {
        name: client.name,
        taxPrefix: client.taxPrefix,
        taxId: client.taxId,
      };
    });

    await c.t.run(async (ctx) => {
      for (let i = 0; i < 1001; i++) {
        await ctx.db.insert('sales', {
          invoiceNumber: `RCAP-${i}`,
          clientId: c.fx.clientId,
          client: snapshot,
          cashierId: c.fx.owner,
          cashierName: 'Cajero de prueba',
          items: [],
          subtotal: 1,
          tax: 0,
          total: 1,
          method: 'cash',
          splits: [{ method: 'cash', amount: 1 }],
          ivaPct: 13,
          exchangeRate: 36.5,
          // Sold WELL BEFORE the window opened, so the sold probe reads zero.
          soldAt: openedAt - 90 * 24 * 60 * 60 * 1000 - i,
          refund: { date: openedAt + 1 + i, reason: 'producto dañado' },
        });
      }
    });

    await expect(
      c.t.mutation(api.closes.create, {
        token: c.fx.ownerToken,
        countedUsd: 0,
        countedBs: 0,
        openedAt,
      })
    ).rejects.toThrow(
      'Tienes más de 1000 ventas sin cerrar. Confirma un cierre parcial para cerrar solo las más recientes.'
    );

    // THE WITNESS THIS TEST WAS MISSING. Stopping at the refusal above left the
    // exit itself unproven on the refund half, and the exit was broken there:
    // nothing was SOLD in this window, so a counted start derived from the sold
    // side alone read an empty array and threw. With `confirmPartial` the only
    // way out of the refusal, that crash was the permanently unclosable drawer
    // the partial close exists to prevent — the same dead end, on the other
    // probe. Every row here is refunded at $1, and the cap keeps the 1000 most
    // recent of the 1001.
    const partial = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt,
      confirmPartial: true,
    });
    expect(partial.expectedUsd).toBe(-1000); // refunds leave the drawer
    expect(partial.countedFrom).toBeDefined();
    expect(partial.countedFrom as number).toBeGreaterThan(partial.openedAt);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 2.13 — continuity across THREE closes, and cash that must not be counted twice
// ---------------------------------------------------------------------------
// The suite's original continuity proof compared the second close's start
// against the first close's end while exactly ONE row existed. At one row a
// descending and an ascending read return the same document, so deleting
// `.order('desc')` from the previous-close lookup kept every test green while
// making each close from the THIRD onward restart at the cashier's first one —
// re-counting all history into an immutable row. These two tests are the
// witnesses that were missing.
describe('closes.create — continuity holds past the point one row can prove', () => {
  test('a THIRD close continues from the SECOND, not from the first', async () => {
    const c = await setup();
    const first = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt: Date.now() - DAY,
    });
    const second = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
    });
    const third = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
    });

    expect(third.openedAt).toBe(second.closedAt);
    // The assertion that actually kills the regression: with an ascending
    // lookup the third close would open at the FIRST close's end instead.
    expect(third.openedAt).not.toBe(first.closedAt);
  });

  test('cash in the first window is NEVER counted again by the second', async () => {
    // The only pre-existing two-close test that planted a sale used a
    // card-only split, worth zero in the sold pass of BOTH windows — so the
    // half-open `soldAt` exclusion, the single expression preventing each
    // close from re-counting the previous window's cash, had no witness.
    const c = await setup();
    const openedAt = Date.now() - DAY;

    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 1000,
      total: 70,
      invoiceNumber: 'W1',
      splits: [{ method: 'cash', amount: 70 }],
    });

    const first = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 70,
      countedBs: 0,
      openedAt,
    });
    expect(first.expectedUsd).toBe(70);

    // Sold strictly AFTER the first close's end — the second window's own money.
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: first.closedAt + 1,
      total: 25,
      invoiceNumber: 'W2',
      splits: [{ method: 'cash', amount: 25 }],
    });

    const second = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 25,
      countedBs: 0,
    });
    // 25, never 95: the first window's $70 belongs to a close already signed.
    expect(second.expectedUsd).toBe(25);
    expect(second.differenceUsd).toBe(0);
  });

  test('a sale at exactly the previous closedAt belongs to THAT close', async () => {
    // The bound is half-open, (from, to]: `gt` on the start and `lte` on the
    // end. A sale landing on the boundary instant must fall in the earlier
    // window, or the same dollar is signed for twice.
    const c = await setup();
    const openedAt = Date.now() - DAY;

    const first = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt,
    });
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: first.closedAt, // exactly ON the boundary
      total: 12,
      invoiceNumber: 'EDGE',
      splits: [{ method: 'cash', amount: 12 }],
    });

    const second = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
    });
    expect(second.expectedUsd).toBe(0); // excluded — it was the first's
  });
});

// ---------------------------------------------------------------------------
// 2.14 — the input guards, and the list contract past one row
// ---------------------------------------------------------------------------
describe('closes.create — refuses input that would sign a nonsense record', () => {
  test('a negative or non-finite counted amount is refused, not stored', async () => {
    const c = await setup();
    for (const bad of [
      { countedUsd: -1, countedBs: 0 },
      { countedUsd: 0, countedBs: Number.NaN },
      { countedUsd: Number.POSITIVE_INFINITY, countedBs: 0 },
    ]) {
      await expect(
        c.t.mutation(api.closes.create, {
          token: c.fx.ownerToken,
          ...bad,
          openedAt: Date.now() - DAY,
        })
      ).rejects.toThrow('Los montos contados no son válidos.');
    }
    const rows = await c.t.run((ctx) => ctx.db.query('closes').collect());
    expect(rows).toHaveLength(0);
  });

  test('a first close cannot open in the FUTURE', async () => {
    // Without this guard the start lands after the end, both probes return
    // empty, and the row is written with a zero expectation and a surplus
    // equal to the entire count.
    const c = await setup();
    await expect(
      c.t.mutation(api.closes.create, {
        token: c.fx.ownerToken,
        countedUsd: 0,
        countedBs: 0,
        openedAt: Date.now() + DAY,
      })
    ).rejects.toThrow('La fecha de apertura no es válida.');
  });

  test('a cash_bs split with no frozen entered figure contributes zero', async () => {
    // Deliberate, not an oversight: there is no honest way to recover the
    // bolívares such a split took, and reconverting `amount` at any rate would
    // invent the discrepancy this module exists to avoid.
    const c = await setup();
    const openedAt = Date.now() - DAY;
    await plantSale(c, {
      cashierId: c.fx.owner,
      soldAt: openedAt + 1000,
      total: 50,
      invoiceNumber: 'NOENT',
      splits: [{ method: 'cash_bs', amount: 50, currency: 'bs' }],
    });
    const close = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt,
    });
    expect(close.expectedBs).toBe(0);
    expect(close.expectedUsd).toBe(0); // and it never leaks into the USD side
  });
});

describe('closes.list — the cap, the order and the truncated flag', () => {
  test('returns newest first, clamped to the limit, and says it truncated', async () => {
    // Every pre-existing list test ran against zero or one rows, where both
    // descending orders, the clamp and the flag are indistinguishable from
    // constants. Dropping either order would return the OLDEST closes and hide
    // every recent one behind a true flag, with the suite fully green.
    const c = await setup();
    const first = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt: Date.now() - DAY,
    });
    const second = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
    });
    const third = await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
    });

    const own = await c.t.query(api.closes.list, {
      token: c.fx.ownerToken,
      scope: 'own',
      limit: 2,
    });
    expect(own.closes).toHaveLength(2);
    expect(own.truncated).toBe(true);
    expect(own.closes.map((r) => r.closedAt)).toEqual([
      third.closedAt,
      second.closedAt,
    ]);

    const all = await c.t.query(api.closes.list, {
      token: c.fx.ownerToken,
      scope: 'all',
      limit: 2,
    });
    expect(all.closes.map((r) => r.closedAt)).toEqual([
      third.closedAt,
      second.closedAt,
    ]);
    expect(all.truncated).toBe(true);

    const everything = await c.t.query(api.closes.list, {
      token: c.fx.ownerToken,
      scope: 'own',
    });
    expect(everything.closes).toHaveLength(3);
    expect(everything.truncated).toBe(false);
    expect(everything.closes[2].closedAt).toBe(first.closedAt);
  });

  test('a non-finite limit refuses instead of reporting an empty history', async () => {
    // Flooring NaN yields NaN, every clamp propagates it, and slicing to NaN
    // returns an EMPTY array with truncated:false — a financial history
    // answering "you have no closes" instead of erroring.
    const c = await setup();
    await c.t.mutation(api.closes.create, {
      token: c.fx.ownerToken,
      countedUsd: 0,
      countedBs: 0,
      openedAt: Date.now() - DAY,
    });
    await expect(
      c.t.query(api.closes.list, {
        token: c.fx.ownerToken,
        limit: Number.NaN,
      })
    ).rejects.toThrow('El límite no es válido.');
  });
});
