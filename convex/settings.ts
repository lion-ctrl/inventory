import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getSettings, requirePerm, requireSession } from './permissions';
import { scannerModeValidator, settingsDocValidator } from './schema';

// Session-gated read (owner directive: NOTHING is public). The store config
// singleton — including the Bs rate consumed at payment time — is only readable
// with a valid session, exactly like every other read in this internal POS. The
// Login screen never reads settings (its branding is static), so gating this is
// safe: the client skips the call until a token exists (see useSettingsDoc).
// `auth.login` is the ONLY credential-free endpoint in the backend.
export const get = query({
  args: { token: v.string() },
  returns: v.union(settingsDocValidator, v.null()),
  handler: async (ctx, args) => {
    await requireSession(ctx, args.token);
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
