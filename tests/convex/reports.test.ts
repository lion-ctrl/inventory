/// <reference types="vite/client" />
// reports.cashFlow — server-side aggregation of income (sales) and expenses
// (refunds + purchases) over a caller-supplied window. Cash flow, NOT profit:
// there is no cost-of-goods-sold in the schema.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import schema from '@convex/schema';
import { seedBase } from './fixtures';
import type { Fixtures } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const t = convexTest(schema, modules);
  const fx: Fixtures = await t.run(seedBase);
  const supplierId = (
    await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: 'Distribuidora El Sol, C.A.',
      taxPrefix: 'J',
      taxId: '40123456-7',
    })
  )._id;
  return { t, fx, supplierId };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** Insert a sale straight at `soldAt` (optionally already refunded). */
async function plantSale(
  { t, fx }: Ctx,
  soldAt: number,
  total: number,
  invoiceNumber: string,
  refund?: { date: number; reason: string }
): Promise<Id<'sales'>> {
  return await t.run(async (ctx) => {
    const client = (await ctx.db.get('clients', fx.clientId))!;
    return await ctx.db.insert('sales', {
      invoiceNumber,
      clientId: fx.clientId,
      client: {
        name: client.name,
        taxPrefix: client.taxPrefix,
        taxId: client.taxId,
      },
      cashierId: fx.owner,
      cashierName: 'Carlos Méndez',
      items: [],
      subtotal: total,
      tax: 0,
      total,
      method: 'cash',
      ivaPct: 13,
      exchangeRate: 36.5,
      soldAt,
      ...(refund ? { refund } : {}),
    });
  });
}

/** Insert a purchase straight at `createdAt`. */
async function plantPurchase(
  { t, fx, supplierId }: Ctx,
  createdAt: number,
  total: number
) {
  await t.run((ctx) =>
    ctx.db.insert('purchases', {
      supplierId,
      supplierName: 'Distribuidora El Sol, C.A.',
      items: [],
      total,
      entered: total,
      currency: 'usd',
      exchangeRate: 36.5,
      createdBy: fx.owner,
      createdByName: 'Carlos Méndez',
      createdAt,
    })
  );
}

describe('reports.cashFlow — permissions', () => {
  test('denies an employee without view_reports, server-side', async () => {
    const c = await setup();
    await expect(
      cashFlowQuery(c, {
        token: c.fx.cajeroPlainToken,
        from: 0,
        to: Date.now(),
      })
    ).rejects.toThrow('Sin permisos para esta acción.');
  });

  test('grants owner and cajeroVoid, which both hold view_reports', async () => {
    const c = await setup();
    const from = Date.now() - DAY;
    const to = Date.now() + DAY;
    await expect(
      cashFlowQuery(c, { token: c.fx.ownerToken, from, to })
    ).resolves.toMatchObject({ income: 0, expenses: 0, net: 0 });
    await expect(
      cashFlowQuery(c, { token: c.fx.cajeroVoidToken, from, to })
    ).resolves.toMatchObject({ income: 0, expenses: 0, net: 0 });
  });
});

describe('reports.cashFlow — aggregation', () => {
  test('happy path: sums income/expenses/net; window is inclusive on both ends', async () => {
    const c = await setup();
    const from = Date.now();
    const to = from + 2 * DAY;

    await plantSale(c, from, 200, '1'); // exactly at `from`
    await plantSale(c, to, 300, '2'); // exactly at `to`
    await plantSale(c, to + 1, 999, '3'); // just outside
    await plantPurchase(c, from, 300);

    // Exact shape: proves only the six aggregate fields come back, ever.
    await expect(
      cashFlowQuery(c, { token: c.fx.ownerToken, from, to })
    ).resolves.toEqual({
      income: 500,
      expenses: 300,
      net: 200,
      salesCount: 2,
      purchasesCount: 1,
      truncated: false,
    });
  });

  test('an empty window returns all zeros without throwing', async () => {
    const c = await setup();
    const from = Date.now() + 100 * DAY;
    await expect(
      cashFlowQuery(c, { token: c.fx.ownerToken, from, to: from + DAY })
    ).resolves.toEqual({
      income: 0,
      expenses: 0,
      net: 0,
      salesCount: 0,
      purchasesCount: 0,
      truncated: false,
    });
  });

  test('rejects an invalid window where to < from, with a Spanish message', async () => {
    const c = await setup();
    const now = Date.now();
    await expect(
      cashFlowQuery(c, { token: c.fx.ownerToken, from: now, to: now - 1 })
    ).rejects.toThrow('El período seleccionado no es válido.');
  });
});

