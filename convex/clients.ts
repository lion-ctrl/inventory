import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requirePerm, requireSession } from './permissions';
import {
  clientDocValidator,
  clientKindValidator,
  taxPrefixValidator,
} from './schema';

export const list = query({
  args: {},
  returns: v.array(clientDocValidator),
  handler: async (ctx) => {
    return await ctx.db.query('clients').collect();
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
      .query('clients')
      .withIndex('by_taxId', (q) =>
        q.eq('taxPrefix', args.taxPrefix).eq('taxId', args.taxId)
      )
      .first();
  },
});

// AUTH-2 (revised): create is SESSION-ONLY. Creating a client is part of MAKING
// A SALE — the Venta client-gate lets a cashier register a walk-in mid-checkout —
// so ANY employee with a valid session may add one; it must not require
// management rights. A valid session is still mandatory: the token is verified
// and the acting employee resolved server-side (never a client-supplied id).
// Editing the client base IS management, so update/remove below stay behind
// manage_clients.
export const create = mutation({
  args: {
    token: v.string(),
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
    // Session required (verifies the token + touches the acting employee); no
    // permission gate — see the contract note above.
    await requireSession(ctx, args.token);
    const clientId = await ctx.db.insert('clients', {
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
    const client = await ctx.db.get('clients', clientId);
    if (!client) throw new ConvexError('Cliente no encontrado.');
    return client;
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    clientId: v.id('clients'),
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
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_clients');
    const client = await ctx.db.get('clients', args.clientId);
    if (!client) throw new ConvexError('Cliente no encontrado.');
    // Empty-string contact fields clear the stored value (patch with
    // `undefined` removes the field).
    const { email, phone, address, ...rest } = args.patch;
    await ctx.db.patch('clients', args.clientId, {
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
    token: v.string(),
    clientId: v.id('clients'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_clients');
    const client = await ctx.db.get('clients', args.clientId);
    if (client) await ctx.db.delete('clients', args.clientId);
    return null;
  },
});
