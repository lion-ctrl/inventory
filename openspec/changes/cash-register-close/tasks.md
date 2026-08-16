# Tasks: Cash Register Close

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~852 (design) — Slice 1 ~480, Slice 2 ~375 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (server, ~480) → PR 2 (screen, ~375) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Owner decided, binding — not re-opened.** Mode `auto` + owner explicitly chose 2 slices, overriding the cached `single-pr` strategy: Slice 1 re-merges design's PR1+PR2 (`create`+`list`, ~365+115) into one ~480-line unit — ~80 over the 400 budget, accepted deliberately so Slice 1 proves expected-figure computation end to end before any UI tile exists, and each slice stays small enough to be read, not skimmed. "Reverted entirely on its own" implies each slice merges to main before the next starts → `stacked-to-main` (inferred from that wording, not a literal owner label — flagged in the return envelope's risks).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `closes` table + `create`/`list`; expected computation proven end to end | PR 1 | `pnpm test:run tests/convex/closes.test.ts` | N/A — no UI until Slice 2; `convexTest` is the full harness | Delete `convex/closes.ts` + `closes` schema block + `types.ts` `Close` alias; nothing else imports them yet |
| 2 | Count sheet + history wired to Slice 1; offline/permission gating | PR 2 | `pnpm test:run tests/components/cash-close.test.tsx` | `pnpm dev` → `/cierre-de-caja`, submit a count, confirm blind reveal + history row | Delete `src/screens/CashClose.tsx` + 3 `AppShell.tsx` lines + nav entry; Slice 1 stays intact |

## Slice 1 — Server (PR 1, ~480 lines)

### Phase 1: Foundation

- [x] 1.1 `convex/schema.ts`: add `closeFields` (all required, D6) + `closeDocValidator`/`publicCloseDocValidator` (`cashierId` stripped, AUTH-2 — matches `saleDocValidator` pattern) + `closes` table with `by_cashier_closedAt`, `by_closedAt`. No new `sales` index (D2).
- [x] 1.2 `src/types.ts`: `export type Close = Omit<Doc<'closes'>, 'cashierId'>;` (matches `Sale`/`Purchase`).

### Phase 2: RED — `tests/convex/closes.test.ts` (write, run, OBSERVE FAILING)

Harness: `convexTest(schema, modules)` + `seedBase`/`mintSession` (`tests/convex/fixtures.ts`); sales planted via `t.run(ctx.db.insert('sales', …))` per `tests/convex/reports.test.ts:32-62`.

