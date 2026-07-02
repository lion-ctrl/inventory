import { ConvexError, v, type Infer } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import {
  getSettings,
  requirePerm,
  requireSession,
  round2,
} from './permissions';
import {
  clientSnapshotValidator,
  publicSaleDocValidator,
  saleDocValidator,
  saleItemValidator,
  splitItemValidator,
} from './schema';

export type SaleItemSnapshot = Infer<typeof saleItemValidator>;
export type ClientSnapshot = Infer<typeof clientSnapshotValidator>;
export type SplitItem = Infer<typeof splitItemValidator>;

type CartLine = { productId: Id<'products'>; qty: number };

/** A snapshotted sale line: the LIVE product, its qty, and the frozen snapshot. */
type SaleLine = {
  product: Doc<'products'>;
  qty: number;
  snapshot: SaleItemSnapshot;
};

// ---------------------------------------------------------------------------
// Structured conflict codes (FEATURES §15). `sales.syncOffline` throws
// `ConvexError({ code })` so the 6.4 sync engine can map a rejected offline sale
// to a `conflict` status (instead of retrying a doomed op forever). `checkout`
// keeps its human-readable Spanish messages — the shared helpers below let each
// caller shape its own error while the sale-building logic stays single-sourced.
// ---------------------------------------------------------------------------

export type SaleConflictCode =
  | 'STOCK_INSUFFICIENT'
  | 'PRODUCT_DELETED'
  | 'PRODUCT_DISABLED'
  | 'PRICE_CHANGED'
  | 'TAX_CHANGED'
  | 'CUSTOMER_NOT_FOUND'
  | 'DUPLICATE_OPERATION'
  | 'AUTH_EXPIRED'
  | 'PERMISSION_DENIED';

/**
 * Throw a structured conflict. `detail` carries machine-readable context (ids,
 * quantities) for the client — never a user-facing string (the 6.4 engine
 * renders the message from the code). Returns `never` so call sites can rely on
 * TypeScript control-flow narrowing after invoking it.
 */
function saleConflict(
  code: SaleConflictCode,
  detail: Record<string, string | number> = {}
): never {
  throw new ConvexError({ code, ...detail });
}

/**
 * Error policy for `snapshotLines` product validation. `checkout` / `heldCarts`
 * use the default (Spanish messages); `syncOffline` swaps in structured codes.
 * Methods return `never` — they always throw.
 */
export interface ProductLinePolicy {
  missing: (productId: Id<'products'>) => never;
  disabled: (product: Doc<'products'>) => never;
}

/** Default policy: the exact Spanish messages `checkout`/`park` threw before. */
const defaultLinePolicy: ProductLinePolicy = {
  missing: (productId) => {
    throw new ConvexError('Producto no disponible: ' + productId);
  },
  disabled: (product) => {
    throw new ConvexError('Producto no disponible: ' + product.name);
  },
};

/** Offline-sync policy: structured §15 codes so the client maps them → conflict. */
const syncLinePolicy: ProductLinePolicy = {
  missing: (productId) => saleConflict('PRODUCT_DELETED', { productId }),
  disabled: (product) =>
    saleConflict('PRODUCT_DISABLED', { productId: product._id }),
};

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
 * are merged so stock math can never double-apply. Shared by sales.checkout,
 * sales.syncOffline and heldCarts.park.
 *
 * The `policy` decides how a missing / disabled product is reported: the default
 * throws Spanish messages (checkout/park); `syncOffline` passes `syncLinePolicy`
 * to get structured §15 codes. The read + merge + snapshot logic is identical
 * across callers so it can never drift.
 */
