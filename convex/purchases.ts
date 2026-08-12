import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import {
  getSettings,
  requirePerm,
  requireSession,
  round2,
} from './permissions';
import {
  publicPurchaseDocValidator,
  purchaseCurrencyValidator,
} from './schema';

// A purchase placed with a supplier. It is the ONLY write in the app
// that raises stock, so the mutations below are the inverse pair of a sale:
// create adds the received units, remove puts them back.
//
// Deliberately NOT modelled: per-unit cost. The owner records one global amount
// for the whole order, so there is no cost of goods and no per-product margin.
// Adding it later means adding a `unitCost` to purchaseItemValidator — the shape
// here leaves room for that without moving anything else.

/** Most recent orders shown per supplier; see the note in `bySupplier`. */
const PURCHASES_PER_SUPPLIER = 200;

export const bySupplier = query({
  // Operational read: any valid session may look at a supplier's order history.
  args: { token: v.string(), supplierId: v.id('suppliers') },
  returns: v.array(publicPurchaseDocValidator),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
    // Newest first, and BOUNDED: `purchases` is append-only like `sales`, so a
    // long-standing supplier would otherwise grow this live query without limit.
    // The detail sheet shows a running history, not an audit ledger. `by_supplier`
    // carries `createdAt`, so the index itself orders — no post-sort needed.
    const purchases = await ctx.db
      .query('purchases')
      .withIndex('by_supplier', (q) => q.eq('supplierId', args.supplierId))
      .order('desc')
      .take(PURCHASES_PER_SUPPLIER);
    return purchases.map(({ createdBy: _createdBy, ...rest }) => rest);
  },
});

/** Positive, finite money/quantity. Rejects NaN and Infinity, which would poison stock. */
const isPositiveNumber = (n: number) => Number.isFinite(n) && n > 0;

/**
 * Sanity ceiling on a single order, in USD. Not a security control — a fat-
 * fingered extra three zeros is a real, frequent mistake when the owner types
 * the amount by hand, and it would silently distort every spending figure.
 */
const MAX_PURCHASE_TOTAL_USD = 1_000_000;

/** Distinct products a single order may carry. */
const MAX_PURCHASE_LINES = 200;

export const create = mutation({
  args: {
    token: v.string(),
    supplierId: v.id('suppliers'),
    items: v.array(v.object({ productId: v.id('products'), qty: v.number() })),
    /** The amount as TYPED, in `currency`. The USD total is derived server-side. */
    entered: v.number(),
    currency: purchaseCurrencyValidator,
    note: v.optional(v.string()),
  },
  returns: publicPurchaseDocValidator,
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_suppliers');
    // Captured once, before the awaits below, so the row is stamped with the
    // moment the operation began — the same shape seedBase and checkout use.
    const now = Date.now();

    if (args.items.length === 0) {
      throw new ConvexError('La compra no tiene productos.');
    }
    // Bounded so an oversized array fails as a Spanish ConvexError rather than
    // hitting Convex's mutation limits with a system error.
    if (args.items.length > MAX_PURCHASE_LINES) {
      throw new ConvexError(
        `Una compra admite hasta ${MAX_PURCHASE_LINES} productos.`
      );
    }
    if (!args.items.every((i) => isPositiveNumber(i.qty))) {
      throw new ConvexError('Las cantidades deben ser mayores a cero.');
    }
    if (!isPositiveNumber(args.entered)) {
      throw new ConvexError('El monto debe ser mayor a cero.');
    }

    const supplier = await ctx.db.get('suppliers', args.supplierId);
    if (!supplier) throw new ConvexError('Proveedor no encontrado.');

    // The rate is read ONCE here and stored with the purchase. Deriving the USD
    // total server-side also means a client can never send a total that does not
    // match what was typed.
    const settings = await getSettings(ctx);
    const exchangeRate = settings.bsRate;
    if (args.currency === 'bs' && !isPositiveNumber(exchangeRate)) {
      throw new ConvexError(
        'No hay tasa de cambio configurada. Registra el monto en dólares.'
      );
    }
    const total =
      args.currency === 'bs'
        ? round2(args.entered / exchangeRate)
        : round2(args.entered);
    // Checked AFTER conversion so a Bs amount is judged by what it really costs.
    if (total > MAX_PURCHASE_TOTAL_USD) {
      throw new ConvexError(
        'El monto de la compra es demasiado alto. Verifica la cifra.'
      );
    }

    // Merge duplicate product lines BEFORE reading stock (defensive; the form
    // already merges). Each line snapshots the pre-patch stock, so two lines for
    // the same product would make the second patch overwrite the first —
    // 10+5=15, then 10+3=13 instead of 18, and the units vanish with no trace.
    // `snapshotLines` in sales.ts guards the sale side the same way.
    const merged = new Map<string, number>();
    for (const item of args.items) {
      merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.qty);
    }

    // Resolve every product BEFORE touching stock: one missing product aborts the
    // whole order rather than leaving a half-received purchase behind.
    const lines = [];
    for (const [productId, qty] of merged) {
      const product = await ctx.db.get('products', productId as Id<'products'>);
      if (!product) throw new ConvexError('Producto no encontrado.');
      lines.push({ product, qty });
    }

    for (const line of lines) {
      await ctx.db.patch('products', line.product._id, {
        stock: line.product.stock + line.qty,
      });
    }

    const purchaseId = await ctx.db.insert('purchases', {
      supplierId: supplier._id,
      supplierName: supplier.name,
      items: lines.map((l) => ({
        productId: l.product._id,
        name: l.product.name,
        qty: l.qty,
      })),
      total,
      entered: args.entered,
      currency: args.currency,
      exchangeRate,
      ...(args.note ? { note: args.note } : {}),
      createdBy: employee._id,
      createdByName: employee.name,
      createdAt: now,
    });
    const purchase = await ctx.db.get('purchases', purchaseId);
    if (!purchase) throw new ConvexError('Compra no encontrada.');
    const { createdBy: _createdBy, ...pub } = purchase; // AUTH-2
    return pub;
  },
});

export const remove = mutation({
  args: { token: v.string(), purchaseId: v.id('purchases') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_suppliers');

    const purchase = await ctx.db.get('purchases', args.purchaseId);
    if (!purchase) return null; // already gone — silent no-op, like discard

    // Give the units back. Clamped at zero: the received stock may already have
    // been sold, and negative stock would break every sellable check downstream.
    for (const item of purchase.items) {
      const product = await ctx.db.get('products', item.productId);
      if (!product) continue; // product deleted since — nothing to give back
      await ctx.db.patch('products', product._id, {
        stock: Math.max(0, product.stock - item.qty),
      });
    }

    await ctx.db.delete('purchases', args.purchaseId);
    return null;
  },
});
