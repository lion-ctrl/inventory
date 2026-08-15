# Design: Dashboard Cash Flow

## Technical Approach

One new Convex query, `reports.cashFlow`, sums money on the server and returns six
numbers. **Two** new additive indexes — `purchases.by_createdAt` and
`sales.by_refundDate` — so all three money reads are bounded index ranges over the same
`[from, to]` window, with no post-read scanning. The Dashboard adds three rows to the
existing `.dash-hero-stats` column plus a period selector, and computes local-time window
boundaries through a new pure helper in `src/lib/`. No `src/styles/` diff, no Dexie version
bump, no new runtime dependency.

## Architecture Decisions

### Decision: `truncated: true` ships WITH the real figures; the client blanks

| Option | Tradeoff | Decision |
|---|---|---|
| Server nulls the figures when capped | Forces `returns` into a union of two shapes; every future consumer branches | Rejected |
| Server returns real figures + `truncated`, client blanks | Matches `sales.history`; one flat validator | **Chosen** |

Rationale: (1) `convex/sales.ts:481-484` already returns `{ sales, truncated }` — payload
plus flag — and this is the same situation; (2) a capped sum is a genuine **lower bound**,
so the number is not meaningless, only unsafe to present as final; (3) nulling would make
`returns` a union and complicate every future consumer for a case the UI already handles
(`Dashboard.tsx:79` `salesPartial`).

### Decision: one cap of 3000, a `cap + 1` probe per read, one flag OR'd across three reads

`CASH_FLOW_MAX_ROWS = 3000`, overridable **downward** by an optional `limit` arg exactly as
`sales.history` clamps (`convex/sales.ts:488-491`). There are **three** capped reads — sales
sold in the window, sales *refunded* in the window, and purchases in the window — and
**each takes its own `cap + 1` probe**; reading one extra row is the cheapest way to learn
that more exist. The flag is the OR of all three:

```ts
const truncated =
  soldRows.length > cap || refundRows.length > cap || purchaseRows.length > cap;
```

One flag, never per-side, per the spec. A forgotten third probe is exactly the invisible
failure this change exists to prevent, so it gets its own RED test (below).

Sizing: the default window is one calendar month. A single-till bodega (one
`nextInvoiceNumber` counter) books roughly 50–120 tickets/day, so 1,500–3,600 sales/month;
purchases are weekly, tens per month; refunds are a small fraction of sales, so the refund
read is the least likely of the three to cap. 3000 is 6× `HISTORY_MAX_ROWS = 500`, justified
because this query returns **six numbers, not 3000 documents** — transport is O(1) and only
the read cost scales. The binding constraint is bytes, not rows: a sale doc carries a frozen
`items` snapshot (~1–1.5 KB for a 3–6 line ticket), so 3001 rows is ~3–4.5 MB of read,
inside one Convex query transaction with margin. A shop that outgrows it gets blanked tiles,
never a short number; the upgrade path is a daily rollup table, deliberately out of scope.

`limit` also makes truncation testable with 2 documents instead of 3001.

### Decision: refunds get their own index, `sales.by_refundDate`

The spec says a refunded sale MUST count as an expense in the period it was **refunded**,
unconditionally. A time-window heuristic satisfies that *usually*, which is not what a MUST
means.

| Option | Cost | Verdict |
|---|---|---|
| **New `sales.index('by_refundDate', ['refund.date'])`, second bounded range read over `[from, to]`** | One schema line + one indexed read; window-bounded like the other two | **Chosen** |
| Widened backward walk on `by_soldAt` (`[from − 30d, to]`), classified in JS | Reads `(window + 30 days)` of sales in *every* period, so `Día` costs the same as `Mes` — **and a sale refunded 40 days after it was made silently vanishes from `expenses` with no symptom** | Rejected |
| Two reads over `by_soldAt` (window + separate pre-window tail) | Same unbounded-history problem, at 2× the docs | Rejected |
| No lower bound (walk all history on `by_soldAt`) | `truncated` fires as soon as *lifetime* sales > cap, blanking the tiles forever | Rejected |

