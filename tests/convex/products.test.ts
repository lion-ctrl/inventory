/// <reference types="vite/client" />
// Products CRUD + the scanner's barcode lookup.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
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
      name: 'Nuevo producto',
      price: 2,
      stock: 10,
      minStock: 5,
      categoryId: fx.categoryId,
      exempt: true,
    });
    const doc = await t.run((ctx) => ctx.db.get('products', id));
    expect(doc).toMatchObject({
      barcode: '7590000000001',
      name: 'Nuevo producto',
      price: 2,
      stock: 10,
      exempt: true,
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
      ...newProduct({ barcode: '7591000008888' }),
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

// --- Product photo (first use of Convex File Storage) -----------------------
// The image itself never travels through a mutation: the client uploads to a
// minted URL and saves only the returned reference. `list` resolves that
// reference to a displayable address so a screen never asks per product.
describe('products — photo', () => {
  const newProduct = (extra: Record<string, unknown> = {}) => ({
    barcode: '7591000007777',
    name: 'Producto con foto',
    price: 1,
    stock: 0,
    minStock: 1,
    ...extra,
  });

  test('an upload URL is minted only for someone who may manage products', async () => {
    const { t, fx } = await setup();

    await expect(
      t.mutation(api.products.generateUploadUrl, {
        token: fx.cajeroPlainToken,
      })
    ).rejects.toThrow('Sin permisos para esta acción.');

    const url = await t.mutation(api.products.generateUploadUrl, {
      token: fx.ownerToken,
    });
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  test('list resolves an address ONLY for photographed products', async () => {
    const { t, fx } = await setup();
    const imageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['fake-jpeg'], { type: 'image/jpeg' }))
    );

    await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      imageId,
      ...newProduct(),
    });

    const list = await t.query(api.products.list, { token: fx.ownerToken });
    const withPhoto = list.find((p) => p.name === 'Producto con foto')!;
    const withoutPhoto = list.find((p) => p.sku === 'COCA-600')!;

    expect(typeof withPhoto.imageUrl).toBe('string');
    // A product with no photo costs nothing extra and carries no address.
    expect(withoutPhoto.imageUrl).toBeUndefined();
  });

  test('a photo can be attached, replaced and removed', async () => {
    const { t, fx } = await setup();
    const [first, second] = await t.run(async (ctx) => [
      await ctx.storage.store(new Blob(['one'], { type: 'image/jpeg' })),
      await ctx.storage.store(new Blob(['two'], { type: 'image/jpeg' })),
    ]);
    const productId = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct(),
    });

    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId,
      patch: { imageId: first },
    });
    expect(
      (await t.run((ctx) => ctx.db.get('products', productId)))!.imageId
    ).toBe(first);

    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId,
      patch: { imageId: second },
    });
    expect(
      (await t.run((ctx) => ctx.db.get('products', productId)))!.imageId
    ).toBe(second);

    // null CLEARS, exactly like the supplier link.
    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId,
      patch: { imageId: null },
    });
    expect(
      await t.run((ctx) => ctx.db.get('products', productId))
    ).not.toHaveProperty('imageId');
  });
});

