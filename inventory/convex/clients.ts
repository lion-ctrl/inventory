import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requirePerm } from "./permissions";
import {
  clientDocValidator,
  clientKindValidator,
  taxPrefixValidator,
} from "./schema";

export const list = query({
  args: {},
  returns: v.array(clientDocValidator),
  handler: async (ctx) => {
    return await ctx.db.query("clients").collect();
  },
});

export const byTaxId = query({
  args: {
    taxPrefix: taxPrefixValidator,
    taxId: v.string(),
  },
  returns: v.union(clientDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("clients")
      .withIndex("by_taxId", (q) =>
        q.eq("taxPrefix", args.taxPrefix).eq("taxId", args.taxId),
      )
      .first();
  },
});

// NO permission guard: used inline at the Venta gate by any logged-in cashier.
export const create = mutation({
  args: {
    name: v.string(),
    taxPrefix: taxPrefixValidator,
    taxId: v.string(),
    kind: clientKindValidator,
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
  },
  returns: clientDocValidator,
  handler: async (ctx, args) => {
    const clientId = await ctx.db.insert("clients", {
      name: args.name,
      taxPrefix: args.taxPrefix,
      taxId: args.taxId,
      kind: args.kind,
      // Omit empty-string contact fields entirely.
      ...(args.email ? { email: args.email } : {}),
      ...(args.phone ? { phone: args.phone } : {}),
      ...(args.address ? { address: args.address } : {}),
      createdAt: Date.now(),
    });
    const client = await ctx.db.get("clients", clientId);
    if (!client) throw new ConvexError("Cliente no encontrado.");
    return client;
  },
});

export const update = mutation({
  args: {
    actorId: v.id("employees"),
    clientId: v.id("clients"),
    patch: v.object({
      name: v.optional(v.string()),
      taxPrefix: v.optional(taxPrefixValidator),
      taxId: v.optional(v.string()),
      kind: v.optional(clientKindValidator),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, "manage_clients");
    const client = await ctx.db.get("clients", args.clientId);
    if (!client) throw new ConvexError("Cliente no encontrado.");
    // Empty-string contact fields clear the stored value (patch with
    // `undefined` removes the field).
    const { email, phone, address, ...rest } = args.patch;
    await ctx.db.patch("clients", args.clientId, {
      ...rest,
      ...(email !== undefined ? { email: email || undefined } : {}),
      ...(phone !== undefined ? { phone: phone || undefined } : {}),
      ...(address !== undefined ? { address: address || undefined } : {}),
    });
    return null;
  },
});

export const remove = mutation({
  args: {
    actorId: v.id("employees"),
    clientId: v.id("clients"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, "manage_clients");
    const client = await ctx.db.get("clients", args.clientId);
    if (client) await ctx.db.delete("clients", args.clientId);
    return null;
  },
});