Rationale for the chosen option: the cost is one line of schema, set against a money figure
that would otherwise be quietly wrong forever. An invisible wrong number on the screen the
owner trusts most is the same family of failure as labelling cash flow "ganancias" — and it
is worse, because there is nothing to notice.

Two facts make the index exact rather than approximate, both **verified against the
installed `convex@^1.36.1`, not assumed**:

1. **Nested paths are indexable.** `convex/dist/esm-types/server/data_model.d.ts:9-23`
   states field paths "can either be field names (like `name`) or references to fields on
   nested objects (like `properties.name`)", and `FieldTypeFromFieldPathInner` (line 90)
   resolves dot-separated paths. `refund` is optional
   (`schema.ts:255` — `v.optional(v.object({ date: v.number(), reason: v.string() }))`), and
   `VOptional` (`values/validators.d.ts:246`) maps
   `VObject<T, F, "required", FieldPaths>` → `VObject<T | undefined, F, "optional", FieldPaths>`,
   **preserving `FieldPaths`**. Since `index()` accepts
   `ExtractFieldPaths<DocumentType> = DocumentType["fieldPaths"]`
   (`server/schema.d.ts:41,186`), `['refund.date']` typechecks — which matters because
   `pnpm lint` runs `tsc -b`.
2. **Non-refunded sales exclude themselves.** A sale with no `refund` has
   `refund.date === undefined`, which sorts before every number, so the numeric bound
   `q.gte('refund.date', from)` leaves it out with **no `filter`** — consistent with the
   project guideline forbidding `filter` in queries.

There is no residual gap and no lookback constant. Income stays attributed to the period
**sold** and is never rewritten; expenses pick the sale up again in the period **refunded**.

### Decision: `net` is computed from the *rounded* figures

`income = round2(rawIncome)`, `expenses = round2(rawExpenses)`, `net = round2(income -
expenses)`. Summing many 2-decimal floats drifts; deriving `net` from the rounded pair
guarantees the owner can verify the subtraction on screen.

## Interfaces / Contracts

`convex/reports.ts` (new) — object syntax, `args` **and** `returns`, Spanish `ConvexError`:

```ts
export const cashFlow = query({
  args: {
    token: v.string(),
    from: v.number(),   // inclusive epoch ms, as sent — the server does NO tz math
    to: v.number(),     // inclusive epoch ms
    limit: v.optional(v.number()), // clamped down only; makes the cap testable
  },
  returns: v.object({
    income: v.number(),
    expenses: v.number(),        // refunds in the window + purchases in the window
    net: v.number(),
    salesCount: v.number(),      // sale docs SOLD in [from,to], refunded ones included
    purchasesCount: v.number(),  // purchase docs in [from,to]; refunds never counted here
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    requirePerm(employee, 'view_reports');
    if (!Number.isFinite(args.from) || !Number.isFinite(args.to) || args.to < args.from) {
      throw new ConvexError('El período seleccionado no es válido.');
    }
    // …three indexed reads, three cap+1 probes, round2
  },
});
```

`requireSession` is safe in a query context — its `lastSeenAt` bump is guarded by
`'patch' in ctx.db` (`convex/permissions.ts:107`). `view_reports` is a real `Permission`
literal (`convex/permissions.ts:8`); `purchaseFields.total` is the global USD amount for the
whole order (`schema.ts:213-214`).

`convex/schema.ts` — both indexes, exact:

```ts
purchases: defineTable(purchaseFields)
  .index('by_supplier', ['supplierId', 'createdAt'])
  .index('by_createdAt', ['createdAt']),

sales: defineTable(saleFields)
  .index('by_invoice', ['invoiceNumber'])
  .index('by_soldAt', ['soldAt'])
  .index('by_idempotencyKey', ['idempotencyKey'])
  .index('by_refundDate', ['refund.date']),
```

