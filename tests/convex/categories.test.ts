/// <reference types="vite/client" />
// Categories: live product counts + the guided reassign-before-delete flow.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api, internal } from '@convex/_generated/api';
import schema from '@convex/schema';
import { seedBase } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
  return { t, fx };
}

describe('categories.list', () => {
  test('annotates each category with its live product count', async () => {
    const { t, fx } = await setup();
    const empty = await t.mutation(api.categories.create, {
      token: fx.ownerToken,
      label: 'Limpieza',
    });

    const list = await t.query(api.categories.list, {
      token: fx.cajeroPlainToken,
    });
    const bebidas = list.find((c) => c._id === fx.categoryId)!;
    const limpieza = list.find((c) => c._id === empty)!;
    expect(bebidas.count).toBe(4); // the four seeded products
    expect(limpieza.count).toBe(0);
  });

  test('rejects when there is no valid session (internal POS, no public endpoints)', async () => {
    const { t } = await setup();
    await expect(
      t.query(api.categories.list, { token: 'not-a-real-token' })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });
});

describe('categories mutations', () => {
  test('create/update require manage_products; update renames', async () => {
    const { t, fx } = await setup();

    await expect(
      t.mutation(api.categories.create, {
        token: fx.cajeroVoidToken,
        label: 'X',
      })
    ).rejects.toThrow('Sin permisos para esta acción.');

    await t.mutation(api.categories.update, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      label: 'Bebidas frías',
    });
    const cat = await t.run((ctx) => ctx.db.get('categories', fx.categoryId));
    expect(cat!.label).toBe('Bebidas frías');
  });

  test('removeWithReassign repoints every product, then deletes — never orphans', async () => {
    const { t, fx } = await setup();
    const target = await t.mutation(api.categories.create, {
      token: fx.ownerToken,
      label: 'Limpieza',
    });

    await t.mutation(api.categories.removeWithReassign, {
      token: fx.ownerToken,
      categoryId: fx.categoryId,
      reassignToId: target,
    });

    const products = await t.query(api.products.list, {
      token: fx.cajeroPlainToken,
    });
    expect(products).toHaveLength(4);
    expect(products.every((p) => p.categoryId === target)).toBe(true);

    const list = await t.query(api.categories.list, {
      token: fx.cajeroPlainToken,
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: 'Limpieza', count: 4 });
  });

  test('rejects reassigning a category to itself', async () => {
    const { t, fx } = await setup();
    await expect(
      t.mutation(api.categories.removeWithReassign, {
        token: fx.ownerToken,
        categoryId: fx.categoryId,
        reassignToId: fx.categoryId,
      })
    ).rejects.toThrow('Elige otra categoría para reasignar los productos.');
  });

  test('rejects missing source or target categories', async () => {
    const { t, fx } = await setup();
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert('categories', { label: 'Temporal' });
      await ctx.db.delete('categories', id);
      return id;
    });

    await expect(
      t.mutation(api.categories.removeWithReassign, {
        token: fx.ownerToken,
        categoryId: gone,
        reassignToId: fx.categoryId,
      })
    ).rejects.toThrow('Categoría no encontrada.');

    await expect(
      t.mutation(api.categories.removeWithReassign, {
        token: fx.ownerToken,
        categoryId: fx.categoryId,
        reassignToId: gone,
      })
    ).rejects.toThrow('Categoría no encontrada.');
  });
});

// --- Default category --------------------------------------------------------
// A deployment with zero categories cannot save a product. `ensureDefault` is
// the one-time command for deployments that already exist (bootstrap runs the
// same helper for new ones). It is keyed on the table being EMPTY, never on the
// label: a default the owner renamed must not come back beside its new name.
describe('categories.ensureDefault', () => {
  test('leaves a populated table alone — no `General` beside `Bebidas`', async () => {
    // seedBase inserts exactly one category, `Bebidas`, and nothing else.
    const { t, fx } = await setup();

    const id = await t.mutation(internal.categories.ensureDefault, {});

    expect(id).toBe(fx.categoryId);
    const rows = await t.run((ctx) => ctx.db.query('categories').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Bebidas');
  });

  test('an empty table gets exactly one `General`, however often it runs', async () => {
    const t = convexTest(schema, modules);

    const first = await t.mutation(internal.categories.ensureDefault, {});
    const second = await t.mutation(internal.categories.ensureDefault, {});

    const rows = await t.run((ctx) => ctx.db.query('categories').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('General');
    expect(first).toBe(rows[0]._id);
    expect(second).toBe(rows[0]._id);
  });

  test('renaming `General` does not resurrect it', async () => {
    const t = convexTest(schema, modules);
    const id = await t.mutation(internal.categories.ensureDefault, {});
    await t.run((ctx) => ctx.db.patch('categories', id, { label: 'Víveres' }));

    await t.mutation(internal.categories.ensureDefault, {});

    const rows = await t.run((ctx) => ctx.db.query('categories').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Víveres');
  });
});
