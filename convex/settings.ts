import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getSettings, requirePerm, requireSession } from './permissions';
import { scannerModeValidator, settingsDocValidator } from './schema';

// THE ONE INTENTIONALLY-PUBLIC QUERY (documented owner decision). Everything
// else in this internal POS is gated by requireSession, but store branding
// (name/logo/currency) must be readable BEFORE a session exists: AppShell calls
// useBsRate() → settings.get unconditionally while the unauthenticated Login
// screen is mounted, so gating this would throw on the boot path. It returns
// only non-sensitive store config (no credentials, no employee data). If this
// ever needs to carry sensitive fields, split a public branding projection out
// rather than gating this read. See auth/gate-all-functions policy.
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
