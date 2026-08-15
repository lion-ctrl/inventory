# Tasks: Dashboard Cash Flow

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~425 (see `design.md` §File Changes & Line Forecast for the per-file table) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR — internal Unit 1 (server) → Unit 2 (client), `size:exception` |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

**Budget exception — GRANTED, not pending.** Design forecasts ~425 changed lines
against the 400-line guard (25 over). The owner was asked and **explicitly accepted
a single PR at ~425**. Per `design.md`, the two available trims (folding
window-inclusivity into the happy-path test — already applied below; cutting half
the selector test) still land at ~408, still over, for a real coverage loss, so the
design does not take them and does not split into chained PRs. **Do not re-litigate
this at apply time**; the exception is recorded here so it reads as authorised, not
missed.

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High
```

8 files touched in this one PR — exceeds the ~4-6-files/commit guideline in
`openspec/config.yaml`; consider two internal commits (Unit 1 server, Unit 2
client) inside the single PR for reviewability, not two PRs.

### Suggested Work Units (both land in ONE PR — not a chain)

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 — Server | `reports.cashFlow` + `by_createdAt` + `by_refundDate` | PR 1 (single, exception) | `pnpm vitest run tests/convex/reports.test.ts` | N/A — read-only query, no side effects; proven entirely by convex-test via `pnpm test:run` | Delete `convex/reports.ts` + the two new index lines in `convex/schema.ts`; no caller outside the Dashboard |
| 2 — Client | 3 tiles, period selector, `periodBounds` | PR 1 (single, exception) | `pnpm vitest run tests/lib/period.test.ts tests/components/dashboard-cash-flow.test.tsx tests/components/dashboard-offline.test.tsx` | Manual: `pnpm dev`, load Dashboard as `owner`/`cajeroVoid`, switch `Mes`/`Semana`/`Día`, confirm 3 tiles + Egresos caption; go offline, confirm all three blank | Revert the Dashboard.tsx cash-flow block, `src/lib/period.ts`, and the 3 touched test files; screen returns to 2 tiles |

## Phase 1: Foundation — Server Schema (Unit 1)

- [x] 1.1 `convex/schema.ts`: add `purchases.index('by_createdAt', ['createdAt'])` — table today only has `by_supplier` (leads on `supplierId`), so a global period range would scan. Reflow the existing one-line `.index(...)` chain to 3 lines per `design.md`.
- [x] 1.2 `convex/schema.ts`: add `sales.index('by_refundDate', ['refund.date'])`. Note in the diff comment: the nested path on the OPTIONAL `refund` field typechecks because `v.optional()` preserves `FieldPaths` (verified against installed `convex@^1.36.1`); a non-refunded sale (`refund.date === undefined`) self-excludes from a `gte` bound with **no `filter`** — the project guideline forbids `filter`.

## Phase 2: Server — `reports.cashFlow` (Unit 1, RED then GREEN)

RED tasks 2.1–2.10 target the not-yet-created `convex/reports.ts`. Write each in
`tests/convex/reports.test.ts`, run it (e.g. `pnpm vitest run tests/convex/reports.test.ts`),
and observe it fail before starting 2.11.

- [x] 2.1 RED — Denied: `fx.cajeroPlainToken` (`manage_clients` only) → throws. Proves `view_reports` is enforced server-side, independent of any UI.
- [x] 2.2 RED — Granted: `fx.ownerToken` and `fx.cajeroVoidToken` (holds `view_reports`, `convex/seed.ts:501`) both return figures. Pins the accepted `sales.history`-permission-reuse consequence.
- [x] 2.3 RED — Happy path + inclusivity: income 500 / expenses 300 / net 200, exactly the six keys, no documents or items; a sale exactly at `from` and one exactly at `to` count, one at `to + 1` does not.
- [x] 2.4 RED — Empty window: `income`/`expenses`/`net` all 0, does not throw.
- [x] 2.5 RED — Invalid window (`to < from`): throws a Spanish `ConvexError`.
- [x] 2.6 RED — Refund of an OLD sale, sold **~90 days before** the window and refunded inside it: the window's `expenses` includes it and `salesCount` does not; the sale's own period `income` is byte-identical before and after. Set `refund.date` via `t.run(ctx => ctx.db.patch(...))` (`sales.refund` stamps `Date.now()`, cannot aim at a past period). Proves `by_refundDate` is exact, not a lookback heuristic.
- [x] 2.7 RED — Refund inside its own window: the sale contributes to both `income` and `expenses`, netting to 0. Proves it is correct double-appearance, not double-counting or silent dedup.
- [x] 2.8 RED — Cap hit, sales side: `limit: 1` with 2 in-window sales → `truncated: true`, and the numeric figures are still returned. Pins the "figures ship WITH `truncated`" ruling.
- [x] 2.9 RED — Cap hit, **refund** side: `limit: 1` with 2 in-window refunds, 1 sale, 1 purchase → `truncated: true`. Proves the third probe exists; without it the refund read caps silently and `expenses` reports low.
- [x] 2.10 RED — Cap hit, purchases side: `limit: 1` with 2 purchases, 1 sale → `truncated: true`. Proves the flag is OR'd across all three reads, not per-side.
- [x] 2.11 GREEN — Create `convex/reports.ts`: `cashFlow` query, object syntax, `args` + `returns` validators, `requireSession` → `requirePerm(employee, 'view_reports')`; three indexed `[from,to]` reads — `sales.by_soldAt` → income/salesCount, `sales.by_refundDate` → expenses, `purchases.by_createdAt` → expenses/purchasesCount — each its own `cap + 1` probe (`CASH_FLOW_MAX_ROWS = 3000`, optional `limit` clamps down only); `truncated` = OR of all three; `net = round2(income - expenses)`. Passes 2.1–2.10.

## Phase 3: Client — Dashboard Cash-Flow Tiles (Unit 2, RED then GREEN)

RED tasks 3.1–3.2 target the not-yet-created `src/lib/period.ts`; RED tasks 3.4–3.9
target the not-yet-wired `src/screens/Dashboard.tsx`. Write, run, and observe each
failure before its paired GREEN task.

- [x] 3.1 RED `tests/lib/period.test.ts` — `periodBounds` for `dia`/`semana`/`mes`: `from` is local midnight, `to` is local `23:59:59.999`, `to - from === 86_399_999` for a day. Assert as **relative invariants**, never a hard-coded UTC-4 offset — the CI runner's `TZ` is not controlled.
- [x] 3.2 RED — Near-midnight boundary: a `soldAt` at 23:50 local on the last day of the month satisfies `from <= soldAt <= to` for that month and fails it for the next (the spec's UTC-4 scenario, expressed without a timezone dependency).
- [x] 3.3 GREEN — Create `src/lib/period.ts`: pure `periodBounds(period, now)` helper satisfying 3.1–3.2.
- [x] 3.4 RED `tests/components/dashboard-cash-flow.test.tsx` (jsdom) — Happy path: `Ingresos`/`Egresos`/`Diferencia` render numbers; `/ganancia|utilidad/i` matches nothing.
- [x] 3.5 RED — Truncated: `truncated: true` **with real numbers** in the mock → all three tiles show `—`, no figure. The test that makes the server-returns-figures ruling safe.
- [x] 3.6 RED — Offline: fresh offline, no cached result → all three `—` plus `No disponible sin conexión`, alongside the already-passing sales tiles.
- [x] 3.7 RED — Permission denied: `can: () => false` → the three labels and the selector are absent, nothing throws.
- [x] 3.8 RED — Egresos caption: the exact pinned string (`Egresos = solo compras a proveedores. No incluye alquiler, sueldos ni servicios.`) is in the document as text, not a `title` attribute.
- [x] 3.9 RED — Selector: `Mes` carries `.on` by default; no control navigates to a previous period; no comparison figure exists.
- [x] 3.10 GREEN — Modify `src/screens/Dashboard.tsx`: `period` state (default `'mes'`) + memoised `periodBounds(period, new Date())`; `useQuery(api.reports.cashFlow, token && can('view_reports') ? { token, from, to } : 'skip')`; `cashBlank = cashFlow === undefined || cashFlow.truncated === true` drives all three tiles; add the `.seg` selector as a **grandchild**, never a direct child, of `.dash-hero-stats` (wrap `<div><div className="seg">…</div></div>` — `.dash-hero-stats > div` (0,1,1) would otherwise overwrite `.seg` (0,1,0)); reuse only `.dash-hero-stats > div`, `.k`, `.v`, `.t-body-sm`, `.seg` — zero new CSS. Passes 3.4–3.9.
- [x] 3.11 Fix `tests/components/dashboard-offline.test.tsx`: the `useQuery` mock (`() => H.salesHistory.current`) ignores which query is called, so once 3.10 lands it would feed sales-history data into the cash-flow tiles too. Make it dispatch on the function reference (`api.sales.history` vs `api.reports.cashFlow`). Confirm both existing tests in this file still pass.

## Phase 4: Verification

- [x] 4.1 Run `pnpm test:run` — 482 existing + 18 new (2 unit + 10 convex + 6 component) all green. Confirmed: `npx vitest run --maxWorkers=2` → 69 files, 500 passed, 4 pre-existing skips unchanged, exit code 0.
- [x] 4.2 Run `pnpm lint` (`tsc -b && eslint`) clean — the `['refund.date']` index path is a real typecheck surface, not a formality.
- [x] 4.3 Run `git diff --stat src/styles/` — confirm empty (pixel-fidelity contract; no `src/state/db.ts` version bump — neither table is Dexie-mirrored).
- [x] 4.4 Cross-check `proposal.md` Success Criteria: server-only aggregation (no docs/items returned), permission throw is server-enforced not only hidden, a truncated window blanks the whole block, a refund splits without rewriting the past, offline blanks all three tiles, `ganancias`/`utilidad` appear nowhere in the UI copy.

## Carried Forward — Not a Task

`purchases.remove` hard-deletes and silently lowers a past period's `expenses`
(`cash-flow-report` spec, "Known Limitation" requirement). Named and accepted as a
gap in the proposal and specs; explicitly out of scope for this change — no task
here implements or tests a fix.
