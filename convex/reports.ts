import { ConvexError, v } from 'convex/values';
import { query } from './_generated/server';
import { requirePerm, requireSession } from './permissions';
import { round2 } from './money';

// Cash flow — money in minus money out over a caller-supplied window. NOT
// profit: the schema has no cost-of-goods-sold field, so margin is not
// computable and this must never be documented or labelled as such.
//
// Three indexed reads over the SAME [from, to] window, each its own `cap + 1`
// probe — a forgotten probe under-reports money with no symptom:
//   sales.by_soldAt        → income, salesCount (refunded sales stay counted;
//                             income belongs to the period SOLD, never rewritten)
//   sales.by_refundDate    → expenses (attributed to the period REFUNDED)
//   purchases.by_createdAt → expenses, purchasesCount
// `truncated` is the OR of all three probes — one flag, never per-side.
const CASH_FLOW_MAX_ROWS = 3000;

export const cashFlow = query({
  args: {
    token: v.string(),
    from: v.number(), // inclusive epoch ms, as sent — the server does NO tz math
    to: v.number(), // inclusive epoch ms
    limit: v.optional(v.number()), // clamps the cap DOWN only; makes it testable
  },
  returns: v.object({
    income: v.number(),
    expenses: v.number(), // refunds in the window + purchases in the window
    net: v.number(),
    salesCount: v.number(), // sale docs SOLD in [from,to]; refunded ones included
    purchasesCount: v.number(), // purchase docs in [from,to]; refunds never counted here
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'view_reports');

    if (
      !Number.isFinite(args.from) ||
      !Number.isFinite(args.to) ||
      args.to < args.from
    ) {
      throw new ConvexError('El período seleccionado no es válido.');
    }

    const cap = Math.min(
      Math.max(1, Math.floor(args.limit ?? CASH_FLOW_MAX_ROWS)),
      CASH_FLOW_MAX_ROWS
    );
    const probe = cap + 1; // one extra row is the cheapest way to know more exist

    const soldRows = await ctx.db
      .query('sales')
      .withIndex('by_soldAt', (q) =>
        q.gte('soldAt', args.from).lte('soldAt', args.to)
      )
      .order('desc')
      .take(probe);
    const refundRows = await ctx.db
      .query('sales')
      .withIndex('by_refundDate', (q) =>
        q.gte('refund.date', args.from).lte('refund.date', args.to)
      )
      .order('desc')
      .take(probe);
    const purchaseRows = await ctx.db
      .query('purchases')
      .withIndex('by_createdAt', (q) =>
        q.gte('createdAt', args.from).lte('createdAt', args.to)
      )
      .order('desc')
      .take(probe);

    const truncated =
      soldRows.length > cap ||
      refundRows.length > cap ||
      purchaseRows.length > cap;

    const soldSlice = soldRows.slice(0, cap);
    const refundSlice = refundRows.slice(0, cap);
    const purchaseSlice = purchaseRows.slice(0, cap);

    const income = round2(soldSlice.reduce((sum, s) => sum + s.total, 0));
    const expenses = round2(
      refundSlice.reduce((sum, s) => sum + s.total, 0) +
        purchaseSlice.reduce((sum, p) => sum + p.total, 0)
    );

    return {
      income,
      expenses,
      net: round2(income - expenses),
      salesCount: soldSlice.length,
      purchasesCount: purchaseSlice.length,
      truncated,
    };
  },
});