export async function snapshotLines(
  ctx: MutationCtx,
  rawLines: CartLine[],
  opts: { enforceSellable: boolean },
  policy: ProductLinePolicy = defaultLinePolicy
): Promise<SaleLine[]> {
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
  const out: SaleLine[] = [];

  for (const line of merged) {
    if (!(line.qty > 0)) {
      throw new ConvexError('Cantidad inválida en el carrito.');
    }
    const product = await ctx.db.get('products', line.productId);
    // `return <never>` narrows `product` to non-null below; the policy throws.
    if (!product) return policy.missing(line.productId);
    if (opts.enforceSellable && product.sellable === false) {
      return policy.disabled(product);
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

// ---------------------------------------------------------------------------
// Shared sale-building helpers (single-sourced across checkout + syncOffline so
// the money path can never drift). Each caller supplies only what genuinely
// differs: the stock-error shape, `soldAt`, and the offline metadata.
// ---------------------------------------------------------------------------

/** Sum units reserved ("en espera") across parked carts, keyed by productId. */
async function reservedByProductMap(
  ctx: MutationCtx
): Promise<Map<string, number>> {
  const heldCarts = await ctx.db.query('heldCarts').collect();
  const reserved = new Map<string, number>();
  for (const held of heldCarts) {
    for (const it of held.items) {
      reserved.set(it.productId, (reserved.get(it.productId) ?? 0) + it.qty);
    }
  }
  return reserved;
}

/**
 * Reserved-backstop stock check: a line is sellable only up to
 * physical stock − units held in OTHER parked carts. `onInsufficient` shapes the
 * error (plain message for checkout, structured code for syncOffline) and must
 * throw (its return type is `never`).
 */
function assertStockAvailable(
  lines: SaleLine[],
  reservedMap: Map<string, number>,
  onInsufficient: (info: {
    product: Doc<'products'>;
    qty: number;
    reserved: number;
  }) => never
): void {
  for (const { product, qty } of lines) {
    const reserved = reservedMap.get(product._id) ?? 0;
    if (qty + reserved > product.stock) {
      onInsufficient({ product, qty, reserved });
    }
  }
}

/** Money math from LIVE product prices — never trust client-sent totals. */
function computeSaleTotals(
  lines: SaleLine[],
  ivaPct: number
): { subtotal: number; tax: number; total: number } {
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
  const tax = round2(((subtotal - exemptBase) * ivaPct) / 100);
  const total = round2(subtotal + tax);
  return { subtotal, tax, total };
}

/**
 * Consume the invoice counter, decrement stock, insert the sale (with frozen
 * snapshots) and return the stored doc. `offline` — set only by `syncOffline` —
 * stamps the sale with its `idempotencyKey` + `deviceId`; when omitted the
 * insert is byte-for-byte what `checkout` produced before this refactor.
 */
async function persistSale(
  ctx: MutationCtx,
  params: {
    settings: Doc<'settings'>;
    client: Doc<'clients'>;
    clientId: Id<'clients'>;
    actor: Doc<'employees'>;
    lines: SaleLine[];
    totals: { subtotal: number; tax: number; total: number };
    method: string;
    splits: SplitItem[];
    tendered?: number;
    soldAt: number;
    offline?: { idempotencyKey: string; deviceId: string };
  }
): Promise<Doc<'sales'>> {
  // Atomically consume the invoice counter.
  const invoiceNumber = String(params.settings.nextInvoiceNumber).padStart(
    8,
    '0'
  );
  await ctx.db.patch('settings', params.settings._id, {
    nextInvoiceNumber: params.settings.nextInvoiceNumber + 1,
  });

  // Decrement stocks.
  for (const { product, qty } of params.lines) {
    await ctx.db.patch('products', product._id, {
      stock: product.stock - qty,
    });
  }

  // Insert the sale with frozen snapshots.
  const saleId = await ctx.db.insert('sales', {
    invoiceNumber,
    clientId: params.clientId,
    client: clientSnapshotOf(params.client),
    cashierId: params.actor._id,
    cashierName: params.actor.name,
    items: params.lines.map((l) => l.snapshot),
    subtotal: params.totals.subtotal,
    tax: params.totals.tax,
    total: params.totals.total,
    method: params.method,
    splits: params.splits,
    ...(params.tendered !== undefined ? { tendered: params.tendered } : {}),
    ivaPct: params.settings.ivaPct,
    exchangeRate: params.settings.bsRate,
    soldAt: params.soldAt,
    ...(params.offline !== undefined
      ? {
          idempotencyKey: params.offline.idempotencyKey,
          deviceId: params.offline.deviceId,
        }
      : {}),
  });

  const sale = await ctx.db.get('sales', saleId);
  if (!sale) throw new ConvexError('Venta no encontrada.');
  return sale;
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
    const reservedMap = await reservedByProductMap(ctx);
    assertStockAvailable(lines, reservedMap, ({ product, qty, reserved }) => {
      if (reserved > 0 && qty <= product.stock) {
        throw new ConvexError(
          `No hay suficiente stock disponible para "${product.name}": hay ${reserved} en espera.`
        );
      }
      throw new ConvexError(
        `Stock insuficiente: ${product.name}. Quedan ${product.stock} unidades.`
      );
    });

    // 4. Totals from LIVE prices — never trust the client.
    const totals = computeSaleTotals(lines, settings.ivaPct);

    // 5. Splits must cover the server-computed total (tolerance 0.011).
    const paid = args.splits.reduce((sum, row) => sum + row.amount, 0);
    if (totals.total - paid > 0.011) {
      throw new ConvexError('El pago no cubre el total. Verifica los montos.');
    }

    // 6-9. Consume invoice #, decrement stock, insert + return the sale doc.
    return await persistSale(ctx, {
      settings,
      client,
      clientId: args.clientId,
      actor,
      lines,
      totals,
      method: args.method,
      splits: args.splits,
      tendered: args.tendered,
      soldAt: Date.now(),
    });
  },
});

/**
 * Idempotent sibling of `checkout` for draining offline sales (FEATURES §8-10).
 * `checkout` is NOT safe to retry — it consumes the invoice counter, decrements
 * stock and inserts, so a re-sent offline sale would double-charge. `syncOffline`
 * replays safely: the SAME `idempotencyKey` returns the SAME sale, never a
 * duplicate. It re-validates every product on the SERVER (stock is only a
 * snapshot offline, §10) and throws structured §15 codes on conflict so the 6.4
 * sync engine can mark the op `conflict` instead of retrying forever.
 *
 * Shares `snapshotLines` + the reserved backstop + the money math + the insert
 * with `checkout` (via the helpers above) so the two paths cannot drift.
 */
export const syncOffline = mutation({
  args: {
    token: v.string(),
    idempotencyKey: v.string(),
    deviceId: v.string(),
    clientId: v.id('clients'),
    items: v.array(v.object({ productId: v.id('products'), qty: v.number() })),
    method: v.string(),
    splits: v.array(splitItemValidator),
    tendered: v.optional(v.number()),
    soldAt: v.number(),
  },
  returns: saleDocValidator,
  handler: async (ctx, args) => {
    // 1. Any ACTIVE employee may sync — a valid session suffices.
    const actor = await requireSession(ctx, args.token);

    // 2. Idempotency (§8-9): a replay of the SAME key returns the existing sale
    //    — never a duplicate. This is what makes the sync engine's retries,
    //    reloads and mid-sync crashes safe.
    const existing = await ctx.db
      .query('sales')
      .withIndex('by_idempotencyKey', (q) =>
        q.eq('idempotencyKey', args.idempotencyKey)
      )
      .unique();
    if (existing) return existing;

    // 3. The client must still exist server-side. The sync engine remaps a
    //    local id → real id BEFORE calling this (6.2.1), so `clientId` is a real
    //    Id here; a gone client is a structured conflict, not a plain 404.
    const client = await ctx.db.get('clients', args.clientId);
    if (!client)
      saleConflict('CUSTOMER_NOT_FOUND', { clientId: args.clientId });
    const settings = await getSettings(ctx);

    if (args.items.length === 0) {
      throw new ConvexError('No hay productos en el carrito.');
    }

    // 4. Re-validate every product on the SERVER (§10): missing → PRODUCT_DELETED,
    //    paused → PRODUCT_DISABLED (structured §15 codes via `syncLinePolicy`).
    const lines = await snapshotLines(
      ctx,
      args.items,
      { enforceSellable: false },
      syncLinePolicy
    );

    // 4b. Physical-stock re-validation (§10). A CONSUMMATED offline sale outranks
    //     pending reservations: validate against physical stock ONLY (empty
    //     reserved map), so a real, already-charged sale is never rejected by a
    //     not-yet-confirmed parked cart. A hold that loses its stock is
    //     reconciled when it is RESUMED, not here. (checkout keeps the backstop —
    //     there both sides are live and neither has been charged yet.)
    assertStockAvailable(lines, new Map(), ({ product }) =>
      saleConflict('STOCK_INSUFFICIENT', {
        productId: product._id,
        available: product.stock,
      })
    );

    // 5. Money math from LIVE server prices (SHARED with checkout).
    const totals = computeSaleTotals(lines, settings.ivaPct);

    // 6. Consume invoice #, decrement stock, insert — stamping the offline
    //    metadata (idempotencyKey + deviceId, §19-20) that makes replays safe.
    return await persistSale(ctx, {
      settings,
      client,
      clientId: args.clientId,
      actor,
      lines,
      totals,
      method: args.method,
      splits: args.splits,
      tendered: args.tendered,
      soldAt: args.soldAt,
      offline: { idempotencyKey: args.idempotencyKey, deviceId: args.deviceId },
    });
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
