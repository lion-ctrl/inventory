import { ConvexError, v, type Infer } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { getSettings, requirePerm, requireSession, round2 } from './permissions';
import {
  clientSnapshotValidator,
  publicSaleDocValidator,
  saleDocValidator,
  saleItemValidator,
  splitItemValidator,
} from './schema';

export type SaleItemSnapshot = Infer<typeof saleItemValidator>;
export type ClientSnapshot = Infer<typeof clientSnapshotValidator>;

type CartLine = { productId: Id<'products'>; qty: number };

/** Freeze the allowed client fields into a snapshot (omit absent optionals). */
export function clientSnapshotOf(client: Doc<'clients'>): ClientSnapshot {
  return {
    name: client.name,
    taxPrefix: client.taxPrefix,
    taxId: client.taxId,
    kind: client.kind,
    ...(client.email !== undefined ? { email: client.email } : {}),
    ...(client.phone !== undefined ? { phone: client.phone } : {}),
    ...(client.address !== undefined ? { address: client.address } : {}),
  };
}

/**
 * Load LIVE products for the cart lines and build sale-item snapshots
 * (including the category LABEL and the exempt flag). Duplicate productIds
 * are merged so stock math can never double-apply. Shared by sales.checkout
 * and heldCarts.park.
 */
export async function snapshotLines(
  ctx: MutationCtx,
  rawLines: CartLine[],
  opts: { enforceSellable: boolean }
): Promise<
  Array<{ product: Doc<'products'>; qty: number; snapshot: SaleItemSnapshot }>
> {
  // Merge duplicate product lines (defensive; the cart UI already merges).
  const merged: CartLine[] = [];
  const at = new Map<string, number>();
  for (const line of rawLines) {
    const key = line.productId as string;
    const idx = at.get(key);
    if (idx === undefined) {
      at.set(key, merged.length);
      merged.push({ productId: line.productId, qty: line.qty });
    } else {
      merged[idx].qty += line.qty;
    }
  }

  const categoryLabels = new Map<Id<'categories'>, string>();
  const out: Array<{
    product: Doc<'products'>;
    qty: number;
    snapshot: SaleItemSnapshot;
  }> = [];

  for (const line of merged) {
    if (!(line.qty > 0)) {
      throw new ConvexError('Cantidad inválida en el carrito.');
    }
    const product = await ctx.db.get('products', line.productId);
    if (!product || (opts.enforceSellable && product.sellable === false)) {
      throw new ConvexError(
        'Producto no disponible: ' + (product?.name ?? line.productId)
      );
    }
    let cat = categoryLabels.get(product.categoryId);
    if (cat === undefined) {
      const category = await ctx.db.get('categories', product.categoryId);
      cat = category?.label ?? '';
      categoryLabels.set(product.categoryId, cat);
    }
    out.push({
      product,
      qty: line.qty,
      snapshot: {
        productId: product._id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        ...(cat !== '' ? { cat } : {}),
        price: product.price,
        qty: line.qty,
        ...(product.glyph !== undefined ? { glyph: product.glyph } : {}),
        ...(product.exempt === true ? { exempt: true } : {}),
      },
    });
  }
  return out;
}

