import { ConvexError, v } from 'convex/values';
import type { Infer } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { getSettings, requireSession, round2 } from './permissions';
import { clientSnapshotOf, snapshotLines } from './sales';
import {
  clientDocValidator,
  publicHeldCartDocValidator,
  saleItemValidator,
  splitItemValidator,
} from './schema';

/** A held cart as it leaves the server: no cashierId, optional cashierName. */
type PublicHeldCart = Infer<typeof publicHeldCartDocValidator>;

/**
 * Held carts are scoped by ROLE, not by permission: a `cajero` works only with
 * the sales they parked themselves, while `owner`/`admin` supervise the whole
 * floor. Written as an explicit allow-list so a future role defaults to the
 * narrow view instead of silently inheriting supervision.
 */
function supervisesHeldCarts(employee: Doc<'employees'>): boolean {
  return employee.role === 'owner' || employee.role === 'admin';
}

/**
 * Guard for the mutations that consume a held cart. Scoping the LIST alone would
 * be cosmetic: without this, a cajero holding any cart id could still resume it
 * (reading its lines) or discard it (destroying another cashier's work).
 */
function assertMayTouchHeldCart(
  employee: Doc<'employees'>,
  cart: Doc<'heldCarts'>
): void {
  if (supervisesHeldCarts(employee)) return;
  if (cart.cashierId !== employee._id) {
    throw new ConvexError('Esta venta en espera pertenece a otro cajero.');
  }
}

export const list = query({
  // Gated read: a valid session is required, and the stored cashierId is NOT
  // returned (held carts never expose an employee id). AUTH-2.
  //
  // Role-scoped (see supervisesHeldCarts): a cajero receives ONLY their own
  // parked sales; owner/admin receive all of them, each attributed by cashier
  // NAME so the floor can be told apart without leaking employee ids.
  args: { token: v.string() },
  returns: v.array(publicHeldCartDocValidator),
  // Annotated on purpose: the client's type is INFERRED from the handler, and the
  // two role branches return different shapes (a cajero's rows carry no
  // cashierName). Without this the inferred type is a union and consumers cannot
  // read the optional field at all. Anchoring it to the returns validator makes
  // the declared contract and the inferred type the same thing.
  handler: async (ctx, args): Promise<PublicHeldCart[]> => {
    const actor = await requireSession(ctx, args.token);

    if (!supervisesHeldCarts(actor)) {
      const own = await ctx.db
        .query('heldCarts')
        .withIndex('by_cashier', (q) => q.eq('cashierId', actor._id))
        .collect();
      // No attribution for a cajero: every row is theirs, so a name adds nothing.
      return own.map(({ cashierId: _cashierId, ...rest }) => rest);
    }

    const carts = await ctx.db.query('heldCarts').collect();
    // One lookup per distinct cashier, not per cart (a shift has few cashiers).
    const names = new Map<string, string>();
    for (const cart of carts) {
      if (names.has(cart.cashierId)) continue;
      const employee = await ctx.db.get('employees', cart.cashierId);
      // A deleted employee leaves their parked sales behind — label them rather
      // than dropping the cart from a supervisor's list.
      names.set(cart.cashierId, employee?.name ?? 'Empleado eliminado');
    }
    return carts.map(({ cashierId, ...rest }) => ({
      ...rest,
      cashierName: names.get(cashierId),
    }));
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
    const actor = await requireSession(ctx, args.token);
    const cart = await ctx.db.get('heldCarts', args.heldCartId);
    if (!cart) throw new ConvexError('Venta en espera no encontrada.');
    assertMayTouchHeldCart(actor, cart);
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
    const actor = await requireSession(ctx, args.token);
    const cart = await ctx.db.get('heldCarts', args.heldCartId);
    // An already-deleted id stays a silent no-op; an EXISTING cart owned by
    // someone else is refused rather than quietly destroyed.
    if (!cart) return null;
    assertMayTouchHeldCart(actor, cart);
    await ctx.db.delete('heldCarts', args.heldCartId);
    return null;
  },
});
