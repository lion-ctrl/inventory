# Proposal: Cash Register Close

## Intent

`dashboard-cash-flow` (archived) reports how much money **moved**. It cannot **verify**. Nothing in the app lets a cashier count the physical drawer and learn whether it matches. When cash is short, nobody can be cleared and suspicion falls on everyone. A close is not primarily an anti-theft device — it is what lets an honest cashier hand over a counted drawer and be done.

## Scope

### In Scope

- `closes` table + `closes.create` / `closes.list`: window, cashier, expected, counted, difference — **per currency**.
- **Only `cash` and `cash_bs` reach the drawer**; `card`/`transfer`/`mobile`/`zelle` never do. Expected comes from `sale.splits`, never `sale.total`.
- **Expected Bs = Σ `entered` on `cash_bs` splits** — never `amount × today's rate`. Each sale froze its own `exchangeRate` (`convex/sales.ts:278`); converting backwards invents a discrepancy and makes an honest cashier look short.
- Per-cashier attribution via the stored `cashierId`. A solo owner is the degenerate case, not a separate feature.
- **Blind count**: the cashier submits counted USD + Bs; the server returns the difference. Expected is never revealed first, or the count proves nothing.
- Immutable once recorded — no update, no delete.
- Requires connection; refuses while that cashier has unsynced offline sales (expected over an incomplete set is a lie).

### Out of Scope

- Editing or voiding a close; opening float / drawer sessions; printing a close receipt.
- Purchases (see Approach); refund attribution (see Dependencies); two cashiers sharing one physical drawer.
- Any `src/styles/` change (verbatim port, pixel-fidelity contract); any Dexie mirror.

## Capabilities

### New Capabilities

- `cash-register-close`: the `closes` table, window derivation, per-currency expected computation, blind count, immutability, permission model.
- `cash-close-screen`: count sheet, difference reveal, close history, offline and permission-denied states.

### Modified Capabilities

- None. `cash-flow-report` and `dashboard-cash-flow-tiles` stay untouched — this answers a different question, it is not a better tile.

## Approach

**Window**: a close covers `(that cashier's previous close .closedAt, now]`. The first close per cashier takes an explicit `openedAt`, recorded on the row, so adopting the feature does not inherit all history.

**`sale.method` MUST NOT be used**: it is `cleanSplits[0].method` (`src/screens/Payment.tsx:132`) — the first row, not an aggregate. Only `splits` is authoritative.

**Permission — no new permission.** Closing your OWN drawer is session-only (operational, like `clients.create`): a cajero rarely holds `view_reports` and must still close. Reading ANOTHER cashier's closes requires `view_reports`, whose copy already promises it — "Ver ventas, cierres e informes" (`src/lib/rbac.ts:39`). AUTH-2 keeps `cashierId` server-side, so scoping is server-side by construction.

**Purchases are NOT counted — verified.** `purchaseFields` (`convex/schema.ts:208`) carries no payment method, so no purchase can be attributed to the drawer. The `purchases.remove` hard-delete limitation recorded in `openspec/specs/cash-flow-report/spec.md` therefore does not apply here.

**Copy (Spanish)**: `Cierre de caja`, `Efectivo esperado`, `Contado`, `Diferencia`, `Sobrante` / `Faltante`.
**Identifiers / DB fields (English)**: `closes`, `closes.create`, `expectedUsd`, `expectedBs`, `countedUsd`, `countedBs`, `differenceUsd`, `differenceBs`, `openedAt`, `closedAt`, `cashierId`, `cashierName`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `convex/schema.ts` | Modified | `closes` table + `by_cashier_closedAt`; likely `sales.by_cashier_soldAt` |
| `convex/closes.ts` | New | `create` / `list` |
| `src/screens/` | New | Close screen + nav entry |
| `src/styles/`, `src/state/db.ts` | Untouched | Pixel-fidelity contract; no Dexie version bump |
| `tests/convex/`, `tests/components/` | New | RED-first per Strict TDD |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bs expected converted at today's rate | High | Sum `entered`; a test pins two sales at DIFFERENT frozen rates |
| Read as another cash-flow report | High | `Cierre de caja` copy; no tile reuse; separate screen |
| Closing over an incomplete sale set (offline / unsynced) | Med | Refuse to close; require connection |
| `sales` has no cashier index — a window read scans | Med | Add `by_cashier_soldAt` (additive) |
| A close recorded on a wrong window cannot be fixed | Med | Accepted — immutability is the point; correct forward in the next close |

## Rollback Plan

Additive and revertible in one commit. `closes` is a new table with no reader outside its own screen: delete `convex/closes.ts`, the screen and the nav entry and nothing else changes. No existing field is added, widened or narrowed; no backfill; no Dexie version bump. Sales are read-only throughout, so a rollback loses close records only — never money data. Any new `sales` index is additive and droppable without migration.

## Dependencies

- No new runtime dependency.
- **BLOCKING owner decision — refunds.** `sale.refund` is `{ date, reason }` (`convex/schema.ts:255`): **no amount, no method**. The app cannot tell whether a refund handed back cash from the drawer or reversed a card charge. The spec MUST NOT assert refund behaviour until the owner answers. Provisional and explicitly undecided: refunds are excluded from expected cash and surfaced as a count so a shortfall can be explained by hand.
- Owner decision, non-blocking: two cashiers sharing ONE physical drawer — per-cashier expected does not map to a single physical count.

## Success Criteria

- [ ] Expected cash counts ONLY `cash` + `cash_bs` splits; a card-heavy sale moves neither figure.
- [ ] Expected Bs equals the sum of `entered`, proven by a test with two sales at DIFFERENT frozen `exchangeRate`s.
- [ ] A close is attributed to a cashier and its window starts at that cashier's previous close.
- [ ] Expected is not returned before the count is submitted.
- [ ] No mutation can edit or delete a close.
- [ ] A cajero without `view_reports` can close their own drawer and cannot read another's.
- [ ] `pnpm test:run` green (516 existing plus new), `pnpm lint` clean, zero `src/styles/` diff.
