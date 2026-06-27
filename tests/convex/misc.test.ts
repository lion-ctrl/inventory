/// <reference types="vite/client" />
// Remaining backend surface: employees guards, history ordering, seed idempotency.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api, internal } from '@convex/_generated/api';
import schema from '@convex/schema';
import { seedBase } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

describe('employees.update / remove', () => {
  test('update requires manage_employees and patches role/permissions', async () => {
    const t = convexTest(schema, modules);
    const fx = await t.run(seedBase);

    await expect(
      t.mutation(api.employees.update, {
        token: fx.cajeroPlainToken,
        employeeId: fx.cajeroVoid,
        patch: { role: 'admin' },
      })
    ).rejects.toThrow('Sin permisos para esta acción.');

    await t.mutation(api.employees.update, {
      token: fx.ownerToken,
      employeeId: fx.cajeroVoid,
      patch: { role: 'admin', active: false },
    });
    const emp = await t.run((ctx) => ctx.db.get('employees', fx.cajeroVoid));
    expect(emp!.role).toBe('admin');
    expect(emp!.active).toBe(false);
  });

  test('remove deletes and is idempotent', async () => {
    const t = convexTest(schema, modules);
    const fx = await t.run(seedBase);
    await t.mutation(api.employees.remove, {
      token: fx.ownerToken,
      employeeId: fx.cajeroPlain,
    });
    await expect(
      t.run((ctx) => ctx.db.get('employees', fx.cajeroPlain))
    ).resolves.toBeNull();
    await t.mutation(api.employees.remove, {
      token: fx.ownerToken,
      employeeId: fx.cajeroPlain,
    });
  });
});

describe('sales.history', () => {
  test('returns sales newest-first', async () => {
    const t = convexTest(schema, modules);
    const fx = await t.run(seedBase);
    const buy = (qty: number, amount: number) =>
      t.mutation(api.sales.checkout, {
        token: fx.ownerToken,
        clientId: fx.clientId,
        items: [{ productId: fx.cola, qty }],
        method: 'cash',
        splits: [{ method: 'cash', amount }],
      });
    // IVA always applies now: cola 1.50 → qty1 total 1.70 (IVA 0.20),
    // qty2 total 3.39 (IVA 0.39). Splits must cover the IVA'd total.
    await buy(1, 1.7);
    await buy(2, 3.39);

    const history = await t.query(api.sales.history, { token: fx.ownerToken });
    expect(history.map((s) => s.invoiceNumber)).toEqual([
      '00000044',
      '00000043',
    ]);
  });

  test('AUTH-2: requires a session and never returns cashierId', async () => {
    const t = convexTest(schema, modules);
    const fx = await t.run(seedBase);
    await t.mutation(api.sales.checkout, {
      token: fx.ownerToken,
      clientId: fx.clientId,
      items: [{ productId: fx.cola, qty: 1 }],
      method: 'cash',
      splits: [{ method: 'cash', amount: 1.7 }],
    });

    // Unauthenticated reads are rejected.
    await expect(
      t.query(api.sales.history, { token: 'not-a-real-token' })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');

    const history = await t.query(api.sales.history, { token: fx.ownerToken });
    expect(history.length).toBeGreaterThan(0);
    for (const sale of history) {
      expect(sale.cashierName).toBeTruthy(); // human-readable snapshot stays
      expect(sale).not.toHaveProperty('cashierId'); // credential surface removed
    }

    // The id is still STORED on the row for audit — only the projection drops it.
    const stored = await t.run(async (ctx) => {
      const rows = await ctx.db.query('sales').collect();
      return rows[0];
    });
    expect(stored.cashierId).toBe(fx.owner);
  });
});

describe('seed.run', () => {
  test('seeds the full demo dataset once and refuses to run twice', async () => {
    // Fresh deployment — no fixtures, the seed provides everything.
    const t = convexTest(schema, modules);

    await t.mutation(internal.seed.run, {});
    const counts = await t.query(internal.seed.counts, {});
    expect(counts).toMatchObject({
      categories: 6,
      products: 20,
      clients: 10,
      employees: 10,
      sales: 36,
      settings: 1,
    });

    const second = await t.mutation(internal.seed.run, {});
    expect(String(second)).toContain('already seeded');
  });

  test('clearAll wipes every table so the seed can run fresh', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.run, {});

    await t.mutation(internal.seed.clearAll, {});
    const counts = await t.query(internal.seed.counts, {});
    expect(counts).toMatchObject({
      categories: 0,
      products: 0,
      clients: 0,
      employees: 0,
      sales: 0,
      settings: 0,
      heldCarts: 0,
    });

    // After a wipe, the idempotency guard no longer blocks a fresh seed.
    const again = await t.mutation(internal.seed.run, {});
    expect(String(again)).not.toContain('already seeded');
  });
});
