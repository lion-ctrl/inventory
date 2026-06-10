import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getSettings, requirePerm } from "./permissions";
import {
  salesTypeValidator,
  scannerModeValidator,
  settingsDocValidator,
} from "./schema";

export const get = query({
  args: {},
  returns: v.union(settingsDocValidator, v.null()),
  handler: async (ctx) => {
    return await ctx.db.query("settings").first();
  },
});

export const update = mutation({
  args: {
    actorId: v.id("employees"),
    patch: v.object({
      storeName: v.optional(v.string()),
      storeRif: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      currency: v.optional(v.string()),
      taxName: v.optional(v.string()),
      ivaPct: v.optional(v.number()),
      bsRate: v.optional(v.number()),
      salesType: v.optional(salesTypeValidator),
      printAuto: v.optional(v.boolean()),
      emailReceipt: v.optional(v.boolean()),
      lowStockAlerts: v.optional(v.boolean()),
      soundScan: v.optional(v.boolean()),
      scannerMode: v.optional(scannerModeValidator),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, "manage_settings");
    const settings = await getSettings(ctx);
    await ctx.db.patch("settings", settings._id, args.patch);
    return null;
  },
});
