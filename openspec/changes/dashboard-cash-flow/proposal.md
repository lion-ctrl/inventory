# Proposal: Dashboard Cash Flow

## Intent

The Dashboard shows `Vendido hoy` and nothing about money going OUT. A corner shop buys weekly and sells daily, so a single day says nothing about how the month went.

This is **cash flow** (money in − money out), **NOT profit**. Verified in `convex/schema.ts`: `productFields` carries `price` (the SELLING price) and **no cost field**; `purchaseFields` carries one global `total` per order and `purchaseItemValidator` is `{ productId, name, qty }` with **no per-line cost**. Cost of goods sold is absent from the data model, so margin is not computable. That follows a deliberate owner decision — products hold the selling price only, a purchase holds one global amount — and is recorded here as a **constraint, not a defect**. Naming it "ganancias" would lie on the figure the owner trusts most: stock bought in March and sold in April makes March look terrible and April invented.

## Scope

### In Scope

- `reports.cashFlow(token, from, to)` → `{ income, expenses, net, salesCount, purchasesCount, truncated }`. Sums on the SERVER, returns figures not documents — the Dashboard sums sale documents in the browser today; that is not repeated for money.
- `cap + 1` probe → `truncated`, never a short total: a silently capped sum reports LESS money than came in. `sales.history` established this rule.
- `requirePerm(employee, 'view_reports')` SERVER-side. `sales.history` is only session-gated, with the permission living client-side.
- New `purchases` index `by_createdAt` — the table has only `by_supplier`, so a period query would scan it. `sales` already has `by_soldAt`.
- Refunds: income in the period SOLD, expense in the period REFUNDED (`sale.refund.date`). Never excluded retroactively — a figure printed yesterday must still match today.
- Three tiles beside `Ventas` / `Productos`, plus a period selector defaulting to the MONTH.
- Offline: purchases are not Dexie-mirrored, so all three tiles show `—` through the existing `salesUnavailable` pattern. Never a number over partial data.

### Out of Scope

- Product unit cost, COGS, margin, "ganancias" — the path to real profit, deliberately deferred.
- Reports screen, charts, export, per-supplier/category breakdown, Bs conversion of the three figures.
- Mirroring `purchases` into Dexie; any `src/styles/` edit (verbatim port, pixel-fidelity contract).

## Capabilities

### New Capabilities

- `cash-flow-report`: server-side period aggregation — permission gate, truncation contract, refund attribution, `by_createdAt` index.
- `dashboard-cash-flow-tiles`: the three tiles, the period selector, and the offline / partial / permission-denied states.

### Modified Capabilities

- None. `openspec/specs/` does not exist yet and `sales.history` is untouched.

## Approach

New `convex/reports.ts`, object-syntax with `args` + `returns` validators. Session → `requirePerm` → **three** indexed windows over the same `[from, to]`: `sales` via `by_soldAt` (income), `purchases` via the new `by_createdAt` (expenses), and refunded sales via the new `sales.by_refundDate` (expenses), each `take(cap + 1)` summing `total`. `truncated` is the OR of all **three** probes; `net = income − expenses`, `round2`-ed like the rest of the money math.

The third index is the load-bearing decision of this change and was added during design. Without it, refund attribution can only be approximated by widening the sales window and walking backwards, which satisfies the unconditional refund rule *usually* — a sale refunded outside the lookback simply vanishes from expenses, with no symptom. One schema line buys exactness.

**Copy (Spanish, user-facing)**: `Ingresos`, `Egresos`, `Diferencia`; selector `Mes` (default) / `Semana` / `Día`; reuse `No disponible sin conexión` and the existing partial-figure line. `Ganancias` and `Utilidad` are BANNED on this screen.
**Identifiers / DB fields (English)**: `reports.cashFlow`, `income`, `expenses`, `net`, `salesCount`, `purchasesCount`, `truncated`, `by_createdAt`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `convex/reports.ts` | New | The `cashFlow` query |
| `convex/schema.ts` | Modified | `purchases.index('by_createdAt', ['createdAt'])` |
| `src/screens/Dashboard.tsx` | Modified | Tiles, period selector, states |
| `src/styles/`, `src/state/db.ts` | Untouched | Pixel-fidelity contract; no Dexie version bump |
| `tests/convex/`, `tests/components/` | New | RED-first per Strict TDD |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Read as profit anyway | Med | `Diferencia`, never `Ganancias`; caption says money in minus money out |
| Capped period under-reports | Med | `cap + 1` → `truncated`; the UI states the figure is partial |
| `purchases.remove` hard-deletes, rewriting a past period's expenses | Med | Flagged to the owner; not fixed here (see Dependencies) |
| Half-figure offline (sales cached, purchases absent) | High | All three tiles show `—` together |
| Cajero without `view_reports` hits a thrown error | Med | Tiles hidden via `can('view_reports')`; the server still refuses |

## Rollback Plan

Additive and revertible in one commit. `reports.cashFlow` has no caller outside the Dashboard: delete the module and the Dashboard block and the screen returns to its current two tiles. `by_createdAt` is additive — no field added, widened or narrowed, no document changes, so dropping it needs no migration and no backfill. No Dexie version bump, so nothing client-side to rebuild.

## Dependencies

- Owner decision, non-blocking for spec/design: should `purchases.remove` stay a hard delete when it silently rewrites a past period's expenses?
- No new runtime dependency.

## Success Criteria

- [ ] Income and expenses are summed on the SERVER; the query returns numbers, not documents.
- [ ] It throws for an employee lacking `view_reports`, proven by a test — not only hidden in the UI.
- [ ] A window past the cap returns `truncated: true` and the screen says the figure is partial.
- [ ] A refunded sale counts as income in its sale period and expense in its refund period; past figures do not change.
- [ ] Offline, all three tiles show `—`.
- [ ] `ganancias` / `utilidad` appear nowhere in the UI copy.
- [ ] `pnpm test:run` green (482 existing plus new) and `pnpm lint` clean, with zero `src/styles/` diff.
