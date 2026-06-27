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
  test('finds the exact barcode and returns null for unknown codes', async () => {
    const { t, fx } = await setup();
    const found = await t.query(api.products.byBarcode, {
      barcode: '7591000000123',
    });
    expect(found?._id).toBe(fx.cola);
    expect(found?.name).toBe('Coca-Cola 600ml');

    await expect(
      t.query(api.products.byBarcode, { barcode: '0000000000000' })
    ).resolves.toBeNull();
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
