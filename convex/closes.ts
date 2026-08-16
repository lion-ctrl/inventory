import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requirePerm, requireSession } from './permissions';
import { round2 } from './money';
import { publicCloseDocValidator } from './schema';

// A cash-register close: a cashier counts their physical drawer against what
// the server computed as expected for their window, and learns the per-
// currency difference — never before the count is submitted. Blindness,
// window continuity and immutability are STRUCTURAL here, not checks that
// could be bypassed:
//   - no query returns an open window's expected figures — only `create`'s
//     own return value does, and only AFTER the count is already committed;
//   - `create` accepts no `from` — a window always starts where THIS
//     cashier's own previous close ended, so a duplicate window is
//     unreachable rather than merely rejected;
//   - this module exports ONLY `create` and `list` — there is no edit or
//     delete to refuse.
//
// Expected cash counts ONLY `cash` + `cash_bs` splits — NEVER `sale.method`,
// which is `cleanSplits[0].method`, the FIRST split row, not an aggregate
// (`src/screens/Payment.tsx:132`). Expected Bs is the SUM of `entered` on
// every `cash_bs` split, never a reconversion at today's rate: each sale
// freezes its own `exchangeRate` at sale time, and reconverting backwards
// would invent a discrepancy that lands on a cashier's name.

/**
 * Per-probe read cap inside `create`'s mutation transaction. Lower than
 * `reports.cashFlow`'s 3000: this runs inside a MUTATION, which has its own
 * document/byte read limits, and every sale here carries its full `items`
 * snapshot array. Counted per CASHIER, not shop-wide — see the ranges below.
 *
 * Going over it never computes a quietly capped expected figure, which would
 * be the same lie the app already refuses for unsynced sales (D3). It refuses
 * once, names the exit, and only then — on the cashier's explicit
 * `confirmPartial` — closes over the most recent sales, recording
 * `countedFrom` so the row itself admits what it left out.
 */
const CLOSE_MAX_SALES = 1000;

/** Newest-first cap for `list` — mirrors `sales.history`'s HISTORY_MAX_ROWS. */
const CLOSES_MAX_ROWS = 500;