// --- Domain guards at EVERY entry point ------------------------------------
// `adjustStock` already refused negative stock, but `create` and `update` let the
// same value in through the side door — a rule that lives in one function is not
// a rule. Negative price is worse: it produces negative sale totals downstream.
describe('products — domain guards', () => {
  const newProduct = (extra: Record<string, unknown> = {}) => ({
    barcode: '7591000006666',
    name: 'Producto guardado',
    price: 1,
    stock: 0,
    minStock: 1,
    ...extra,
  });

  test('create refuses a negative price or stock', async () => {
    const { t, fx } = await setup();
    const base = { token: fx.ownerToken, categoryId: fx.categoryId };

    await expect(
      t.mutation(api.products.create, {
        ...base,
        ...newProduct({ price: -50 }),
      })
    ).rejects.toThrow('El precio no puede ser negativo.');

    await expect(
      t.mutation(api.products.create, {
        ...base,
        ...newProduct({ stock: -10 }),
      })
    ).rejects.toThrow('El stock no puede ser negativo.');

    await expect(
      t.mutation(api.products.create, {
        ...base,
        ...newProduct({ minStock: -1 }),
      })
    ).rejects.toThrow('El stock mínimo no puede ser negativo.');
  });

  test('update cannot walk stock or price negative past adjustStock', async () => {
    const { t, fx } = await setup();

    // adjustStock refuses this…
    await expect(
      t.mutation(api.products.adjustStock, {
        token: fx.ownerToken,
        productId: fx.cola,
        stock: -5,
      })
    ).rejects.toThrow('El stock no puede ser negativo.');

    // …and so must the door next to it.
    await expect(
      t.mutation(api.products.update, {
        token: fx.ownerToken,
        productId: fx.cola,
        patch: { stock: -5 },
      })
    ).rejects.toThrow('El stock no puede ser negativo.');

    await expect(
      t.mutation(api.products.update, {
        token: fx.ownerToken,
        productId: fx.cola,
        patch: { price: -1 },
      })
    ).rejects.toThrow('El precio no puede ser negativo.');

    const cola = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(cola!.stock).toBe(24);
    expect(cola!.price).toBe(1.5);
  });

  test('a barcode identifies exactly one product', async () => {
    const { t, fx } = await setup();

    // The scanner resolves by_barcode with .first(): two products sharing a code
    // would make it return one of them silently, with no way to tell which.
    await expect(
      t.mutation(api.products.create, {
        token: fx.ownerToken,
        categoryId: fx.categoryId,
        ...newProduct({ barcode: '7591000000123' }), // cola's barcode
      })
    ).rejects.toThrow('Ya existe un producto con ese código de barras.');

    const created = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct(),
    });
    await expect(
      t.mutation(api.products.update, {
        token: fx.ownerToken,
        productId: created,
        patch: { barcode: '7591000000123' },
      })
    ).rejects.toThrow('Ya existe un producto con ese código de barras.');

    // Keeping its OWN barcode is not a collision.
    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId: created,
      patch: { barcode: '7591000006666', name: 'Renombrado' },
    });
    expect((await t.run((ctx) => ctx.db.get('products', created)))!.name).toBe(
      'Renombrado'
    );
  });
});

// Replacing or clearing a photo used to orphan the previous file: storage kept a
// blob nothing referenced, with no owner and no way to find it again.
describe('products — the replaced photo is not orphaned', () => {
  test('replacing and clearing a photo removes the previous file from storage', async () => {
    const { t, fx } = await setup();
    const [first, second] = await t.run(async (ctx) => [
      await ctx.storage.store(new Blob(['one'], { type: 'image/jpeg' })),
      await ctx.storage.store(new Blob(['two'], { type: 'image/jpeg' })),
    ]);
    const productId = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      barcode: '7591000005555',
      name: 'Producto con foto',
      price: 1,
      stock: 0,
      minStock: 1,
      imageId: first,
    });

    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId,
      patch: { imageId: second },
    });
    // The replaced blob is gone; the new one is live.
    expect(await t.run((ctx) => ctx.storage.getUrl(first))).toBeNull();
    expect(await t.run((ctx) => ctx.storage.getUrl(second))).not.toBeNull();

    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId,
      patch: { imageId: null },
    });
    expect(await t.run((ctx) => ctx.storage.getUrl(second))).toBeNull();
  });
});

