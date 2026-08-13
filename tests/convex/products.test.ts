/// <reference types="vite/client" />
// Products CRUD + the scanner's barcode lookup.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import schema from '@convex/schema';
import { seedBase } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
  return { t, fx };
}

describe('products.byBarcode — the scanner lookup', () => {
  test('finds the exact barcode and returns null for unknown codes (session-gated)', async () => {
    const { t, fx } = await setup();
    // Operational read: cajeroPlain (no manage_products) may still scan.
    const found = await t.query(api.products.byBarcode, {
      token: fx.cajeroPlainToken,
      barcode: '7591000000123',
    });
    expect(found?._id).toBe(fx.cola);
    expect(found?.name).toBe('Coca-Cola 600ml');

    await expect(
      t.query(api.products.byBarcode, {
        token: fx.cajeroPlainToken,
        barcode: '0000000000000',
      })
    ).resolves.toBeNull();
  });
});

describe('products reads — gated by requireSession (internal POS, no public endpoints)', () => {
  test('list returns the catalog for any valid session', async () => {
    const { t, fx } = await setup();
    const products = await t.query(api.products.list, {
      token: fx.cajeroPlainToken,
    });
    expect(products.some((p) => p._id === fx.cola)).toBe(true);
  });

  test('list and byBarcode reject when there is no valid session', async () => {
    const { t } = await setup();
    await expect(
      t.query(api.products.list, { token: 'not-a-real-token' })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
    await expect(
      t.query(api.products.byBarcode, {
        token: 'not-a-real-token',
        barcode: '7591000000123',
      })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });
});

describe('products mutations', () => {
  test('create requires manage_products and stores the given fields', async () => {
    const { t, fx } = await setup();

    await expect(
      t.mutation(api.products.create, {
        token: fx.cajeroVoidToken, // no manage_products
        barcode: '7590000000001',
        sku: 'NUE-1',
        name: 'Nuevo producto',
        price: 2,
        stock: 10,
        minStock: 5,
        categoryId: fx.categoryId,
      })
    ).rejects.toThrow('Sin permisos para esta acción.');

    const id = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      barcode: '7590000000001',
      sku: 'NUE-1',
      name: 'Nuevo producto',
      price: 2,
      stock: 10,
      minStock: 5,
      categoryId: fx.categoryId,
      exempt: true,
      glyph: '🆕',
    });
    const doc = await t.run((ctx) => ctx.db.get('products', id));
    expect(doc).toMatchObject({
      barcode: '7590000000001',
      name: 'Nuevo producto',
      price: 2,
      stock: 10,
      exempt: true,
      glyph: '🆕',
    });
  });

  test('update patches fields and rejects missing products', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId: fx.cola,
      patch: { price: 1.75, name: 'Coca-Cola 600ml retornable' },
    });
    const cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.price).toBe(1.75);
    expect(cola!.name).toBe('Coca-Cola 600ml retornable');
    expect(cola!.stock).toBe(24); // untouched fields stay

    await t.run((ctx) => ctx.db.delete('products', fx.cafe));
    await expect(
      t.mutation(api.products.update, {
        token: fx.ownerToken,
        productId: fx.cafe,
        patch: { price: 6 },
      })
    ).rejects.toThrow('Producto no encontrado.');
  });

  test('setSellable pauses and resumes a product', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.products.setSellable, {
      token: fx.ownerToken,
      productId: fx.cola,
      sellable: false,
    });
    let cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.sellable).toBe(false);

    await t.mutation(api.products.setSellable, {
      token: fx.ownerToken,
      productId: fx.cola,
      sellable: true,
    });
    cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.sellable).toBe(true);
  });

  test('adjustStock sets an absolute value and rejects negatives', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.products.adjustStock, {
      token: fx.ownerToken,
      productId: fx.cafe,
      stock: 50,
    });
    const cafe = await t.run((ctx) => ctx.db.get('products', fx.cafe));
    expect(cafe!.stock).toBe(50);

    await expect(
      t.mutation(api.products.adjustStock, {
        token: fx.ownerToken,
        productId: fx.cafe,
        stock: -1,
      })
    ).rejects.toThrow('El stock no puede ser negativo.');
  });

  test('remove deletes and is idempotent (sales keep their snapshots)', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.products.remove, {
      token: fx.ownerToken,
      productId: fx.cola,
    });
    await expect(
      t.run((ctx) => ctx.db.get('products', fx.cola))
    ).resolves.toBeNull();

    // Second remove of the same id: silent no-op
    await t.mutation(api.products.remove, {
      token: fx.ownerToken,
      productId: fx.cola,
    });
  });
});

// --- Preferred supplier -----------------------------------------------------
// A reordering hint, never sales data: it answers "who do I call to restock",
// which has one answer at a time. `purchases` already records everyone this was
// actually bought from, with dates.
describe('products — preferred supplier', () => {
  async function withSupplier() {
    const { t, fx } = await setup();
    const supplier = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: 'Distribuidora El Sol, C.A.',
      taxPrefix: 'J',
      taxId: '40123456-7',
    });
    return { t, fx, supplier };
  }

  const newProduct = (extra: Record<string, unknown> = {}) => ({
    barcode: '7591000009999',
    sku: 'NEW-1',
    name: 'Producto nuevo',
    price: 1,
    stock: 0,
    minStock: 1,
    ...extra,
  });

  test('a product can be created with a supplier, and without one', async () => {
    const { t, fx, supplier } = await withSupplier();

    const withId = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      supplierId: supplier._id,
      ...newProduct(),
    });
    const without = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct({ barcode: '7591000008888', sku: 'NEW-2' }),
    });

    const rows = await t.run(async (ctx) => ({
      a: await ctx.db.get('products', withId),
      b: await ctx.db.get('products', without),
    }));
    expect(rows.a!.supplierId).toBe(supplier._id);
    // Absent, not null: an unset optional is simply not stored.
    expect(rows.b).not.toHaveProperty('supplierId');
  });

  test('the supplier can be attached and later cleared', async () => {
    const { t, fx, supplier } = await withSupplier();
    const productId = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct(),
    });

    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId,
      patch: { supplierId: supplier._id },
    });
    expect(
      (await t.run((ctx) => ctx.db.get('products', productId)))!.supplierId
    ).toBe(supplier._id);

    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId,
      patch: { supplierId: null },
    });
    expect(
      await t.run((ctx) => ctx.db.get('products', productId))
    ).not.toHaveProperty('supplierId');
  });

  test('changing the supplier leaves past sales and purchases untouched', async () => {
    const { t, fx, supplier } = await withSupplier();
    await t.mutation(api.purchases.create, {
      token: fx.ownerToken,
      supplierId: supplier._id,
      items: [{ productId: fx.cola, qty: 5 }],
      entered: 10,
      currency: 'usd',
    });

    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId: fx.cola,
      patch: { supplierId: supplier._id },
    });

    const [purchase] = await t.query(api.purchases.bySupplier, {
      token: fx.ownerToken,
      supplierId: supplier._id,
    });
    expect(purchase.items[0].name).toBe('Coca-Cola 600ml');
    expect(purchase.supplierName).toBe('Distribuidora El Sol, C.A.');
  });
});
