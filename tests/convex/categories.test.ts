/// <reference types="vite/client" />
// Categories: live product counts + the guided reassign-before-delete flow.
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

describe('categories.list', () => {
  test('annotates each category with its live product count', async () => {
    const { t, fx } = await setup();
    const empty = await t.mutation(api.categories.create, {
      token: fx.ownerToken,
      label: 'Limpieza',
    });

    const list = await t.query(api.categories.list, {});
    const bebidas = list.find((c) => c._id === fx.categoryId)!;
    const limpieza = list.find((c) => c._id === empty)!;
    expect(bebidas.count).toBe(4); // the four seeded products
    expect(limpieza.count).toBe(0);
  });
});

describe('categories mutations', () => {
  test('create/update require manage_products; update renames', async () => {
    const { t, fx } = await setup();

    await expect(
      t.mutation(api.categories.create, { token: fx.cajeroVoidToken, label: 'X' })
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

    const products = await t.query(api.products.list, {});
    expect(products).toHaveLength(4);
    expect(products.every((p) => p.categoryId === target)).toBe(true);

    const list = await t.query(api.categories.list, {});
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