// Unit 4 — the SKU derives itself (product-sku-generation). The caller no longer
// supplies one, so uniqueness stops depending on whoever happened to be typing.
describe('products — the SKU derives itself from the name', () => {
  const newProduct = (extra: Record<string, unknown> = {}) => ({
    barcode: '7591000007777',
    name: 'Café con leche 250g',
    price: 1,
    stock: 0,
    minStock: 1,
    ...extra,
  });

  const skuOf = async (
    t: Awaited<ReturnType<typeof setup>>['t'],
    id: Id<'products'>
  ) => (await t.run(async (ctx) => ctx.db.get('products', id)))!.sku;

  test('create takes no SKU and stores one derived from the name', async () => {
    const { t, fx } = await setup();
    const id = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct(),
    });
    expect(await skuOf(t, id)).toBe('CAFE-CON-LECHE-250G');
  });

  test('three products from the same name get the code, -2 and -3', async () => {
    const { t, fx } = await setup();
    const ids: Id<'products'>[] = [];
    for (const barcode of ['7591000000001', '7591000000002', '7591000000003']) {
      ids.push(
        await t.mutation(api.products.create, {
          token: fx.ownerToken,
          categoryId: fx.categoryId,
          ...newProduct({ barcode }),
        })
      );
    }
    const skus = await Promise.all(ids.map((id) => skuOf(t, id)));
    expect(skus).toEqual([
      'CAFE-CON-LECHE-250G',
      'CAFE-CON-LECHE-250G-2',
      'CAFE-CON-LECHE-250G-3',
    ]);
    // The point of the suffix: three rows, three identifiers.
    expect(new Set(skus).size).toBe(3);
  });

  test('a name that derives to nothing still produces a usable SKU', async () => {
    const { t, fx } = await setup();
    const id = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct({ name: '🥤🥤🥤' }),
    });
    expect(await skuOf(t, id)).toBe('PROD');
  });

  test('renaming a product does NOT move its SKU', async () => {
    // The code may already be printed on a shelf label or written on a purchase
    // order. Rewriting it silently would invalidate those with no warning.
    const { t, fx } = await setup();
    const id = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct(),
    });

    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId: id,
      patch: { name: 'Otra cosa totalmente distinta' },
    });

    const row = (await t.run(async (ctx) => ctx.db.get('products', id)))!;
    expect(row.name).toBe('Otra cosa totalmente distinta');
    expect(row.sku).toBe('CAFE-CON-LECHE-250G');
  });

  test('a derived SKU never collides with an unrelated longer code', async () => {
    // 'CAFE' and 'CAFE-CON-LECHE-250G' share a prefix and come back in the same
    // indexed read; only an EXACT match is a collision.
    const { t, fx } = await setup();
    const long = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct(),
    });
    const short = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct({ barcode: '7591000006666', name: 'Café' }),
    });
    expect(await skuOf(t, long)).toBe('CAFE-CON-LECHE-250G');
    expect(await skuOf(t, short)).toBe('CAFE');
  });
});

// The rule `update` already enforces, applied where it was missing. A blob with
// no document pointing at it has no owner and no way to be found again — it is
// paid storage that nothing can ever reach.
describe('products — a deleted product does not orphan its photo', () => {
  const photographed = async () => {
    const { t, fx } = await setup();
    const imageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['fake-jpeg'], { type: 'image/jpeg' }))
    );
    const productId = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      barcode: '7591000005555',
      name: 'Producto con foto',
      price: 1,
      stock: 0,
      minStock: 1,
      imageId,
    });
    return { t, fx, productId, imageId };
  };

  const fileStillThere = (
    t: Awaited<ReturnType<typeof setup>>['t'],
    imageId: Id<'_storage'>
  ) =>
    t.run(
      async (ctx) => (await ctx.db.system.get('_storage', imageId)) !== null
    );

  test('removing the product deletes the stored file too', async () => {
    const { t, fx, productId, imageId } = await photographed();
    expect(await fileStillThere(t, imageId)).toBe(true);

    await t.mutation(api.products.remove, { token: fx.ownerToken, productId });

    expect(await fileStillThere(t, imageId)).toBe(false);
  });

  test('removing a product with no photo is unaffected', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.products.remove, {
      token: fx.ownerToken,
      productId: fx.cola,
    });
    expect(await t.run((ctx) => ctx.db.get('products', fx.cola))).toBeNull();
  });
});

// `assertProductNumbers` documents itself as "applied at EVERY entry point".
// adjustStock kept its own older check, and `NaN < 0` is false.
describe('products — adjustStock is guarded like every other entry point', () => {
  test('a negative stock is still refused', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.products.adjustStock, {
        token: fx.ownerToken,
        productId: fx.cola,
        stock: -1,
      })
    ).rejects.toThrow('El stock no puede ser negativo.');
  });

  test('NaN is refused, and never reaches the document', async () => {
    // A NaN stock poisons every total the catalogue screen derives from it.
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.products.adjustStock, {
        token: fx.ownerToken,
        productId: fx.cola,
        stock: NaN,
      })
    ).rejects.toThrow('El stock no puede ser negativo.');

    const row = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(Number.isFinite(row!.stock)).toBe(true);
  });
});