export const checkout = mutation({
  args: {
    token: v.string(),
    clientId: v.id('clients'),
    items: v.array(v.object({ productId: v.id('products'), qty: v.number() })),
    method: v.string(),
    splits: v.array(splitItemValidator),
    tendered: v.optional(v.number()),
  },
  returns: saleDocValidator,
  handler: async (ctx, args) => {
    // 1. Any ACTIVE employee can sell — a valid session suffices, no specific
    //    permission required. requireSession rejects unknown/expired/inactive.
    const actor = await requireSession(ctx, args.token);

    // 2. Client + settings.
    const client = await ctx.db.get('clients', args.clientId);
    if (!client) throw new ConvexError('Cliente no encontrado.');
    const settings = await getSettings(ctx);

    if (args.items.length === 0) {
      throw new ConvexError('No hay productos en el carrito.');
    }

    // 3. Live products: availability + stock.
    const lines = await snapshotLines(ctx, args.items, {
      enforceSellable: true,
    });
    // 3b. Reserved ("en espera") backstop: units held in OTHER parked carts are
    // not sellable here. Available = physical − reserved. Checkout only — park
    // must not be blocked by holds (a cart being parked can't reserve against
    // itself, and a sale RESUMED from a held cart already deleted its row).
    const heldCarts = await ctx.db.query('heldCarts').collect();
    const reservedByProduct = new Map<string, number>();
    for (const held of heldCarts) {
      for (const it of held.items) {
        reservedByProduct.set(
          it.productId,
          (reservedByProduct.get(it.productId) ?? 0) + it.qty
        );
      }
    }
    for (const { product, qty } of lines) {
      const reserved = reservedByProduct.get(product._id) ?? 0;
      if (qty + reserved > product.stock) {
        if (reserved > 0 && qty <= product.stock) {
          throw new ConvexError(
            `No hay suficiente stock disponible para "${product.name}": hay ${reserved} en espera.`
          );
        }
        throw new ConvexError(
          `Stock insuficiente: ${product.name}. Quedan ${product.stock} unidades.`
        );
      }
    }

    // 4. Totals from LIVE prices — never trust the client.
    let subtotalRaw = 0;
    let exemptRaw = 0;
    for (const { product, qty } of lines) {
      const lineTotal = product.price * qty;
      subtotalRaw += lineTotal;
      if (product.exempt === true) exemptRaw += lineTotal;
    }
    const subtotal = round2(subtotalRaw);
    const exemptBase = round2(exemptRaw);
    // Every sale is an invoice: IVA always applies to the taxable base.
    const tax = round2(((subtotal - exemptBase) * settings.ivaPct) / 100);
    const total = round2(subtotal + tax);

    // 5. Splits must cover the server-computed total (tolerance 0.011).
    const paid = args.splits.reduce((sum, row) => sum + row.amount, 0);
    if (total - paid > 0.011) {
      throw new ConvexError('El pago no cubre el total. Verifica los montos.');
    }

    // 6. Atomically consume the invoice counter.
    const invoiceNumber = String(settings.nextInvoiceNumber).padStart(8, '0');
    await ctx.db.patch('settings', settings._id, {
      nextInvoiceNumber: settings.nextInvoiceNumber + 1,
    });

    // 7. Decrement stocks.
    for (const { product, qty } of lines) {
      await ctx.db.patch('products', product._id, {
        stock: product.stock - qty,
      });
    }

    // 8. Insert the sale with frozen snapshots.
    const saleId = await ctx.db.insert('sales', {
      invoiceNumber,
      clientId: args.clientId,
      client: clientSnapshotOf(client),
      cashierId: actor._id,
      cashierName: actor.name,
      items: lines.map((l) => l.snapshot),
      subtotal,
      tax,
      total,
      method: args.method,
      splits: args.splits,
      ...(args.tendered !== undefined ? { tendered: args.tendered } : {}),
      ivaPct: settings.ivaPct,
      exchangeRate: settings.bsRate,
      soldAt: Date.now(),
    });

    // 9. Return the full inserted sale doc.
    const sale = await ctx.db.get('sales', saleId);
    if (!sale) throw new ConvexError('Venta no encontrada.');
    return sale;
  },
});

export const history = query({
  // Gated read: a valid session is required, and the stored cashierId is NOT
  // returned (the cashierName snapshot is enough for display). AUTH-2.
  args: { token: v.string() },
  returns: v.array(publicSaleDocValidator),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
    const sales = await ctx.db
      .query('sales')
      .withIndex('by_soldAt')
      .order('desc')
      .collect();
    return sales.map(({ cashierId: _cashierId, ...rest }) => rest);
  },
});

export const refund = mutation({
  args: {
    token: v.string(),
    saleId: v.id('sales'),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'void_sales');
    const sale = await ctx.db.get('sales', args.saleId);
    if (!sale) throw new ConvexError('Venta no encontrada.');
    if (sale.refund) {
      throw new ConvexError('Esta venta ya fue reembolsada.');
    }
    // Restore stock for products that still exist (deleted ones are skipped).
    for (const item of sale.items) {
      const product = await ctx.db.get('products', item.productId);
      if (product) {
        await ctx.db.patch('products', product._id, {
          stock: product.stock + item.qty,
        });
      }
    }
    await ctx.db.patch('sales', args.saleId, {
      refund: { date: Date.now(), reason: args.reason },
    });
    return null;
  },
});
