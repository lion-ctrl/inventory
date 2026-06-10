import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requirePerm } from "./permissions";
import { productDocValidator } from "./schema";

export const list = query({
  args: {},
  returns: v.array(productDocValidator),
  handler: async (ctx) => {
    return await ctx.db.query("products").collect();
  },
});

export const byBarcode = query({
  args: { barcode: v.string() },
  returns: v.union(productDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("products")
      .withIndex("by_barcode", (q) => q.eq("barcode", args.barcode))
      .first();
  },
});

export const create = mutation({
  args: {
    actorId: v.id("employees"),
    barcode: v.string(),
    sku: v.string(),
    name: v.string(),
    price: v.number(),
    stock: v.number(),
    minStock: v.number(),
    categoryId: v.id("categories"),
    exempt: v.optional(v.boolean()),
    glyph: v.optional(v.string()),
  },
  returns: v.id("products"),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, "manage_products");
    const { actorId: _actorId, ...fields } = args;
    return await ctx.db.insert("products", fields);
  },
});

export const update = mutation({
  args: {
    actorId: v.id("employees"),
    productId: v.id("products"),
    patch: v.object({
      barcode: v.optional(v.string()),
      sku: v.optional(v.string()),
      name: v.optional(v.string()),
      price: v.optional(v.number()),
      stock: v.optional(v.number()),
      minStock: v.optional(v.number()),
      categoryId: v.optional(v.id("categories")),
      exempt: v.optional(v.boolean()),
      glyph: v.optional(v.string()),
      sellable: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, "manage_products");
    const product = await ctx.db.get("products", args.productId);
    if (!product) throw new ConvexError("Producto no encontrado.");
    await ctx.db.patch("products", args.productId, args.patch);
    return null;
  },
});

export const setSellable = mutation({
  args: {
    actorId: v.id("employees"),
    productId: v.id("products"),
    sellable: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, "manage_products");
    const product = await ctx.db.get("products", args.productId);
    if (!product) throw new ConvexError("Producto no encontrado.");
    await ctx.db.patch("products", args.productId, { sellable: args.sellable });
    return null;
  },
});

export const adjustStock = mutation({
  args: {
    actorId: v.id("employees"),
    productId: v.id("products"),
    stock: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, "manage_products");
    const product = await ctx.db.get("products", args.productId);
    if (!product) throw new ConvexError("Producto no encontrado.");
    if (args.stock < 0) {
      throw new ConvexError("El stock no puede ser negativo.");
    }
    await ctx.db.patch("products", args.productId, { stock: args.stock });
    return null;
  },
});

export const remove = mutation({
  args: {
    actorId: v.id("employees"),
    productId: v.id("products"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, "manage_products");
    // Plain delete: sales keep item snapshots and refunds skip missing products.
    const product = await ctx.db.get("products", args.productId);
    if (product) await ctx.db.delete("products", args.productId);
    return null;
  },
});
