import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getSettings, requirePerm, requireSession } from './permissions';
import { scannerModeValidator, settingsDocValidator } from './schema';

// PUBLIC by design (documented decision): the login screen needs store branding
// (name/logo) before a session exists. Returns only non-sensitive store config.
export const get = query({
  args: {},
  returns: v.union(settingsDocValidator, v.null()),
  handler: async (ctx) => {
    return await ctx.db.query('settings').first();
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    patch: v.object({
      storeName: v.optional(v.string()),
      storeRif: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      currency: v.optional(v.string()),
      taxName: v.optional(v.string()),
      ivaPct: v.optional(v.number()),
      bsRate: v.optional(v.number()),
      printAuto: v.optional(v.boolean()),
      emailReceipt: v.optional(v.boolean()),
      lowStockAlerts: v.optional(v.boolean()),
      soundScan: v.optional(v.boolean()),
      scannerMode: v.optional(scannerModeValidator),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'manage_settings');
    const settings = await getSettings(ctx);
    await ctx.db.patch('settings', settings._id, args.patch);
    return null;
  },
});
