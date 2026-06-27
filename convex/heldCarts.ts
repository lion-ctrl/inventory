import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getSettings, requireSession, round2 } from './permissions';
import { clientSnapshotOf, snapshotLines } from './sales';
import {
  clientDocValidator,
  publicHeldCartDocValidator,
  saleItemValidator,
  splitItemValidator,
} from './schema';

export const list = query({
  // Gated read: a valid session is required, and the stored cashierId is NOT
  // returned (held carts never displayed a cashier). AUTH-2.
  args: { token: v.string() },
  returns: v.array(publicHeldCartDocValidator),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
    const carts = await ctx.db.query('heldCarts').collect();
    return carts.map(({ cashierId: _cashierId, ...rest }) => rest);
  },
});

export const park = mutation({
  args: {
    token: v.string(),
    clientId: v.optional(v.id('clients')),
    items: v.array(v.object({ productId: v.id('products'), qty: v.number() })),
    splits: v.optional(v.array(splitItemValidator)),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Any active employee may park — a valid session is enough.
    const actor = await requireSession(ctx, args.token);
    if (args.items.length === 0) {
      throw new ConvexError('No hay productos en el carrito.');
    }
    const settings = await getSettings(ctx);

    // Snapshot from LIVE products (same shape as sale items, incl. exempt +
    // category label). Parking does not consume stock nor block paused items.
    const lines = await snapshotLines(ctx, args.items, {
      enforceSellable: false,
    });
    const total = round2(
      lines.reduce((sum, l) => sum + l.product.price * l.qty, 0)
    );

    let clientFields = {};
    if (args.clientId !== undefined) {
      const client = await ctx.db.get('clients', args.clientId);
      if (!client) throw new ConvexError('Cliente no encontrado.');
      clientFields = { clientId: client._id, client: clientSnapshotOf(client) };
    }

    const code = String(settings.nextHeldCode).padStart(8, '0');
    await ctx.db.patch('settings', settings._id, {
      nextHeldCode: settings.nextHeldCode + 1,
    });

    await ctx.db.insert('heldCarts', {
      code,
      ...clientFields,
      cashierId: actor._id,
      items: lines.map((l) => l.snapshot),
      ...(args.splits !== undefined ? { splits: args.splits } : {}),
      total,
      ...(args.note ? { note: args.note } : {}),
      createdAt: Date.now(),
    });
    return null;
  },
});

export const resume = mutation({
  args: {
    token: v.string(),
    heldCartId: v.id('heldCarts'),
  },
  returns: v.object({
    client: v.union(clientDocValidator, v.null()),
    items: v.array(saleItemValidator),
    splits: v.optional(v.array(splitItemValidator)),
  }),
  handler: async (ctx, args) => {
    // Resume deletes the held row — only a valid session may do it.
    await requireSession(ctx, args.token);
    const cart = await ctx.db.get('heldCarts', args.heldCartId);
    if (!cart) throw new ConvexError('Venta en espera no encontrada.');
    // Live client (may have been deleted since parking → null).
    const client =
      cart.clientId !== undefined
        ? await ctx.db.get('clients', cart.clientId)
        : null;
    await ctx.db.delete('heldCarts', args.heldCartId);
    return {
      client,
      items: cart.items,
      ...(cart.splits !== undefined ? { splits: cart.splits } : {}),
    };
  },
});

export const discard = mutation({
  args: {
    token: v.string(),
    heldCartId: v.id('heldCarts'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Discard is a deletion — only a valid session may do it.
    await requireSession(ctx, args.token);
    const cart = await ctx.db.get('heldCarts', args.heldCartId);
    if (cart) await ctx.db.delete('heldCarts', args.heldCartId);
    return null;
  },
});