- [x] 2.1 Mixed sale `splits:[{cash,10},{transfer,40}]` (stored `method:'cash'`) → `expectedUsd 10`, not 50 — proves `splits`, not `method`, is authoritative.
- [x] 2.2 Sale A `entered:3600@rate 36`, Sale B `entered:4000@rate 40`, rate bumped before closing → `expectedBs 7600` — proves sum of `entered`, never reconverted.
- [x] 2.3 Transfer-only sale + a purchase in-window → both currencies 0 — proves non-drawer splits and purchases never counted.
- [x] 2.4 Card-only $50 sold W1, refunded W2 → W1 unaffected, W2 `expectedUsd -50`; mixed refund (`cash_bs entered:1000`+`card 20`) → `expectedBs -1000`, `expectedUsd -20` — proves refund charged to `refund.date`'s window via `by_refundDate`.
- [x] 2.5 No query under `api.closes` (only `create`,`list`) exposes an open window's expected before `create` runs — proves blind-count ordering.
- [x] 2.6 Close twice → second row's `openedAt === first.closedAt`; `openedAt` passed with a prior close → `ConvexError('El cierre continúa desde tu cierre anterior; no puedes elegir la fecha de inicio.')` — proves the window is unnameable, not merely rejected.
- [x] 2.7 First close, no `openedAt` → `ConvexError('Indica desde cuándo cuenta este primer cierre.')`.
- [x] 2.8 Cashiers A and B both sell; A closes → figures reflect only A's `cashierId`.
- [x] 2.9 `Object.keys(api.closes)` is exactly `['create','list']` — proves immutability.
- [x] 2.10 `cajeroPlain` (no `view_reports`): `create` succeeds under own id; `list({scope:'all'})` → `ConvexError('Sin permisos para esta acción.')`; own `list()` returns; `ownerToken` `list({scope:'all'})` returns — proves permission denial (close-own vs read-another's).
- [x] 2.11 Expected 100/5000, counted 95/5000 → `differenceUsd -5`, `differenceBs 0`.
- [x] 2.12 Window sales probe exceeds `CLOSE_MAX_SALES` (1000) → `create` throws `ConvexError('El período es demasiado largo para cerrar. Cierra la caja con más frecuencia.')` — proves over-cap refuses (D3), not flags.

### Phase 3: GREEN — `convex/closes.ts`

- [x] 3.1 `create`: derive window from `by_cashier_closedAt` (`prev.closedAt`, or required finite `args.openedAt` when no prior close); `to = Date.now()`; reject `openedAt` when `prev` exists and reject its absence otherwise; guard non-finite/negative counted amounts (`'Los montos contados no son válidos.'`) and an invalid `openedAt` (`'La fecha de apertura no es válida.'`).
- [x] 3.2 `create`: probe `sold`/`refunded` via `by_soldAt`/`by_refundDate` with `.take(CLOSE_MAX_SALES + 1)`, throw over cap; accumulate `expectedUsd/Bs` from own-`cashierId` `splits ?? []`, subtract refund pass per split kind; `round2` (`convex/money.ts`) all four figures; insert; return `publicCloseDocValidator`.
- [x] 3.3 `list`: `scope:'own'` → `requireSession` only; `scope:'all'` → + `requirePerm(actor,'view_reports')` (`convex/permissions.ts`); `by_closedAt`, capped + `truncated`.
- [x] 3.4 Run `pnpm test:run tests/convex/closes.test.ts` — all 12 green; `pnpm lint` clean.

### Phase 4: Slice 1 close-out

- [x] 4.1 Run full `pnpm test:run` (516 + 12 = 528) green, `pnpm lint` clean.
- [x] 4.2 Confirm rollback boundary: reverting `convex/closes.ts` + the schema block + the `types.ts` alias leaves the pre-existing 516 green (nothing else depends on `closes` yet).

## Slice 2 — Screen (PR 2, ~375 lines, bases on Slice 1 merged)

### Phase 5: RED — `tests/components/cash-close.test.tsx` (jsdom; write, run, OBSERVE FAILING)

Harness follows `tests/components/dashboard-cash-flow.test.tsx`: `vi.mock('convex/react')` dispatching on `getFunctionName`, plus `@/state/SessionContext`, `@/state/useOnline`, `@/state/usePendingSales`.

- [ ] 5.1 Initial render: two blank count inputs, no `Efectivo esperado`/`Diferencia` anywhere; after a resolved `closes.create` mock, `Diferencia` (USD, Bs) render as two separate figures — proves screen-side blind ordering.
- [ ] 5.2 `online:false` → action disabled + connection-required message; `online:true` + `usePendingSales()` one pending op → still disabled — proves offline refusal lives on the screen (server cannot see the Dexie queue).
- [ ] 5.3 `can('view_reports')` false → cashier-picker control absent (`queryBy…toBeNull`), own history still lists; true → control present — proves hidden, not disabled.

### Phase 6: GREEN — Screen + wiring

- [ ] 6.1 `src/screens/CashClose.tsx`: count sheet (`.card`/`.card-padded`/`.sec-head`/`.client-field`); expected/difference in `useState(null)`, set only from `create`'s resolved value; reveal via `.prod-stats`/`.prod-stat` (+`.danger`/`.warn`, no `.ok`); history via `.lrow` (first child MUST be `.thumb` — same trap as `.cartrow`, `History.tsx:851-853` precedent); cashier picker (`view_reports` only) via `.catalog-filter`+`.input.cat-select` (no `.seg`, D7). No new CSS — reuse only design-verified classes.
- [ ] 6.2 `src/AppShell.tsx`: add `ROUTE_IDS` entry (`/cierre-de-caja`), nav item (`close`, `Cierre de caja`, `coins`), `<Route>`; `<Guard>` with no `perm` (session-only close).
- [ ] 6.3 Wire offline refusal: `disabled = !online || usePendingSales().length > 0 || !countsValid`, reason stated in Spanish beside the button; unsynced `closes.list` shows connection-required, same as `History`'s `salesUnavailable` (no Dexie mirror for `closes`).
- [ ] 6.4 Run `pnpm test:run tests/components/cash-close.test.tsx` — all 3 green; `pnpm lint` clean.

### Phase 7: Slice 2 close-out

- [ ] 7.1 Run full `pnpm test:run` (528 + 3 = 531) green, `pnpm lint` clean, `git diff --stat src/styles/` empty.

## Notes (carried, non-normative — per design's Recorded Limitations)

- `splits ?? []` in 3.2 means a legacy sale with no `splits` contributes zero, silently — expected, not a defect to fix.
- The unsynced check (6.3) is per-device only; a second device's pending queue stays invisible.
- A first close's `openedAt` is unbounded backwards; hitting `CLOSE_MAX_SALES` there is an intended honest refusal — case 2.12's Spanish message must read as an actionable remedy, not a dead end.