function isFiniteNonNegative(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

export const create = mutation({
  args: {
    token: v.string(),
    countedUsd: v.number(),
    countedBs: v.number(),
    // Required ONLY for a cashier's very first close. Every later close
    // derives its own start from that cashier's previous `closedAt`, so
    // supplying it once a previous close exists is refused — the window is
    // unnameable, not merely rejected.
    openedAt: v.optional(v.number()),
    // The cashier's acknowledgement that a window too large to read in one
    // transaction may be closed over its most recent sales only. Never
    // applied implicitly: the resulting row under-reports what was expected
    // and says so via `countedFrom`, which is the cashier's call to make.
    confirmPartial: v.optional(v.boolean()),
  },
  // No permission beyond a valid session: closing your OWN drawer is
  // operational, like `clients.create` — a cajero rarely holds
  // `view_reports` and must still be able to close.
  returns: publicCloseDocValidator,
  handler: async (ctx, args) => {
    const actor = await requireSession(ctx, args.token);

    if (
      !isFiniteNonNegative(args.countedUsd) ||
      !isFiniteNonNegative(args.countedBs)
    ) {
      throw new ConvexError('Los montos contados no son válidos.');
    }

    const to = Date.now(); // server clock — never client-supplied

    const prev = await ctx.db
      .query('closes')
      .withIndex('by_cashier_closedAt', (q) => q.eq('cashierId', actor._id))
      .order('desc')
      .first();

    let from: number;
    if (prev) {
      if (args.openedAt !== undefined) {
        throw new ConvexError(
          'El cierre continúa desde tu cierre anterior; no puedes elegir la fecha de inicio.'
        );
      }
      from = prev.closedAt;
    } else {
      if (args.openedAt === undefined) {
        throw new ConvexError('Indica desde cuándo cuenta este primer cierre.');
      }
      if (!Number.isFinite(args.openedAt) || args.openedAt > to) {
        throw new ConvexError('La fecha de apertura no es válida.');
      }
      from = args.openedAt;
    }

    // (from, to] is half-open on purpose: a sale at exactly the previous
    // close's `closedAt` belongs to THAT close, not this one. One extra row
    // per probe is the cheapest way to know whether more exist. Both ranges
    // put `cashierId` INSIDE the index so the cap measures only THIS
    // cashier's own work — ranging shop-wide and filtering afterwards let
    // colleagues' volume consume the cap and lock a cashier out.
    const probe = CLOSE_MAX_SALES + 1;
    const sold = await ctx.db
      .query('sales')
      .withIndex('by_cashier_soldAt', (q) =>
        q.eq('cashierId', actor._id).gt('soldAt', from).lte('soldAt', to)
      )
      .take(probe);
    const refunded = await ctx.db
      .query('sales')
      .withIndex('by_cashier_refundDate', (q) =>
        q
          .eq('cashierId', actor._id)
          .gt('refund.date', from)
          .lte('refund.date', to)
      )
      .take(probe);

    // Over the cap, the window CANNOT be shortened by retrying: once a
    // previous close exists, `from` comes only from `prev.closedAt` and
    // `openedAt` is refused, so every retry re-reads the same start against a
    // strictly larger set. A bare refusal here would leave the drawer
    // permanently unclosable and tell the cashier to do the one thing the
    // derivation forbids. So the refusal names a real exit, and taking it
    // records itself: `countedFrom` on the row says the expected figures
    // cover less than the window, which is why the difference will show a
    // surplus. `closedAt` is unchanged, so the next close still continues
    // from the true window end.
    const overCap =
      sold.length > CLOSE_MAX_SALES || refunded.length > CLOSE_MAX_SALES;
    if (overCap && !args.confirmPartial) {
      throw new ConvexError(
        `Tienes más de ${CLOSE_MAX_SALES} ventas sin cerrar. Confirma un cierre parcial para cerrar solo las más recientes.`
      );
    }

    // A partial close counts the MOST RECENT rows, not the oldest ones an
    // ascending probe happened to reach: the drawer in front of the cashier
    // holds today's money, so the newest rows are the ones worth counting.
    //
    // BOTH passes are re-read descending, and the counted start is derived from
    // BOTH. `overCap` is true when EITHER probe overflows, so deriving the
    // start from the sold side alone breaks in two ways: a window whose cap was
    // breached only by refunds has no sold row to derive from at all (an empty
    // read, and reading its last element throws — with `confirmPartial` as the
    // only exit, that crash IS the permanently unclosable drawer this whole
    // branch exists to prevent), and the refund pass would silently keep its
    // OLDEST rows, the opposite of the rule stated above.
    //
    // Each pass can only honestly reach back to the oldest row it actually
    // read; a pass that did NOT overflow reaches all the way back to `from`.
    // The counted start is the LATER of the two floors, so every row inside
    // (countedFrom, to] is covered by BOTH passes rather than by one of them.
    let countedFrom: number | undefined;
    let soldRows = sold;
    let refundedRows = refunded;
    if (overCap) {
      const recentSold = await ctx.db
        .query('sales')
        .withIndex('by_cashier_soldAt', (q) =>
          q.eq('cashierId', actor._id).gt('soldAt', from).lte('soldAt', to)
        )
        .order('desc')
        .take(CLOSE_MAX_SALES);
      const recentRefunded = await ctx.db
        .query('sales')
        .withIndex('by_cashier_refundDate', (q) =>
          q
            .eq('cashierId', actor._id)
            .gt('refund.date', from)
            .lte('refund.date', to)
        )
        .order('desc')
        .take(CLOSE_MAX_SALES);

      // `- 1` keeps the oldest row actually read INSIDE the counted set, since
      // the bound below is exclusive.
      const soldFloor =
        recentSold.length === CLOSE_MAX_SALES
          ? recentSold[recentSold.length - 1].soldAt - 1
          : from;
      const oldestRefund = recentRefunded[recentRefunded.length - 1];
      const refundFloor =
        recentRefunded.length === CLOSE_MAX_SALES && oldestRefund?.refund
          ? oldestRefund.refund.date - 1
          : from;
      countedFrom = Math.max(soldFloor, refundFloor);

      soldRows = recentSold.filter((s) => s.soldAt > (countedFrom as number));
      refundedRows = recentRefunded.filter(
        (s) => s.refund !== undefined && s.refund.date > (countedFrom as number)
      );
    }

    let usd = 0;
    let bs = 0;
    for (const s of soldRows) {
      for (const p of s.splits ?? []) {
        // A legacy sale with no `splits` contributes zero, silently.
        if (p.method === 'cash')
          usd += p.amount; // USD, frozen at sale time
        // Bs AS TYPED. A `cash_bs` split with no frozen `entered` figure is a
        // shape `Payment.tsx` never writes, and there is no honest way to
        // recover the bolívares it took: reconverting `amount` at any rate
        // would invent the discrepancy this module exists to avoid. Zero is
        // the deliberate answer, and it is proved by a test rather than left
        // to the reader to infer from the fallback.
        else if (p.method === 'cash_bs') bs += p.entered ?? 0;
        // card / transfer / mobile / zelle never reach the drawer.
      }
    }
    for (const s of refundedRows) {
      for (const p of s.splits ?? []) {
        // A DRAWER split gives back its OWN currency, at its OWN frozen
        // figure. Every non-drawer split leaves the drawer as USD cash
        // regardless of how it was originally paid — the owner's ruling.
        if (p.method === 'cash_bs') bs -= p.entered ?? 0;
        else usd -= p.amount;
      }
    }

    const expectedUsd = round2(usd);
    const expectedBs = round2(bs);
    // Difference is rounded from the ALREADY-rounded expected figures, so the
    // row's own arithmetic matches whatever the screen later displays.
    const differenceUsd = round2(args.countedUsd - expectedUsd);
    const differenceBs = round2(args.countedBs - expectedBs);

    const closeId = await ctx.db.insert('closes', {
      cashierId: actor._id,
      cashierName: actor.name,
      openedAt: from,
      closedAt: to,
      expectedUsd,
      expectedBs,
      countedUsd: args.countedUsd,
      countedBs: args.countedBs,
      differenceUsd,
      differenceBs,
      countedFrom,
    });
    const close = await ctx.db.get('closes', closeId);
    if (!close) throw new ConvexError('Cierre no encontrado.');
    const { cashierId: _cashierId, ...pub } = close; // AUTH-2
    return pub;
  },
});

export const list = query({
  args: {
    token: v.string(),
    // 'own' (default) needs only a valid session; 'all' additionally
    // requires view_reports. There is no `cashierId` arg — AUTH-2 already
    // keeps that id server-side, and `scope: 'all'` is the implementable
    // spelling of "closes for a different cashier."
    scope: v.optional(v.union(v.literal('own'), v.literal('all'))),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    closes: v.array(publicCloseDocValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const actor = await requireSession(ctx, args.token);
    const scope = args.scope ?? 'own';

    // A non-finite limit must refuse, never degrade: flooring NaN yields NaN,
    // every clamp propagates it, and slicing to NaN returns an EMPTY list
    // with `truncated: false` — a financial history reporting "you have no
    // closes" instead of an error. `create` already refuses non-finite input;
    // this keeps the module's two entry points honest in the same way.
    if (args.limit !== undefined && !Number.isFinite(args.limit)) {
      throw new ConvexError('El límite no es válido.');
    }
    const cap = Math.min(
      Math.max(1, Math.floor(args.limit ?? CLOSES_MAX_ROWS)),
      CLOSES_MAX_ROWS
    );
    const probe = cap + 1; // one extra row is the cheapest way to know more exist

    if (scope === 'own') {
      const rows = await ctx.db
        .query('closes')
        .withIndex('by_cashier_closedAt', (q) => q.eq('cashierId', actor._id))
        .order('desc')
        .take(probe);
      return {
        closes: rows
          .slice(0, cap)
          .map(({ cashierId: _cashierId, ...rest }) => rest),
        truncated: rows.length > cap,
      };
    }

    // scope === 'all': reading another cashier's closes requires
    // view_reports — the only gate, since there is no cashierId a caller
    // could otherwise send (AUTH-2).
    requirePerm(actor, 'view_reports');
    const rows = await ctx.db
      .query('closes')
      .withIndex('by_closedAt')
      .order('desc')
      .take(probe);
    return {
      closes: rows
        .slice(0, cap)
        .map(({ cashierId: _cashierId, ...rest }) => rest),
      truncated: rows.length > cap,
    };
  },
});
