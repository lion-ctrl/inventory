import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requirePerm, requireSession } from './permissions';
import { categoryFields } from './schema';

// Internal POS — no public endpoints. Operational read (Venta/Escanear/Productos
// all show category chips), so it is gated by requireSession only — any active
// employee, never a management permission.
export const list = query({
  args: { token: v.string() },
  returns: v.array(
    v.object({
      _id: v.id('categories'),
      _creationTime: v.number(),
      ...categoryFields,
      count: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
    const categories = await ctx.db.query('categories').collect();
    const products = await ctx.db.query('products').collect();
    const counts = new Map<string, number>();
    for (const p of products) {
      counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
    }
    return categories.map((c) => ({ ...c, count: counts.get(c._id) ?? 0 }));
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    label: v.string(),
  },
  returns: v.id('categories'),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_products');
    return await ctx.db.insert('categories', { label: args.label });
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    categoryId: v.id('categories'),
    label: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_products');
    const category = await ctx.db.get('categories', args.categoryId);
    if (!category) throw new ConvexError('Categoría no encontrada.');
    await ctx.db.patch('categories', args.categoryId, { label: args.label });
    return null;
  },
});

export const removeWithReassign = mutation({
  args: {
    token: v.string(),
    categoryId: v.id('categories'),
    reassignToId: v.id('categories'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_products');
    if (args.reassignToId === args.categoryId) {
      throw new ConvexError(
        'Elige otra categoría para reasignar los productos.'
      );
    }
    const category = await ctx.db.get('categories', args.categoryId);
    if (!category) throw new ConvexError('Categoría no encontrada.');
    const target = await ctx.db.get('categories', args.reassignToId);
    if (!target) throw new ConvexError('Categoría no encontrada.');

    const products = await ctx.db
      .query('products')
      .withIndex('by_category', (q) => q.eq('categoryId', args.categoryId))
      .collect();
    for (const product of products) {
      await ctx.db.patch('products', product._id, {
        categoryId: args.reassignToId,
      });
    }
    await ctx.db.delete('categories', args.categoryId);
    return null;
  },
});
