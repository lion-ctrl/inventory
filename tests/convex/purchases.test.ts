/// <reference types="vite/client" />
// Purchases — a supplier order. Lines say WHAT came in (product + qty) and the
// money lives once, as the purchase's global total. Registering one RAISES stock;
// deleting one puts it back. The total is always stored in USD, alongside the raw
// amount the user typed, its currency and the Bs rate frozen at that moment.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import schema from '@convex/schema';
import { seedBase } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
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

const stockOf = async (
  t: Awaited<ReturnType<typeof setup>>['t'],
  productId: string
) => (await t.run((ctx) => ctx.db.get('products', productId as never)))!.stock;

describe('purchases.create', () => {
  test('raises stock, snapshots the names and converts a Bs total at the frozen rate', async () => {
    const { t, fx, supplierId } = await setup();

    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId,
      items: [
        { productId: fx.cola, qty: 50 },
        { productId: fx.agua, qty: 20 },
      ],
      // Seeded bsRate is 36.5 → 365 Bs is exactly 10 USD.
      entered: 365,
      currency: 'bs',
      note: 'Pedido semanal',
    });

    const [purchase] = await t.query(api.purchases.bySupplier, {
      token: fx.ownerToken,
      supplierId,
    });
    expect(purchase.total).toBe(10); // USD is the canonical figure
    expect(purchase.entered).toBe(365); // …and what was typed survives
    expect(purchase.currency).toBe('bs');
    expect(purchase.exchangeRate).toBe(36.5); // frozen, not read live later
    expect(purchase.supplierName).toBe('Distribuidora El Sol, C.A.');
    expect(purchase.items.map((i) => i.name)).toEqual([
      'Coca-Cola 600ml',
      'Agua mineral 1L',
    ]);
    expect(purchase.createdByName).toBe('Carlos Méndez');
    expect(purchase.note).toBe('Pedido semanal');

    // The whole point: inventory went up.
    expect(await stockOf(t, fx.cola)).toBe(74); // 24 + 50
    expect(await stockOf(t, fx.agua)).toBe(76); // 56 + 20
  });

  test('merges a repeated product instead of losing the stock of the first line', async () => {
    const { t, fx, supplierId } = await setup();

    // Both lines read the SAME pre-patch stock, so patching them one after the
    // other made the second overwrite the first: 24+5=29, then 24+3=27 — five
    // units gone with no trace. sales.ts already merges duplicates defensively.
    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId,
      items: [
        { productId: fx.cola, qty: 5 },
        { productId: fx.cola, qty: 3 },
      ],
      entered: 10,
      currency: 'usd',
    });

    expect(await stockOf(t, fx.cola)).toBe(32); // 24 + 8, not 27

    const [purchase] = await t.query(api.purchases.bySupplier, {
      token: fx.ownerToken,
      supplierId,
    });
    expect(purchase.items).toHaveLength(1);
    expect(purchase.items[0].qty).toBe(8);

    // …and the reversal is symmetric.
    await t.mutation(api.purchases.remove, {
      token: fx.ownerToken,
      purchaseId: purchase._id,
    });
    expect(await stockOf(t, fx.cola)).toBe(24);
  });

  test('never returns the employee id, only the frozen name (AUTH-2)', async () => {
    const { t, fx, supplierId } = await setup();
    const created = await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId,
      items: [{ productId: fx.cola, qty: 1 }],
      entered: 10,
      currency: 'usd',
    });

    expect(created).not.toHaveProperty('createdBy');
    expect(created.createdByName).toBe('Carlos Méndez');
    const [listed] = await t.query(api.purchases.bySupplier, {
      token: fx.ownerToken,
      supplierId,
    });
    expect(listed).not.toHaveProperty('createdBy');

    // The id stays STORED for audit — only the public projection drops it.
    const stored = await t.run(async (ctx) => {
      const rows = await ctx.db.query('purchases').collect();
      return rows[0];
    });
    expect(stored.createdBy).toBe(fx.owner);
  });

  test('a USD total passes through untouched', async () => {
    const { t, fx, supplierId } = await setup();
    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId,
      items: [{ productId: fx.cola, qty: 1 }],
      entered: 42.5,
      currency: 'usd',
    });

    const [purchase] = await t.query(api.purchases.bySupplier, {
      token: fx.ownerToken,
      supplierId,
    });
    expect(purchase.total).toBe(42.5);
    expect(purchase.currency).toBe('usd');
  });

  test('requires manage_suppliers', async () => {
    const { t, fx, supplierId } = await setup();
    await expect(
      t.mutation(api.purchases.create, {
        token: fx.cajeroPlainToken,
        supplierId,
        items: [{ productId: fx.cola, qty: 1 }],
        entered: 10,
        currency: 'usd',
      })
    ).rejects.toThrow('Sin permisos para esta acción.');
  });

  test('rejects an empty order, a non-positive qty and a non-positive total', async () => {
    const { t, fx, supplierId } = await setup();
    const base = {
      token: fx.ownerToken,
      supplierId,
      entered: 10,
      currency: 'usd' as const,
    };

    await expect(
      t.mutation(api.purchases.create, { ...base, items: [] })
    ).rejects.toThrow('La compra no tiene productos.');

    await expect(
      t.mutation(api.purchases.create, {
        ...base,
        items: [{ productId: fx.cola, qty: 0 }],
      })
    ).rejects.toThrow('Las cantidades deben ser mayores a cero.');

    await expect(
      t.mutation(api.purchases.create, {
        ...base,
        items: [{ productId: fx.cola, qty: 1 }],
        entered: 0,
      })
    ).rejects.toThrow('El monto debe ser mayor a cero.');

    // Nothing was written on any of the rejected attempts.
    await expect(
      t.query(api.purchases.bySupplier, { token: fx.ownerToken, supplierId })
    ).resolves.toHaveLength(0);
    expect(await stockOf(t, fx.cola)).toBe(24);
  });

  test('refuses an absurd amount — a typo of three extra zeros is caught', async () => {
    const { t, fx, supplierId } = await setup();

    await expect(
      t.mutation(api.purchases.create, {
        token: fx.ownerToken,
        supplierId,
        items: [{ productId: fx.cola, qty: 1 }],
        entered: 5_000_000_000, // fat-fingered dollars
        currency: 'usd',
      })
    ).rejects.toThrow('El monto de la compra es demasiado alto.');

    expect(await stockOf(t, fx.cola)).toBe(24);
  });

  test('a deleted product aborts the whole purchase — stock stays untouched', async () => {
    const { t, fx, supplierId } = await setup();
    await t.run((ctx) => ctx.db.delete('products', fx.agua));

    await expect(
      t.mutation(api.purchases.create, {
        token: fx.ownerToken,
        supplierId,
        items: [
          { productId: fx.cola, qty: 10 },
          { productId: fx.agua, qty: 5 }, // gone
        ],
        entered: 10,
        currency: 'usd',
      })
    ).rejects.toThrow('Producto no encontrado.');

    // The transaction rolled back: the first line did NOT land.
    expect(await stockOf(t, fx.cola)).toBe(24);
  });
});

