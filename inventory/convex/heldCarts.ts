import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getSettings, round2 } from "./permissions";
import { clientSnapshotOf, snapshotLines } from "./sales";
import {
  clientDocValidator,
  heldCartDocValidator,
  saleItemValidator,
  splitItemValidator,
} from "./schema";

export const list = query({
  args: {},
  returns: v.array(heldCartDocValidator),
  handler: async (ctx) => {
    return await ctx.db.query("heldCarts").collect();
  },
});

export const park = mutation({
  args: {
    actorId: v.id("employees"),
    clientId: v.optional(v.id("clients")),
    items: v.array(
      v.object({ productId: v.id("products"), qty: v.number() }),
    ),
    splits: v.optional(v.array(splitItemValidator)),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await ctx.db.get("employees", args.actorId);
    if (!actor || !actor.active) {
      throw new ConvexError("Sin permisos para esta acción.");
    }
    if (args.items.length === 0) {
      throw new ConvexError("No hay productos en el carrito.");
    }
    const settings = await getSettings(ctx);

    // Snapshot from LIVE products (same shape as sale items, incl. exempt +
    // category label). Parking does not consume stock nor block paused items.
    const lines = await snapshotLines(ctx, args.items, {
      enforceSellable: false,
    });
    const total = round2(
      lines.reduce((sum, l) => sum + l.product.price * l.qty, 0),
    );

    let clientFields = {};
    if (args.clientId !== undefined) {
      const client = await ctx.db.get("clients", args.clientId);
      if (!client) throw new ConvexError("Cliente no encontrado.");
      clientFields = { clientId: client._id, client: clientSnapshotOf(client) };
    }

    const code = String(settings.nextHeldCode).padStart(8, "0");
    await ctx.db.patch("settings", settings._id, {
      nextHeldCode: settings.nextHeldCode + 1,
    });

    await ctx.db.insert("heldCarts", {
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
    actorId: v.id("employees"),
    heldCartId: v.id("heldCarts"),
  },
  returns: v.object({
    client: v.union(clientDocValidator, v.null()),
    items: v.array(saleItemValidator),
    splits: v.optional(v.array(splitItemValidator)),
  }),
  handler: async (ctx, args) => {
    const cart = await ctx.db.get("heldCarts", args.heldCartId);
    if (!cart) throw new ConvexError("Venta en espera no encontrada.");
    // Live client (may have been deleted since parking → null).
    const client =
      cart.clientId !== undefined
        ? await ctx.db.get("clients", cart.clientId)
        : null;
    await ctx.db.delete("heldCarts", args.heldCartId);
    return {
      client,
      items: cart.items,
      ...(cart.splits !== undefined ? { splits: cart.splits } : {}),
    };
  },
});

export const discard = mutation({
  args: {
    actorId: v.id("employees"),
    heldCartId: v.id("heldCarts"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cart = await ctx.db.get("heldCarts", args.heldCartId);
    if (cart) await ctx.db.delete("heldCarts", args.heldCartId);
    return null;
  },
});
