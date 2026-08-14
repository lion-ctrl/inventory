import { ConvexError, v } from 'convex/values';
import type { Infer } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requirePerm, requireSession } from './permissions';
import { productDocValidator, productWithImageValidator } from './schema';
import { nextFreeSku, SKU_COLLISION_LIMIT, skuFromName } from './sku';

/** A product as `list` returns it: the document plus its resolved photo address. */
type ProductWithImage = Infer<typeof productWithImageValidator>;

/**
 * Domain guards for the product's numbers, applied at EVERY entry point.
 * `adjustStock` refused negative stock long before this existed, but `create` and
 * `update` let the same value in through the side door — and a rule enforced in
 * one function is not a rule. A negative price is worse than a negative stock: it
 * flows into sale subtotals and totals, which nothing downstream re-checks.
 * `Number.isFinite` also rejects NaN and Infinity.
 */
function assertProductNumbers(fields: {
  price?: number;
  stock?: number;
  minStock?: number;
}): void {
  const nonNegative = (n: number | undefined) =>
    n === undefined || (Number.isFinite(n) && n >= 0);
  if (!nonNegative(fields.price)) {
    throw new ConvexError('El precio no puede ser negativo.');
  }
  if (!nonNegative(fields.stock)) {
    throw new ConvexError('El stock no puede ser negativo.');
  }
  if (!nonNegative(fields.minStock)) {
    throw new ConvexError('El stock mínimo no puede ser negativo.');
  }
}

/**
 * A barcode identifies exactly one product. The scanner resolves it through
 * `by_barcode` with `.first()`, so two products sharing a code would make it
 * return one of them silently, with no way to tell which — the index exists for
 * this lookup and is used here as the guard. `exceptId` lets a product keep its
 * own code while other fields change.
 */
async function assertBarcodeIsFree(
  ctx: MutationCtx,
  barcode: string,
  exceptId?: Id<'products'>
): Promise<void> {
  // TWO rows, not one. `.first()` answers for a single document, so a catalogue
  // that already holds a duplicate — from before this guard existed — could hand
  // back the very row being excluded and read as free. Today the caller happens
  // to skip the check when the code is unchanged, which hides that; a guard that
  // is correct because of what its caller remembers is not a guard.
  const holders = await ctx.db
    .query('products')
    .withIndex('by_barcode', (q) => q.eq('barcode', barcode))
    .take(2);
  if (holders.some((p) => p._id !== exceptId)) {
    throw new ConvexError('Ya existe un producto con ese código de barras.');
  }
}

/**
 * A reference validator checks the SHAPE of an id, never that the document is
 * still there. A product pointing at a deleted category renders with an empty
 * label and no error — a dangling reference that leaves no trace, which is the
 * opposite of how this project already treats these links: `suppliers.remove`
 * refuses to delete a supplier a product still names.
 */
async function assertReferencesExist(
  ctx: MutationCtx,
  refs: {
    categoryId?: Id<'categories'>;
    supplierId?: Id<'suppliers'> | null;
  }
): Promise<void> {
  if (refs.categoryId && !(await ctx.db.get('categories', refs.categoryId))) {
    throw new ConvexError('Categoría no encontrada.');
  }
  // `null` is the CLEAR case and never points anywhere, so it needs no lookup.
  if (refs.supplierId && !(await ctx.db.get('suppliers', refs.supplierId))) {
    throw new ConvexError('Proveedor no encontrado.');
  }
}

// Internal POS — no public endpoints. The catalog is an operational read every
// cashier needs (Venta/Escanear), so it is gated by requireSession only — a
// valid session suffices, never a management permission.
export const list = query({
  args: { token: v.string() },
  returns: v.array(productWithImageValidator),
  // Annotated: the client's type is INFERRED from the handler, and the two
  // branches below return different shapes (a product with no photo carries no
  // imageUrl). Without this the inferred type is a union and consumers cannot
  // read the optional field at all — the same trap `heldCarts.list` hit.
  handler: async (ctx, args): Promise<ProductWithImage[]> => {
    await requireSession(ctx, args.token);
    const products = await ctx.db.query('products').collect();
    // Resolve each photo HERE rather than letting every screen ask per product:
    // the same total work, in one round-trip instead of N. Only photographed
    // products cost an extra lookup; the rest fall through untouched.
    return await Promise.all(
      products.map(async (product) => {
        if (!product.imageId) return product;
        const imageUrl = await ctx.storage.getUrl(product.imageId);
        return imageUrl ? { ...product, imageUrl } : product;
      })
    );
  },
});