// `v.id('categories')` validates the SHAPE of an id, never that the document is
// still there. A product pointing at a deleted category renders with an empty
// category label and no error — a dangling reference that leaves no trace.
describe('products — references are checked, not just well-formed', () => {
  const base = {
    barcode: '7591000004444',
    name: 'Producto nuevo',
    price: 1,
    stock: 0,
    minStock: 1,
  };

  test('create refuses a category that no longer exists', async () => {
    const { t, fx } = await setup();
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert('categories', { label: 'Temporal' });
      await ctx.db.delete('categories', id);
      return id;
    });

    await expect(
      t.mutation(api.products.create, {
        token: fx.ownerToken,
        categoryId: ghost,
        ...base,
      })
    ).rejects.toThrow('Categoría no encontrada.');
  });

  test('create refuses a supplier that no longer exists', async () => {
    const { t, fx } = await setup();
    const supplier = await t.mutation(api.suppliers.create, {
      token: fx.ownerToken,
      name: 'Se va a borrar',
      taxPrefix: 'J',
      taxId: '40999999-9',
    });
    await t.run((ctx) => ctx.db.delete('suppliers', supplier._id));

    await expect(
      t.mutation(api.products.create, {
        token: fx.ownerToken,
        categoryId: fx.categoryId,
        supplierId: supplier._id,
        ...base,
      })
    ).rejects.toThrow('Proveedor no encontrado.');
  });

  test('update refuses moving a product to a category that no longer exists', async () => {
    const { t, fx } = await setup();
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert('categories', { label: 'Temporal' });
      await ctx.db.delete('categories', id);
      return id;
    });

    await expect(
      t.mutation(api.products.update, {
        token: fx.ownerToken,
        productId: fx.cola,
        patch: { categoryId: ghost },
      })
    ).rejects.toThrow('Categoría no encontrada.');
  });
});

// The barcode guard answers "is this code taken" by reading the index. It asks
// for ONE row, which is only ever enough because the caller happens to skip the
// check when the code is unchanged. A guard that is correct because of what its
// caller remembers is not a guard, so it reads enough rows to answer alone.
describe('products — the barcode guard answers on its own terms', () => {
  test('a duplicate already in the catalogue still blocks a new product', async () => {
    const { t, fx } = await setup();
    await t.run(async (ctx) => {
      const shared = '7591000003333';
      const mk = (name: string, sku: string) =>
        ctx.db.insert('products', {
          barcode: shared,
          sku,
          name,
          price: 1,
          stock: 0,
          minStock: 1,
          categoryId: fx.categoryId,
        });
      await mk('Uno', 'UNO');
      await mk('Dos', 'DOS');
    });

    await expect(
      t.mutation(api.products.create, {
        token: fx.ownerToken,
        categoryId: fx.categoryId,
        barcode: '7591000003333',
        name: 'Tres',
        price: 1,
        stock: 0,
        minStock: 1,
      })
    ).rejects.toThrow('Ya existe un producto con ese código de barras.');
  });
});

// Unit 3 — the base unit (product-base-unit). Optional, so every product that
// existed before this behaves as a counted one with no backfill.
describe('products — the base unit', () => {
  const newProduct = (extra: Record<string, unknown> = {}) => ({
    barcode: '7591000002222',
    name: 'Queso amarillo',
    price: 8,
    stock: 10,
    minStock: 1,
    ...extra,
  });

  test('a product can declare a unit, and one without stays valid', async () => {
    const { t, fx } = await setup();
    const weighed = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      unit: 'kilogram',
      ...newProduct(),
    });
    const counted = await t.mutation(api.products.create, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      ...newProduct({ barcode: '7591000001111', name: 'Refresco' }),
    });

    const rows = await t.run(async (ctx) => ({
      a: await ctx.db.get('products', weighed),
      b: await ctx.db.get('products', counted),
    }));
    expect(rows.a!.unit).toBe('kilogram');
    // Absent, not defaulted into the document: an unset optional is not stored.
    expect(rows.b).not.toHaveProperty('unit');
  });

  test('a unit outside the catalogue is refused by the validator', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.products.create, {
        token: fx.ownerToken,
        categoryId: fx.categoryId,
        // @ts-expect-error the union is closed, which is the point: the compiler
        // already refuses this, and the runtime validator has to refuse it too
        // for anything reaching the server that TypeScript never saw.
        unit: 'parsec',
        ...newProduct(),
      })
    ).rejects.toThrow();
  });

  test('the unit can be changed after creation', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.products.update, {
      token: fx.ownerToken,
      productId: fx.cola,
      patch: { unit: 'bottle' },
    });
    const row = await t.run((ctx) => ctx.db.get('products', fx.cola));
    expect(row!.unit).toBe('bottle');
  });
});