describe('purchases.bySupplier', () => {
  test('returns only that supplier and requires a valid session', async () => {
    const { t, fx, supplierId } = await setup();
    const other = (
      await t.mutation(api.suppliers.create, {
        token: fx.ownerToken,
        name: 'Insumos del Norte',
        taxPrefix: 'J',
        taxId: '40777777-1',
      })
    )._id;

    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId,
      items: [{ productId: fx.cola, qty: 1 }],
      entered: 10,
      currency: 'usd',
    });

    await expect(
      t.query(api.purchases.bySupplier, { token: fx.ownerToken, supplierId })
    ).resolves.toHaveLength(1);
    await expect(
      t.query(api.purchases.bySupplier, {
        token: fx.ownerToken,
        supplierId: other,
      })
    ).resolves.toHaveLength(0);

    await expect(
      t.query(api.purchases.bySupplier, {
        token: 'not-a-real-token',
        supplierId,
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });
});

describe('purchases.remove', () => {
  test('puts the stock back and needs manage_suppliers', async () => {
    const { t, fx, supplierId } = await setup();
    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId,
      items: [{ productId: fx.cola, qty: 50 }],
      entered: 10,
      currency: 'usd',
    });
    expect(await stockOf(t, fx.cola)).toBe(74);

    const [purchase] = await t.query(api.purchases.bySupplier, {
      token: fx.ownerToken,
      supplierId,
    });

    await expect(
      t.mutation(api.purchases.remove, {
        token: fx.cajeroPlainToken,
        purchaseId: purchase._id,
      })
    ).rejects.toThrow('Sin permisos para esta acción.');

    await t.mutation(api.purchases.remove, {
      token: fx.ownerToken,
      purchaseId: purchase._id,
    });
    expect(await stockOf(t, fx.cola)).toBe(24);
    await expect(
      t.query(api.purchases.bySupplier, { token: fx.ownerToken, supplierId })
    ).resolves.toHaveLength(0);
  });

  test('reversal never drives stock negative — the units were already sold', async () => {
    const { t, fx, supplierId } = await setup();
    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId,
      items: [{ productId: fx.cola, qty: 50 }],
      entered: 10,
      currency: 'usd',
    });
    // Everything walked out the door before anyone noticed the mistake.
    await t.run((ctx) => ctx.db.patch('products', fx.cola, { stock: 3 }));

    const [purchase] = await t.query(api.purchases.bySupplier, {
      token: fx.ownerToken,
      supplierId,
    });
    await t.mutation(api.purchases.remove, {
      token: fx.ownerToken,
      purchaseId: purchase._id,
    });

    expect(await stockOf(t, fx.cola)).toBe(0); // clamped, not -47
  });
});

// Unit 3 — fractional quantities (product-base-unit). A product bought by weight
// is sold by weight: there is ONE base unit per product and no conversion, so
// the purchase side has to accept exactly what the sale side does.
describe('purchases — a weighed product can be received in fractions', () => {
  test('12.5 kg raises stock by 12.5, not by 12 or 13', async () => {
    const { t, fx, supplierId } = await setup();
    const cheese = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      barcode: '7591000009191',
      name: 'Queso amarillo',
      price: 8,
      stock: 2.5,
      minStock: 1,
      unit: 'kilogram',
    });

    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId,
      items: [{ productId: cheese, qty: 12.5 }],
      entered: 60,
      currency: 'usd',
    });

    const row = await t.run((ctx) => ctx.db.get('products', cheese));
    expect(row!.stock).toBe(15);
  });

  test('deleting that purchase puts the fraction back', async () => {
    const { t, fx, supplierId } = await setup();
    const cheese = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      barcode: '7591000009292',
      name: 'Queso blanco',
      price: 6,
      stock: 0.5,
      minStock: 1,
      unit: 'kilogram',
    });

    const purchase = await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId,
      items: [{ productId: cheese, qty: 4.25 }],
      entered: 25,
      currency: 'usd',
    });
    expect((await t.run((ctx) => ctx.db.get('products', cheese)))!.stock).toBe(
      4.75
    );

    await t.mutation(api.purchases.remove, {
      token: fx.ownerToken,
      purchaseId: purchase._id,
    });

    expect((await t.run((ctx) => ctx.db.get('products', cheese)))!.stock).toBe(
      0.5
    );
  });
});