/**
 * Mint a one-shot upload address. The binary NEVER travels through a mutation:
 * the client PUTs the file here, gets a storage id back, and saves that id with
 * the product like any other field.
 */
export const generateUploadUrl = mutation({
  args: { token: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_products');
    return await ctx.storage.generateUploadUrl();
  },
});

// Scanner lookup by barcode — operational read, session-gated (any active
// employee), no management permission required.
export const byBarcode = query({
  args: { token: v.string(), barcode: v.string() },
  returns: v.union(productDocValidator, v.null()),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
    return await ctx.db
      .query('products')
      .withIndex('by_barcode', (q) => q.eq('barcode', args.barcode))
      .first();
  },
});

/**
 * Exclusive upper bound of a string PREFIX range: the highest code unit, so
 * `[base, base + PREFIX_END)` covers every code that starts with `base`. Written
 * as a named constant because the character itself is invisible in source.
 */
const PREFIX_END = String.fromCharCode(0xffff);

/**
 * Derive this product's SKU from its name, and make sure no other product
 * already answers to it. Decided HERE rather than in the form: the form cannot
 * see what another cashier is creating at the same moment, and a duplicate SKU
 * is silent — the scanner resolves it to whichever product it reaches first.
 */
async function deriveSku(ctx: MutationCtx, name: string): Promise<string> {
  const base = skuFromName(name);
  // One indexed RANGE read over the derived prefix returns every code the suffix
  // has to avoid; probing `base`, `base-2`, `base-3` in turn would cost a query
  // per collision. The bound holds because every SKU this module generates is
  // ASCII (A-Z, 0-9 and `-`), so none of them sorts past PREFIX_END.
  const nearby = await ctx.db
    .query('products')
    .withIndex('by_sku', (q) =>
      q.gte('sku', base).lt('sku', `${base}${PREFIX_END}`)
    )
    .take(SKU_COLLISION_LIMIT + 1);
  // Read one MORE than the walk considers, so a truncated set is detectable.
  // Deriving from a partial view could hand back a code that already exists
  // beyond the cut — the exact failure this whole function is here to prevent.
  const sku =
    nearby.length > SKU_COLLISION_LIMIT
      ? null
      : nextFreeSku(base, new Set(nearby.map((product) => product.sku)));
  if (!sku) {
    throw new ConvexError(
      'Demasiados productos con un nombre casi idéntico. Diferencia el nombre para generar un código distinto.'
    );
  }
  return sku;
}