Neither is redundant. `by_supplier` leads on `supplierId`, so it cannot serve a global
`createdAt` range (`schema.ts:497-500` today). `by_soldAt` orders by sale date, which says
nothing about refund date. Both are additive — no field added, widened or narrowed, no
document rewritten — and neither table is in `src/state/db.ts`, so **no Dexie version bump**.

## Data Flow

    Dashboard  ──period──▶ periodBounds()  ──{from,to} epoch ms──▶ reports.cashFlow
       │                   (src/lib/period.ts, LOCAL time)              │
       │                                                    requireSession → requirePerm
       │                                                                │
       │                       sales.by_soldAt        [from,to] desc take(cap+1) → income
       │                       sales.by_refundDate    [from,to] desc take(cap+1) → expenses
       │                       purchases.by_createdAt [from,to] desc take(cap+1) → expenses
       │                                                                │
       └──◀── { income, expenses, net, salesCount, purchasesCount, truncated } ──┘

- `by_soldAt` read → `income`, `salesCount`. Refunded sales are **included**: income belongs
  to the period sold and is never rewritten, so a figure printed yesterday still matches.
- `by_refundDate` read → `expenses`. Attributed to the period refunded, for a sale of any
  age.
- `by_createdAt` read → `expenses`, `purchasesCount`.

A sale sold *and* refunded inside the same window appears in both the first and second read —
that is correct, not double counting: money came in and the same money went back out.

## Dashboard Wiring (`src/screens/Dashboard.tsx`)

- `const [period, setPeriod] = useState<Period>('mes')`; `const {from, to} = useMemo(() =>
  periodBounds(period, new Date()), [period])`. Memoising is mandatory: the file already
  records that a raw `Date.now()` in query args "would change identity on every render and
  resubscribe in a loop" (`Dashboard.tsx:61-62`).
- `useQuery(api.reports.cashFlow, token && can('view_reports') ? { token, from, to } : 'skip')`
  — `'skip'` is how permission-denied renders as *absent* with no thrown error; the server
  refuses independently.
- `cashBlank = cashFlow === undefined || cashFlow.truncated === true` → all three tiles show
  `'—'` together. Showing a number only when a non-truncated result exists also avoids
  `money(undefined)` → `NaN` during first load.
