# Design: Cash Register Close

## Technical Approach

One new table, one new module (`convex/closes.ts`), one new screen. `sales` is read-only and gains two indexes (see D2, revised); `src/styles/` gains no byte; `src/state/db.ts` is untouched (no Dexie mirror, no version bump).

Blindness, window continuity and immutability are **structural**, not checks that can be bypassed:

- No query returns an open window's expected figures, so the expectation has no path to the client except `create`'s own return value.
- `create` accepts no `from`, so no caller can name a window that was already closed.
- The module exports only `create` and `list`, so there is no edit or delete to refuse.

## Architecture Decisions

| #   | Decision                       | Choice                                                                                                                          | Rejected                                                                           | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Expected: stored or recomputed | **Stored** on the row (`expectedUsd/Bs`, `differenceUsd/Bs`)                                                                    | Recompute on read from live `sales`                                                | A close is a signed fact. A later refund, a `purchases.remove` hard-delete, or a fix to the accumulation rule would silently rewrite a past verdict. `cash-flow-report`'s spec already records that drift as a real defect. Storing the _differences_ too (2 numbers) makes the row self-contained: it proves what the server said at that instant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D2  | Per-cashier window read        | **REVISED.** `sales.by_cashier_soldAt` + `sales.by_cashier_refundDate`; `cashierId` sits INSIDE both ranges                     | The original: `by_soldAt` range + in-memory `cashierId` filter, no new index       | The original reasoning treated the discarded rows as a cost in _work_ and concluded a filter was cheaper than two indexes. It missed that the discarded rows are also charged against the **read cap**, which is what makes a close possible at all. Ranging shop-wide means the whole shop's volume consumes one cashier's cap: with the 1–3 concurrent cashiers this design assumes, roughly a third of the cap locks each of them out. The refund pass _can_ be cashier-indexed — a nested path is a legal second index field (`by_refundDate` already proves it), so `['cashierId','refund.date']` works. Two indexes on the unbounded table is a real cost, accepted: the alternative is a cap that measures the wrong thing.                                                                                                               |
| D3  | Read cap behaviour             | **REVISED.** Refuse once naming an exit; on explicit `confirmPartial`, close over the most recent rows and record `countedFrom` | The original: refuse unconditionally. Also rejected: implicit `truncated: boolean` | The original refusal was unrecoverable. Once a previous close exists, `from` comes only from `prev.closedAt` and `openedAt` is refused, so an over-cap window can never be shortened: every retry re-reads the same start against a strictly larger set, and the drawer becomes permanently unclosable while the message tells the cashier to close more often — the one remedy the derivation forbids. A quiet `truncated` flag stays rejected for the original reason (a mutation writing a permanent record must not compute over a capped set behind the cashier's back). What replaces it is the cashier's explicit acknowledgement, with `countedFrom` on the row so the resulting surplus is explainable. Cap stays 1000 per pass, now per cashier, for the original transaction-limit reason (`convex/_generated/ai/guidelines.md:245`). |
| D4  | Blind-count shape              | **Two calls, no third query**                                                                                                   | A `closes.preview` / `openWindow` query                                            | `closes.list` already tells the screen whether a previous close exists (non-empty ⇒ `openedAt` not required). Adding no other query means the expectation is unreachable by construction rather than by a rule someone must remember.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D5  | `list` scoping                 | `scope: 'own' \| 'all'`                                                                                                         | `cashierId: v.optional(v.id('employees'))`                                         | AUTH-2 strips `cashierId` from every returns validator (`convex/schema.ts:443-452`), and `employees.list` is behind `manage_employees` (`convex/employees.ts:17`) — so a `view_reports`-only supervisor **cannot obtain another cashier's id to send**. `scope: 'all'` is the implementable spelling of "closes for a different cashier"; the picker is built from the distinct `cashierName`s in the result.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D6  | Field optionality              | All `closes` fields **required**                                                                                                | Optional-first (`config.yaml` design rule)                                         | That rule exists for migration safety on _existing_ tables. `closes` is new with zero rows, so there is nothing to backfill; an optional `expectedUsd` would permit a close with no expectation, which is not a close.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D7  | Screen styling                 | Reuse `.card` / `.prod-stat` / `.client-field` / `.lrow`; **no `.seg`**                                                         | A `Segmented` cashier switch                                                       | `.dash-hero-stats > div` (0,1,1) outranks `.seg` (0,1,0) — `src/screens/Dashboard.tsx:325-327` documents the grandchild workaround. A `<select className="input cat-select">` inside `<label className="catalog-filter">` avoids the specificity question entirely and already exists (`app.css:2580-2589`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Data Flow

```
Screen  ──useQuery(closes.list {scope:'own'})──▶  recorded closes only  (never an open window)
   │                                                     │
   │  cashier types countedUsd + countedBs                ▼
   └──useMutation(closes.create {counted…})──▶  from = lastClose.closedAt ?? args.openedAt
                                                to   = Date.now()          (server clock)
                                                  │
                        sales.by_soldAt (from,to] ─┤  filter cashierId → + drawer splits
                     sales.by_refundDate (from,to] ─┘  filter cashierId → − refund splits
                                                  │
                                     insert closes ──▶ returns expected + difference  (FIRST reveal)
```

## Interfaces / Contracts

`convex/schema.ts`:

```ts
export const closeFields = {
  cashierId: v.id('employees'),   // AUTH-2: stored for audit, stripped from returns
  cashierName: v.string(),        // frozen snapshot — what the UI displays
  openedAt: v.number(),           // window start, EXCLUSIVE
  closedAt: v.number(),           // window end, INCLUSIVE — server clock, never client-supplied
  expectedUsd: v.number(),
  expectedBs: v.number(),         // Bs AS TYPED (Σ entered) — never amount × any rate
  countedUsd: v.number(),
  countedBs: v.number(),
  differenceUsd: v.number(),      // counted − expected; negative = Faltante
  differenceBs: v.number(),
};
// closeDocValidator / publicCloseDocValidator (cashierId destructured out, per sales)
closes: defineTable(closeFields)
  .index('by_cashier_closedAt', ['cashierId', 'closedAt'])  // prev-close lookup + own history
  .index('by_closedAt', ['closedAt']),                       // scope:'all', so the cap cuts the set it displays
```

Index names follow the repo's existing convention (`by_taxId`, `by_supplier`), not the generic `by_a_and_b` guideline.

`convex/closes.ts` — object syntax, `args` + `returns` on both:

```ts
create: args { token, countedUsd, countedBs, openedAt?: v.optional(v.number()) }
        returns publicCloseDocValidator          // requireSession only — no permission
list:   args { token, scope?: 'own'|'all', limit? }
        returns { closes: v.array(publicCloseDocValidator), truncated: v.boolean() }
        // 'own' → requireSession; 'all' → + requirePerm(actor,'view_reports')
```

Expected accumulation (`splits` only — never `sale.method`, which is `cleanSplits[0].method`, `src/screens/Payment.tsx:132`):

```ts
const probe = CLOSE_MAX_SALES + 1; // 1000 + 1
const sold = await ctx.db
  .query('sales')
  .withIndex('by_soldAt', (q) => q.gt('soldAt', from).lte('soldAt', to))
  .take(probe);
const refunded = await ctx.db
  .query('sales')
  .withIndex('by_refundDate', (q) =>
    q.gt('refund.date', from).lte('refund.date', to)
  )
  .take(probe);
if (sold.length > CLOSE_MAX_SALES || refunded.length > CLOSE_MAX_SALES)
  throw new ConvexError(
    'El período es demasiado largo para cerrar. Cierra la caja con más frecuencia.'
  );

let usd = 0,
  bs = 0;
for (const s of sold) {
  // + what came IN
  if (s.cashierId !== actor._id) continue; // no sales cashier index — filter here (D2)
  for (const p of s.splits ?? []) {
    // legacy sale with no splits contributes 0
    if (p.method === 'cash')
      usd += p.amount; // USD, frozen at sale time
    else if (p.method === 'cash_bs') bs += p.entered ?? 0; // Bs AS TYPED, never reconverted
  } // card/transfer/mobile/zelle never reach the drawer
}
for (const s of refunded) {
  // − what went BACK OUT, in refund.date's window
  if (s.cashierId !== actor._id) continue;
  for (const p of s.splits ?? []) {
    if (p.method === 'cash_bs')
      bs -= p.entered ?? 0; // own currency, own frozen figure
    else usd -= p.amount; // owner's ruling: 'cash' AND every
  } // non-drawer method leave as USD cash
}
const expectedUsd = round2(usd),
  expectedBs = round2(bs); // convex/money.ts — one rounding rule
const differenceUsd = round2(countedUsd - expectedUsd); // from the ROUNDED figures, so the
const differenceBs = round2(countedBs - expectedBs); // row's arithmetic matches the display
```

Notes: `(from, to]` is half-open on purpose — a sale at exactly `previousClose.closedAt` belongs to the previous close. A sale sold _and_ refunded inside one window nets to zero, correctly. `by_refundDate` self-excludes non-refunded sales (`undefined` sorts before every number — `convex/schema.ts:510-518`). The `cash` and non-drawer refund branches coincide arithmetically; they are two distinct rules, collapsed only in the `else`.

Window derivation and immutability, in `create`:

```
prev = closes.by_cashier_closedAt(cashierId = actor._id).order('desc').first()
prev  ? from = prev.closedAt   and args.openedAt MUST be absent → 'El cierre continúa desde tu
                                cierre anterior; no puedes elegir la fecha de inicio.'
      : from = args.openedAt   required, finite, ≤ now → 'Indica desde cuándo cuenta este primer cierre.'
to = Date.now()
```

A second close for an already-closed window is not refused by a comparison — it is **unreachable**. `from` is not an input, so every close necessarily begins where the previous one ended and consumes its window exactly once. A client-supplied `from` (or a client `to`) would make that a check, and any check on a client value can be sent a different value.

Spanish `ConvexError` messages: counts non-finite/negative → `Los montos contados no son válidos.`; `openedAt` invalid → `La fecha de apertura no es válida.`; permission → the existing `Sin permisos para esta acción.`

## Screen

`src/screens/CashClose.tsx`, route `/cierre-de-caja`, nav id `close`, label `Cierre de caja`, icon `coins` (already in the `Icon` registry — no `Icon.tsx` change), `<Guard>` with **no** `perm` (session-only). Adds `ROUTE_IDS` entry + nav item + `<Route>` in `src/AppShell.tsx`, and `export type Close = Omit<Doc<'closes'>, 'cashierId'>` in `src/types.ts`.

**NO new CSS.** Every class below was verified present in `src/styles/app.css`:

| Element                               | Existing class                                                     | app.css            |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| Scroll owner                          | `.content`                                                         | 453                |
| Offline / unsynced notice             | `Banner` → `.banner.warn`                                          | 1491-1503          |
| Count sheet block                     | `.card` `.card-padded`                                             | 541, 547           |
| Section heading                       | `.sec-head` + `h2`                                                 | 549-553            |
| Each count input                      | `<label class="client-field">` + `<span>` + `.req` + `.input.mono` | 1714-1722, 576-584 |
| Reveal grid                           | `.prod-stats`                                                      | 1834               |
| Esperado / Contado / Diferencia tiles | `.prod-stat` + `.k` `.v.tabular` `.meta`                           | 1848-1870          |
| `Faltante` / `Sobrante` tone          | `.prod-stat.danger` / `.prod-stat.warn`                            | 1872-1879          |
| Cashier picker (`view_reports` only)  | `<label class="catalog-filter">` + `.input.cat-select`             | 2580-2589, 2592    |
| History row                           | `.lrow` + `.pname` `.pmeta` `.pright`                              | 701-713            |
| Empty history                         | `.empty`                                                           | 790-793            |

Two ported-CSS traps this layout deliberately avoids: `.lrow` is a `44px 1fr auto` grid, so its **first child must be a `.thumb`** (same family as the `.cartrow` trap; `History.tsx:851-853` is the precedent — a `.thumb` wrapping an `<Icon>`); and no scrolling region is nested inside a `.client-form`, whose `overflow-y:auto; min-height:0` (1696-1705) is what collapsed `.search-results` to zero height. `.content` stays the only scroll owner. `.prod-stat` has **no** `.ok` tone — an exact match renders the plain `.prod-stat`.

Blind ordering on the client: expected/difference live in `useState` initialised to `null` and are set **only** from the `closes.create` promise result. Nothing renders `Efectivo esperado` or `Diferencia` while that state is null, so a screenshot before submission cannot contain them.

**Offline refusal** (the server cannot see a device's Dexie queue, so the spec placed this here): `disabled = !online || usePendingSales().length > 0 || !countsValid`, with the reason stated in Spanish beside the button. `usePendingSales` is the established seam (`History.tsx:698`, mocked at `tests/components/history-pending.test.tsx:25`); the screen reads only `.length` — never those totals, which are estimates from mirrored prices and must never appear beside a close figure. `closes` has no Dexie mirror, so offline the list is `undefined` and shows the same connection-required state as `History`'s `salesUnavailable`.

## Recorded Limitations (carried, not re-opened)

`sale.splits` is `v.optional` (`convex/schema.ts:250`): `splits ?? []` makes such a sale contribute **zero to both currencies, silently** — no throw, no flag. The unsynced-sale check is per-device: a second device's `pendingOps` queue is invisible, so the close proceeds. Both stay non-normative notes; neither becomes a rule or a test assertion of correctness.

## Testing Strategy (Strict TDD — RED first)

| #   | Layer                                          | Test (RED first)                                                                                                                                                      | Proves                                                                                                                                                                             |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tests/convex/closes.test.ts`                  | Mixed sale `[{cash,10},{transfer,40}]` stored `method:'cash'` → expectedUsd 10, not 50                                                                                | `splits` is authoritative; `method` is `cleanSplits[0]`                                                                                                                            |
| 2   | convex                                         | Sale A `amount:100 entered:3600 @ rate 36`, Sale B `amount:200 entered:8000 @ rate 40`, settings rate changed before closing → expectedBs **11600**                   | Σ `entered`, never a reconversion. The USD amounts MUST differ: at `100`/`100` the sums coincide (`100×36 + 100×40 === 100×38 × 2`) and reconverting at any single rate passes too |
| 3   | convex                                         | transfer-only sale → both figures 0; purchase inside window → both figures 0                                                                                          | Non-drawer + purchases never counted                                                                                                                                               |
| 4   | convex                                         | Card-only $50 sold in W1, refunded in W2 → W1 unaffected, W2 expectedUsd −50; mixed refund (`cash_bs entered:1000` + `card 20`) → Bs −1000, USD −20                   | Refund attributed by `refund.date`; owner's per-split ruling                                                                                                                       |
| 5   | convex                                         | No query in `api.closes` returns expected before `create`; `create`'s own return carries it                                                                           | Blind-count ordering                                                                                                                                                               |
| 6   | convex                                         | Close, then close again → second row's `openedAt` **===** first's `closedAt`; `openedAt` passed with a previous close present → `ConvexError`                         | Second close continues; window is unnameable                                                                                                                                       |
| 7   | convex                                         | First close without `openedAt` → refuses                                                                                                                              | First close needs an explicit start                                                                                                                                                |
| 8   | convex                                         | Cajero A and B both sell; A closes → only A's figures                                                                                                                 | Windows never mix                                                                                                                                                                  |
| 9   | convex                                         | `Object.keys(api.closes)` is exactly `['create','list']`                                                                                                              | Immutability — nothing to update or delete                                                                                                                                         |
| 10  | convex                                         | `cajeroPlain` (no `view_reports`) `create` → succeeds under own id; `list {scope:'all'}` → refuses; `list` (own) → returns; `ownerToken list {scope:'all'}` → returns | Session-only close, `view_reports` to read another's                                                                                                                               |
| 11  | convex                                         | expected 100/5000, counted 95/5000 → `differenceUsd -5`, `differenceBs 0`                                                                                             | Currencies compared independently                                                                                                                                                  |
| 12  | convex                                         | `limit: 1` with 2 sales in window → `create` throws                                                                                                                   | Refuses rather than under-reporting (D3)                                                                                                                                           |
| 13  | `tests/components/cash-close.test.tsx` (jsdom) | Initial render: two blank inputs, no `Efectivo esperado`, no `Diferencia`; after a resolved `create` mock: both `Diferencia` figures render separately                | Screen-side blind count                                                                                                                                                            |
| 14  | jsdom                                          | `online:false` → action disabled + connection message; `online:true` with `usePendingSales` returning one op → still disabled                                         | Offline refusal, both halves                                                                                                                                                       |
| 15  | jsdom                                          | `can('view_reports')` false → cashier control **absent** from the DOM (`queryBy… toBeNull`), own history still listed; true → control present                         | Hidden, not disabled                                                                                                                                                               |

Harness: `convexTest(schema, modules)` + `seedBase`/`mintSession` from `tests/convex/fixtures.ts`, planting sales via `t.run(ctx.db.insert('sales', …))` as `tests/convex/reports.test.ts:32-62` does (the only way to control `soldAt`, `refund.date` and a per-sale `exchangeRate`). jsdom tests follow `tests/components/dashboard-cash-flow.test.tsx`: `vi.mock('convex/react')` dispatching on `getFunctionName`, plus `@/state/SessionContext`, `@/state/useOnline`, `@/state/usePendingSales`.

## Review Workload Forecast

| Surface                                                                | Authored lines (est.) |
| ---------------------------------------------------------------------- | --------------------- |
| `convex/schema.ts` (fields, 2 validators, table + 2 indexes, comments) | ~45                   |
| `convex/closes.ts` (new)                                               | ~170                  |
| `src/screens/CashClose.tsx` (new)                                      | ~180                  |
| `src/AppShell.tsx` + `src/types.ts`                                    | ~17                   |
| `tests/convex/closes.test.ts` (cases 1–12)                             | ~260                  |
| `tests/components/cash-close.test.tsx` (cases 13–15)                   | ~180                  |
| **Total**                                                              | **~852**              |

**Decision needed before apply: Yes** — **Chained PRs recommended: Yes** — **400-line budget risk: High.**

Stated plainly: this does **not** fit the 400-line budget, and nothing in it is padding — Strict TDD makes the ~440 test lines mandatory, and no listed surface can be dropped without dropping a spec requirement. The recorded delivery strategy is `single-pr`, so this needs either an explicitly accepted `size:exception` for one ~850-line PR, or a strategy change to a chain. If chained, the natural slices are: **(1)** schema + `closes.create` + convex cases 1–9, 11–12 (~365); **(2)** `closes.list` + case 10 + `src/types.ts` (~115); **(3)** screen + AppShell wiring + cases 13–15 (~375). Each has a clear finish, its own green test run, and reverts alone. This is a report, not a decision — the owner picks.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The change is one Convex table, two Convex functions and one React screen.

## Migration / Rollout

**No migration.** `closes` is a new table (no backfill, no existing row to validate), `sales` is read-only and unindexed by this change, and there is no Dexie mirror or `db.ts` version bump. Rollback is one revert: delete `convex/closes.ts`, the screen, the three `AppShell` lines, the `types.ts` alias and the schema block. Close records are lost; no money data can be.

## Open Questions

- [ ] None blocking. Two owner decisions recorded in the proposal remain deliberately out of scope and unchanged by this design: a shared physical drawer (per-cashier expected does not map to one physical count), and an opening float (expected starts from zero at `openedAt`, so any float the drawer carries reads as a permanent `Sobrante` until the owner asks for float tracking).