describe('reports.cashFlow — refund attribution', () => {
  test('a refund of an OLD sale expenses the refund window, never the sale period', async () => {
    const c = await setup();
    const saleTime = Date.now() - 90 * DAY; // well outside any plausible lookback
    const saleFrom = saleTime - DAY;
    const saleTo = saleTime + DAY;
    const saleId = await plantSale(c, saleTime, 80, '1');

    await expect(
      cashFlowQuery(c, { token: c.fx.ownerToken, from: saleFrom, to: saleTo })
    ).resolves.toMatchObject({ income: 80, salesCount: 1 });

    // `sales.refund` stamps Date.now(); patch directly to aim a past refund.
    const refundFrom = Date.now();
    const refundTo = refundFrom + DAY;
    await c.t.run((ctx) =>
      ctx.db.patch('sales', saleId, {
        refund: { date: refundFrom + 1000, reason: 'Producto dañado' },
      })
    );

    // Byte-identical to before the refund — the past is never rewritten.
    await expect(
      cashFlowQuery(c, { token: c.fx.ownerToken, from: saleFrom, to: saleTo })
    ).resolves.toMatchObject({ income: 80, salesCount: 1 });
    await expect(
      cashFlowQuery(c, {
        token: c.fx.ownerToken,
        from: refundFrom,
        to: refundTo,
      })
    ).resolves.toMatchObject({ income: 0, expenses: 80, salesCount: 0 });
  });

  test('a sale refunded inside its own window counts as both income and expense, netting zero', async () => {
    const c = await setup();
    const from = Date.now();
    await plantSale(c, from + 1000, 60, '1', {
      date: from + 2000,
      reason: 'Reembolso mismo período',
    });
    await expect(
      cashFlowQuery(c, { token: c.fx.ownerToken, from, to: from + DAY })
    ).resolves.toMatchObject({ income: 60, expenses: 60, net: 0 });
  });
});

describe('reports.cashFlow — truncation (one flag, three independent probes)', () => {
  test('caps the sold(income) side and still returns real figures alongside truncated', async () => {
    const c = await setup();
    const from = Date.now();
    await plantSale(c, from + 1, 10, '1');
    await plantSale(c, from + 2, 20, '2');

    const result = await cashFlowQuery(c, {
      token: c.fx.ownerToken,
      from,
      to: from + DAY,
      limit: 1,
    });
    expect(result.truncated).toBe(true);
    // A capped sum is a real lower bound, never nulled or zeroed.
    expect(result.income).toBeGreaterThan(0);
  });

  test('caps the refund side independently — a forgotten third probe would report low', async () => {
    const c = await setup();
    const from = Date.now();
    const to = from + DAY;
    const oldSoldAt = from - 90 * DAY;

    // Two OLD sales, refunded inside the window: only the refund-date probe
    // sees them — the sold-side probe must stay at 1 (the third sale below).
    await plantSale(c, oldSoldAt, 10, '1', { date: from + 1, reason: 'R1' });
    await plantSale(c, oldSoldAt, 20, '2', { date: from + 2, reason: 'R2' });
    await plantSale(c, from + 3, 30, '3');
    await plantPurchase(c, from + 1, 40);

    const result = await cashFlowQuery(c, {
      token: c.fx.ownerToken,
      from,
      to,
      limit: 1,
    });
    expect(result.truncated).toBe(true);
    expect(result.salesCount).toBe(1); // sold-side probe was NOT the one over cap
    expect(result.purchasesCount).toBe(1); // purchase-side probe was NOT over cap
  });

  test('caps the purchase side independently and ORs into the same truncated flag', async () => {
    const c = await setup();
    const from = Date.now();
    await plantPurchase(c, from + 1, 10);
    await plantPurchase(c, from + 2, 20);
    await plantSale(c, from + 3, 30, '1');

    const result = await cashFlowQuery(c, {
      token: c.fx.ownerToken,
      from,
      to: from + DAY,
      limit: 1,
    });
    expect(result.truncated).toBe(true);
    expect(result.salesCount).toBe(1); // sold-side probe was NOT the one over cap
  });
});

/** Shorthand for the query under test, bound to a `setup()` context. */
function cashFlowQuery(
  c: Ctx,
  args: { token: string; from: number; to: number; limit?: number }
) {
  return c.t.query(api.reports.cashFlow, args);
}