- Captions reuse the tile's own precedent (`Dashboard.tsx:229-236`): `No disponible sin
  conexión` when `!online && cashFlow === undefined`; `No disponible: el período tiene más
  movimientos de los que se pueden sumar.` when truncated. A cached result while offline
  still shows numbers, per the spec's "no cached result this session".

### Pinned Spanish copy

| Element | String |
|---|---|
| Tile labels | `Ingresos`, `Egresos`, `Diferencia` |
| Selector | `Mes` (default), `Semana`, `Día` — current period only |
| **Egresos caption** | `Egresos = solo compras a proveedores. No incluye alquiler, sueldos ni servicios.` |

The caption is body text inside the same panel as the figures, never a tooltip — the
reader must meet it while reading the numbers, not by hovering. It is the LAST row of
`.dash-hero-stats`, after `Diferencia`, which is also the only position where the
existing `last-child → border-bottom: none` treatment applies (see the CSS table
below); putting it directly beneath `Egresos` would leave a divider cutting the block
in half and would need a new rule to remove, which the zero-diff constraint forbids.

`Ganancias` and `Utilidad` appear nowhere.

### Existing CSS reused (zero `src/styles/` diff — verified in `src/styles/app.css`)

| Element | Existing class | Verified at |
|---|---|---|
| Each of the three tiles | `.dash-hero-stats > div` + `.k` + `.v` | app.css:1142-1146 |
| Egresos caption row | `.dash-hero-stats > div` (last child → `border-bottom: none`) + `.t-body-sm` | app.css:1144, tokens.css:198 |
| Period selector | `.seg`, `.seg button`, `.seg button.on` | app.css:1197-1207 |

Precedent-driven gotcha, in the spirit of `.search-results` collapsing inside `.client-form`
and `.cartrow` needing a `.thumb` first child: **the `.seg` must be a grandchild, not a
direct child, of `.dash-hero-stats`.** `.dash-hero-stats > div` (specificity 0,1,1) beats
`.seg` (0,1,0) and would overwrite its `display`, `padding` and `border-bottom`. Wrap it:
`<div><div className="seg">…</div></div>`. Second precedent: `.t-body-sm` uses `--ink-3` on
the dark hero panel, which is already the shipped treatment at `Dashboard.tsx:230`.

## File Changes & Line Forecast

| File | Action | Est. lines | Δ vs previous forecast |
|---|---|---|---|
| `convex/schema.ts` | Modify — two indexes | 16 | +11 |
| `convex/reports.ts` | Create | 90 | 0 |
| `src/lib/period.ts` | Create | 26 | — |
| `src/screens/Dashboard.tsx` | Modify | 55 | — |
| `tests/lib/period.test.ts` | Create | 28 | — |
| `tests/convex/reports.test.ts` | Create | 124 | +12 |
| `tests/components/dashboard-cash-flow.test.tsx` | Create | 78 | — |
| `tests/components/dashboard-offline.test.tsx` | Modify (`useQuery` mock must dispatch on the function ref) | 8 | — |
| **Total** | | **~425** | **+23** |

Honest accounting of the re-forecast:

- `convex/reports.ts` came out **net zero**, as expected. The third read costs ~11 lines
  (query block, probe term, sum); deleting `REFUND_LOOKBACK_MS`, its justification comment,
  the widened-window expression and the two-branch JS classification loop returns ~11.
  The third read did pay for itself.
- `convex/schema.ts` is where the cost actually landed: **5 → 16**. `by_refundDate` is ~7
  changed lines with its rationale comment, and adding a second index to `purchases` forces
  the existing one-line `defineTable(...).index(...)` form to reflow into a 3-line chain
  (4 deletions, 5 additions).
- `tests/convex/reports.test.ts` grows **+12** for one genuinely new test: a cap hit on the
  **refund** read. With three capped reads, each probe needs its own proof or a forgotten one
  ships silently. The existing refund test costs nothing extra — it is *retargeted* rather
  than added to (below).

**The budget does not fit, and I am not trimming something load-bearing to pretend it does.**
At ~425 against a 400-line budget this is 25 over. The two trims previously pre-authorised
do not rescue it either: folding the window-inclusivity assertions into the happy-path Convex
test saves ~12, and the only non-load-bearing half of the selector test (`Mes` carries `.on`
by default) saves ~5 — the other half, *no control navigates to a previous period and no
comparison figure exists*, is the scope guard against this screen drifting toward "ganancias"
and stays. That path lands at ~408, still over, having spent real coverage for nothing.

**The cut I would take is structural, not a trim:** slice at the layer seam into two chained
PRs, each independently green, revertible, and comfortably inside the budget.

- **Unit 1 — server** (`convex/schema.ts` + `convex/reports.ts` + `tests/convex/reports.test.ts`): **~230**
- **Unit 2 — client** (`src/lib/period.ts` + `src/screens/Dashboard.tsx` + the three test files): **~195**

It costs zero assertions. Cached delivery strategy is `single-pr`, so this needs an owner
decision before apply.

    Decision needed before apply: Yes
    Chained PRs recommended: Yes
    400-line budget risk: High

## Testing Strategy (Strict TDD — every row RED first)

| Layer | Test | Proves |
|---|---|---|
| Unit — `tests/lib/period.test.ts` | `periodBounds` for `dia`/`semana`/`mes` | `from` is local midnight, `to` is `23:59:59.999` local, `to - from === 86_399_999` for a day. Asserted as **relative invariants**, never against a hard-coded UTC-4 offset, so CI cannot flake on the runner's `TZ` |
| Unit | Near-midnight boundary | A `soldAt` at 23:50 local on the last day of the month satisfies `from <= soldAt <= to` for that month and fails it for the next — the spec's UTC-4 scenario, expressed without a timezone dependency |
| Convex — `tests/convex/reports.test.ts` | Denied | `fx.cajeroPlainToken` (`manage_clients` only) → rejects. Server-side, independent of any UI |
| Convex | Granted | `fx.ownerToken` and `fx.cajeroVoidToken` (which holds `view_reports`, `convex/seed.ts:501`) both return figures — pins the accepted reuse consequence |
| Convex | Happy path + inclusivity | `income 500 / expenses 300 / net 200`; exactly the six keys, no documents or items; a sale exactly at `from` and one exactly at `to` count, one at `to + 1` does not |
| Convex | Empty window | All zeros, does not throw |
| Convex | **Refund of an OLD sale** | Sale sold **~90 days before** the window and refunded inside it. The window's `expenses` includes it and `salesCount` does not; the original period's `income` is byte-identical before and after the refund. Deliberately far outside any plausible lookback — this is the assertion the `by_refundDate` index was bought for, and it is the one a 30-day heuristic would have failed silently. `refund.date` is set via `t.run(ctx => ctx.db.patch(...))`, because `sales.refund` stamps `Date.now()` (`convex/sales.ts:556`) and cannot be aimed at a past period |
| Convex | Refunded inside its own window | A sale sold and refunded in the same window contributes to both `income` and `expenses`, netting to 0 — not double counting, and not silently deduplicated |
| Convex | Cap hit — sales side | `limit: 1` with 2 in-window sales → `truncated: true`, **and the numeric figures are still returned** (pins the ruling above) |
| Convex | Cap hit — **refund side** | `limit: 1` with 2 in-window refunds, 1 sale, 1 purchase → `truncated: true`. Proves the third probe exists; without it the refund read caps silently and `expenses` reports low |
| Convex | Cap hit — purchases side | `limit: 1` with 2 purchases and 1 sale → `truncated: true`. Proves the flag is OR'd across all three, not per-side |
| Convex | Invalid window | `to < from` → Spanish `ConvexError` |
| Component — `tests/components/dashboard-cash-flow.test.tsx` (jsdom) | Happy path | `Ingresos`/`Egresos`/`Diferencia` render numbers; `/ganancia\|utilidad/i` matches nothing |
| Component | Truncated | `truncated: true` **with real numbers** → all three show `—` and no figure. The single most important UI test: it is what makes the server-returns-figures ruling safe |
| Component | Offline | Fresh offline, no cached result → all three `—` plus `No disponible sin conexión`, alongside the already-passing sales tiles |
| Component | Permission denied | `can: () => false` → the three labels and the selector are absent, nothing throws |
| Component | Egresos caption | The exact pinned string is in the document as text, not a `title` attribute |
| Component | Selector | `Mes` carries `.on` by default; no control navigates to a previous period and no comparison figure exists |

`pnpm test:run` must stay green at 482 + new; `pnpm lint` (`tsc -b && eslint`) clean — the
`['refund.date']` path is a typecheck surface, so `tsc -b` is a real gate here, not a
formality; `git diff --stat src/styles/` must be empty.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. The change adds one authenticated read-only Convex query and
one client screen block.

## Migration / Rollout

No data migration. Both indexes are additive: no field added, widened or narrowed, no
document rewritten, no backfill of data. Convex builds `by_createdAt` and `by_refundDate`
at deploy time over the existing rows — an index build, not a schema migration, with no
document validation change (`refund` was already `v.optional`, so every pre-existing sale
stays valid). Neither table is Dexie-mirrored, so `src/state/db.ts` keeps `version(3)`.
Rollback is deleting `convex/reports.ts`, the Dashboard block and the two index lines — the
screen returns to two tiles.

## Open Questions

- [ ] Carried from the proposal, still non-blocking: should `purchases.remove` stay a hard
      delete when it silently lowers a past period's `expenses`?
