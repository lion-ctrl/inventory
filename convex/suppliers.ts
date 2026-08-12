import { ConvexError, v } from 'convex/values';
import type { Infer } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requirePerm, requireSession } from './permissions';
import { supplierDocValidator, taxPrefixValidator } from './schema';

type TaxPrefix = Infer<typeof taxPrefixValidator>;

const NAME_REQUIRED = 'El nombre del proveedor es obligatorio.';
const RIF_REQUIRED = 'El RIF del proveedor es obligatorio.';

/**
 * Trimmed and non-empty, or a Spanish error naming the field. `name` and `taxId`
 * are REQUIRED on the row, so a blank one would be schema-valid and unusable —
 * and a blank RIF would reach the duplicate guard, whose message would blame a
 * collision that is not the real problem.
 */
function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ConvexError(message);
  return trimmed;
}

// Internal POS — no public endpoints.
//
// The read/write split mirrors `clients`: reading the supplier base is
// OPERATIONAL (the product form and the expense form both need to pick one), so
// a valid session is enough. Editing the base is MANAGEMENT, behind
// manage_suppliers.
export const list = query({
  args: { token: v.string() },
  returns: v.array(supplierDocValidator),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
    // Unbounded ON PURPOSE, unlike `purchases.bySupplier` in the same change:
    // this table is MIRRORED into Dexie for offline reads, so the client needs
    // every row — a capped read would silently hide suppliers while offline.
    // Suppliers are bounded by the business (a store has dozens), not
    // append-only like `sales` and `purchases`.
    return await ctx.db.query('suppliers').collect();
  },
});

/**
 * The RIF identifies the company, so a duplicate is almost always the same
 * supplier entered twice — which would split its expense history in two.
 * Resolved through `by_taxId`, never a table scan. `exceptId` lets an update
 * keep its own RIF.
 */
async function assertRifIsFree(
  ctx: MutationCtx,
  taxPrefix: TaxPrefix,
  taxId: string,
  exceptId?: Id<'suppliers'>
): Promise<void> {
  const existing = await ctx.db
    .query('suppliers')
    .withIndex('by_taxId', (q) =>
      q.eq('taxPrefix', taxPrefix).eq('taxId', taxId)
    )
    .first();
  if (existing && existing._id !== exceptId) {
    throw new ConvexError('Ya existe un proveedor con ese RIF.');
  }
}

export const create = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    taxPrefix: taxPrefixValidator,
    taxId: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    mobile: v.optional(v.string()),
    address: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    website: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: supplierDocValidator,
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_suppliers');
    const name = requireText(args.name, NAME_REQUIRED);
    const taxId = requireText(args.taxId, RIF_REQUIRED);
    await assertRifIsFree(ctx, args.taxPrefix, taxId);

    const supplierId = await ctx.db.insert('suppliers', {
      name,
      taxPrefix: args.taxPrefix,
      taxId,
      // Omit empty-string optional fields entirely (same contract as clients).
      ...(args.contactName ? { contactName: args.contactName } : {}),
      ...(args.email ? { email: args.email } : {}),
      ...(args.phone ? { phone: args.phone } : {}),
      ...(args.mobile ? { mobile: args.mobile } : {}),
      ...(args.address ? { address: args.address } : {}),
      ...(args.paymentTerms ? { paymentTerms: args.paymentTerms } : {}),
      ...(args.website ? { website: args.website } : {}),
      ...(args.notes ? { notes: args.notes } : {}),
      // Usable the moment it exists; retiring is an explicit act.
      active: true,
      createdAt: Date.now(),
    });
    const supplier = await ctx.db.get('suppliers', supplierId);
    if (!supplier) throw new ConvexError('Proveedor no encontrado.');
    return supplier;
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    supplierId: v.id('suppliers'),
    patch: v.object({
      name: v.optional(v.string()),
      taxPrefix: v.optional(taxPrefixValidator),
      taxId: v.optional(v.string()),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      mobile: v.optional(v.string()),
      address: v.optional(v.string()),
      paymentTerms: v.optional(v.string()),
      website: v.optional(v.string()),
      notes: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_suppliers');
    const supplier = await ctx.db.get('suppliers', args.supplierId);
    if (!supplier) throw new ConvexError('Proveedor no encontrado.');

    // `name` and `taxId` are REQUIRED on the row, so unlike the optional fields
    // below a blank one is rejected instead of stored — patching `name: ''`
    // would leave a schema-valid supplier with no name.
    const name =
      args.patch.name !== undefined
        ? requireText(args.patch.name, NAME_REQUIRED)
        : undefined;
    const taxId =
      args.patch.taxId !== undefined
        ? requireText(args.patch.taxId, RIF_REQUIRED)
        : undefined;

    // Re-check the RIF only when the patch actually moves it.
    const nextPrefix = args.patch.taxPrefix ?? supplier.taxPrefix;
    const nextTaxId = taxId ?? supplier.taxId;
    if (nextPrefix !== supplier.taxPrefix || nextTaxId !== supplier.taxId) {
      await assertRifIsFree(ctx, nextPrefix, nextTaxId, args.supplierId);
    }

    // An empty string CLEARS an optional field (patching `undefined` removes it);
    // a field absent from the patch is left untouched.
    const {
      name: _name,
      taxId: _taxId,
      contactName,
      email,
      phone,
      mobile,
      address,
      paymentTerms,
      website,
      notes,
      ...rest
    } = args.patch;
    await ctx.db.patch('suppliers', args.supplierId, {
      ...rest,
      ...(name !== undefined ? { name } : {}),
      ...(taxId !== undefined ? { taxId } : {}),
      ...(contactName !== undefined
        ? { contactName: contactName || undefined }
        : {}),
      ...(email !== undefined ? { email: email || undefined } : {}),
      ...(phone !== undefined ? { phone: phone || undefined } : {}),
      ...(mobile !== undefined ? { mobile: mobile || undefined } : {}),
      ...(address !== undefined ? { address: address || undefined } : {}),
      ...(paymentTerms !== undefined
        ? { paymentTerms: paymentTerms || undefined }
        : {}),
      ...(website !== undefined ? { website: website || undefined } : {}),
      ...(notes !== undefined ? { notes: notes || undefined } : {}),
    });
    return null;
  },
});

export const remove = mutation({
  args: {
    token: v.string(),
    supplierId: v.id('suppliers'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_suppliers');
    const supplier = await ctx.db.get('suppliers', args.supplierId);
    if (!supplier) return null; // already gone — silent no-op

    // Purchases store `supplierId`, and each one already raised stock. Deleting
    // the supplier would orphan those orders and make `bySupplier` unreachable,
    // contradicting the contract written on `supplierFields`: a supplier that is
    // no longer used is RETIRED (active: false), never deleted. Resolved through
    // the index, first hit only — this is a guard, not a count.
    const anyPurchase = await ctx.db
      .query('purchases')
      .withIndex('by_supplier', (q) => q.eq('supplierId', args.supplierId))
      .first();
    if (anyPurchase) {
      throw new ConvexError(
        'No puedes eliminar un proveedor con compras registradas. Márcalo como inactivo.'
      );
    }

    await ctx.db.delete('suppliers', args.supplierId);
    return null;
  },
});
