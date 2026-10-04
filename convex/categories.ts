import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requirePerm, requireSession } from './permissions';
import { categoryFields } from './schema';

/** The label of the category every deployment starts with. */
export const DEFAULT_CATEGORY_LABEL = 'General';

/**
 * Guarantee the deployment has at least one category and return one that
 * exists. Every product requires a category, so an empty table makes the
 * product form unsaveable and tells a fresh owner nothing.
 *
 * Keyed on the table being EMPTY, never on the label: `first()` asks "is there
 * any row" and one row is the whole answer. A label lookup would resurrect
 * `General` beside a default the owner had renamed to `Víveres`, and
 * `removeWithReassign` already refuses the last category, so emptiness is the
 * one invariant that needs restoring. Shared with `bootstrap.createFirstOwner`
 * as a plain helper rather than a nested mutation call.
 */
export async function ensureDefaultCategory(
  ctx: MutationCtx
): Promise<Id<'categories'>> {
  const existing = await ctx.db.query('categories').first();
  if (existing) return existing._id;
  return await ctx.db.insert('categories', { label: DEFAULT_CATEGORY_LABEL });
}

/**
 * One-time backfill for deployments that predate the default category.
 * INTERNAL exactly like `bootstrap.createFirstOwner`: whoever can deploy may
 * run it, nobody who merely knows the URL can. Invoked once from the CLI:
 *
 *   npx convex run categories:ensureDefault --prod
 *
 * Returns the id so the CLI prints proof; re-running is a no-op.
 */
export const ensureDefault = internalMutation({
  args: {},
  returns: v.id('categories'),
  handler: async (ctx) => await ensureDefaultCategory(ctx),
});

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