export const create = mutation({
  args: {
    token: v.string(),
    barcode: v.string(),
    name: v.string(),
    price: v.number(),
    stock: v.number(),
    minStock: v.number(),
    categoryId: v.id('categories'),
    exempt: v.optional(v.boolean()),
    supplierId: v.optional(v.id('suppliers')),
    imageId: v.optional(v.id('_storage')),
  },
  returns: v.id('products'),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_products');
    assertProductNumbers(args);
    await assertReferencesExist(ctx, args);
    await assertBarcodeIsFree(ctx, args.barcode);
    const { token: _token, ...fields } = args;
    // The caller does not supply a SKU — see `deriveSku`. Taking one from the
    // client would only move the invention of the code somewhere less able to
    // guarantee it is unique.
    return await ctx.db.insert('products', {
      ...fields,
      sku: await deriveSku(ctx, args.name),
    });
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    productId: v.id('products'),
    // No `sku`: the code is derived once, at creation, and then FIXED. It may
    // already be printed on a shelf label or written on a purchase order, so
    // rewriting it — whether directly or as a side effect of a rename — would
    // invalidate those with no warning. A rule the form alone enforces is not a
    // rule, so the field simply is not accepted here.
    patch: v.object({
      barcode: v.optional(v.string()),
      name: v.optional(v.string()),
      price: v.optional(v.number()),
      stock: v.optional(v.number()),
      minStock: v.optional(v.number()),
      categoryId: v.optional(v.id('categories')),
      exempt: v.optional(v.boolean()),
      sellable: v.optional(v.boolean()),
      // `null` CLEARS the preferred supplier. An id sets it; omitting the key
      // leaves it untouched — the three-state contract an optional REFERENCE
      // needs (an empty string could do it for text fields, not for an id).
      supplierId: v.optional(v.union(v.id('suppliers'), v.null())),
      // null CLEARS the photo, same three-state contract as the supplier link.
      imageId: v.optional(v.union(v.id('_storage'), v.null())),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_products');
    const product = await ctx.db.get('products', args.productId);
    if (!product) throw new ConvexError('Producto no encontrado.');
    assertProductNumbers(args.patch);
    await assertReferencesExist(ctx, args.patch);
    // Re-check the barcode only when the patch actually moves it.
    if (
      args.patch.barcode !== undefined &&
      args.patch.barcode !== product.barcode
    ) {
      await assertBarcodeIsFree(ctx, args.patch.barcode, args.productId);
    }
    // `null` means CLEAR for both references; Convex removes an optional field
    // when it is patched with `undefined`. Every other key passes through
    // untouched, so omitting a key never disturbs it.
    const { supplierId, imageId, ...rest } = args.patch;
    // Replacing or clearing the photo orphans the previous file otherwise:
    // storage would keep a blob nothing references, with no owner and no way to
    // find it again. Deleted BEFORE the patch, while the old id is still known.
    if (
      imageId !== undefined &&
      product.imageId &&
      product.imageId !== imageId
    ) {
      await ctx.storage.delete(product.imageId);
    }
    await ctx.db.patch('products', args.productId, {
      ...rest,
      ...(supplierId !== undefined
        ? { supplierId: supplierId ?? undefined }
        : {}),
      ...(imageId !== undefined ? { imageId: imageId ?? undefined } : {}),
    });
    return null;
  },
});

export const setSellable = mutation({
  args: {
    token: v.string(),
    productId: v.id('products'),
    sellable: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_products');
    const product = await ctx.db.get('products', args.productId);
    if (!product) throw new ConvexError('Producto no encontrado.');
    await ctx.db.patch('products', args.productId, { sellable: args.sellable });
    return null;
  },
});

export const adjustStock = mutation({
  args: {
    token: v.string(),
    productId: v.id('products'),
    stock: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_products');
    const product = await ctx.db.get('products', args.productId);
    if (!product) throw new ConvexError('Producto no encontrado.');
    // Was `if (args.stock < 0)`, which let NaN straight through: `NaN < 0` is
    // false, and `v.number()` carries NaN happily. From there every total the
    // catalogue derives — units on hand, inventory value — is NaN, and nothing
    // downstream re-checks. The shared guard rejects it because it tests for a
    // FINITE number rather than for the absence of a minus sign.
    assertProductNumbers({ stock: args.stock });
    await ctx.db.patch('products', args.productId, { stock: args.stock });
    return null;
  },
});

export const remove = mutation({
  args: {
    token: v.string(),
    productId: v.id('products'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_products');
    // Plain delete: sales keep item snapshots and refunds skip missing products.
    const product = await ctx.db.get('products', args.productId);
    if (!product) return null;
    // The photo goes with it. `update` already deletes the previous blob when a
    // photo is replaced, for the reason written there — a file nothing points at
    // has no owner and no way to be found again. Deleting the document while
    // leaving the blob behind breaks that same rule from the other side, and a
    // rule that holds in one function and not the other is not a rule. Storage
    // FIRST, while the id is still readable.
    if (product.imageId) await ctx.storage.delete(product.imageId);
    await ctx.db.delete('products', args.productId);
    return null;
  },
});
