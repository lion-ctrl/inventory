# Remove Reserved Stock ("productos en espera") — Removal Plan

> **PLAN ONLY.** This document describes the removal; it changes no code. It is a
> concrete, phased, screen-by-screen plan in the same style as
> [`OFFLINE_FIRST_PLAN.md`](./OFFLINE_FIRST_PLAN.md) — real files, real lines,
> real symbol names.

## The owner's decision (the intent)

Today, parking a sale (**"venta en espera"**) **reserves** its products: their
units are subtracted from availability so another cashier can't sell them. The
owner finds this confusing and bug-prone (*"están en el mismo stock pero a la vez
no"*). New rule:

- **Parking a sale does NOT reserve stock. Stock is always LIVE.** Any cashier
  can sell any product; a parked cart holds nothing in the system.
- The cashier reserves **physically** (sets the items aside). If another cashier
  sells those units, they're sold — and when the parked sale is **RESUMED**, the
  system must handle that the stock is now gone (tell the cashier *"ya no hay"*,
  let them drop/adjust the line).
- **Held sales STAY** — park / resume / discard and the held-carts list all
  remain. **ONLY the STOCK RESERVATION is removed**: the *apartado*, the
  "en espera" quantity chip, and every availability block based on it.

### Naming caveat — what "en espera" means where

There are **two different "en espera"** in this codebase. Keep them straight:

| "en espera" as… | Meaning | Verdict |
|---|---|---|
| The **feature name** — route `/ventas-en-espera`, screen title "Ventas en espera", the pause-circle nav badge | The parked-sales list | **KEEP** — untouched |
| A **reserved-units quantity** — the `{n} en espera` warn chip, the availability subtraction | The stock reservation | **REMOVE** |

Files that only reference the *feature name* — `AppShell.tsx:43,158-161,319`,
`Dashboard.tsx:126-128`, `Stored.tsx` (whole screen) — are **not touched by this
plan**. `Stored.tsx` never reads `useCart().reserved`; it only uses
`heldCarts` / `resumeSale` / `discardStored` / `pauseSale`, all of which stay.

---

## What "reserved" is today — the 3 layers

### Layer 1 — Backend backstop (`convex/sales.ts`)

The authoritative check. Sums units held across **all** parked carts and refuses
a checkout that would exceed `physical − reserved`.

- `reservedByProductMap(ctx)` — **`convex/sales.ts:179-191`**. Collects every
  `heldCarts` row and sums `item.qty` per `productId`.
- `assertStockAvailable(lines, reservedMap, onInsufficient)` — **`199-214`**.
  Generic guard: `qty + reserved > product.stock` → throws. **Shared** by both
  callers.
- **`checkout`** uses the backstop — **`332-346`**: builds `reservedMap` (336)
  and calls `assertStockAvailable` with the "hay N en espera" message (337-346).
- **`syncOffline`** already **ignores** it — **`440-445`**: it calls
  `assertStockAvailable(lines, new Map(), …)` (empty map ⇒ physical-stock only,
  per our recent phase-6.3 change). A consummated offline sale outranks pending
  holds. **checkout is the last caller that still passes a real reserved map.**
- `heldCarts.park` — **`convex/heldCarts.ts:43-45`** — snapshots from live
  products and **does not consume stock**. That's already correct and stays.

### Layer 2 — CartContext overlay (`src/state/CartContext.tsx`)

Turns the held-carts list into a `productId → reservedQty` map for the UI.

- Interface field + doc — **`41-42`**: `reserved: Record<string, number>`.
- The `reserved` memo — **`164-172`**: aggregates `heldCarts[].items[].qty` per
  product (client-side mirror of `reservedByProductMap`).
- Exposed on the context value — **`203`**; listed in the value memo deps —
  **`277`**.

### Layer 3 — UI chips / banners / caps (Scan, Products, Sale)

Everything the cashier sees or is blocked by, all fed by `useCart().reserved`.

**`src/screens/Scan.tsx`** (info-only — never sells):
- `ProductInfoSheet` `reservedUnits` prop — **`23`, `30-31`**; chip — **`49-51`**.
- `useCart().reserved` — **`148-149`**; tile chip — **`290-292`**; prop pass —
  **`315`**.

**`src/screens/Products.tsx`** (info-only chip):
- Card component `reservedUnits` prop — **`56`, `62-63`**; chip — **`74-76`**.
- Detail-sheet component `reservedUnits` prop — **`364`, `374-375`**; chip —
  **`406-409`**.
- `useCart().reserved` — **`793-794`**; prop passes — **`1167`, `1248`**.

**`src/screens/Sale.tsx`** (the heavy one — this is where reserved actually
*blocks* selling):
- `CartItemRow` `reservedUnits` prop — **`290`, `298-299`**; **stepper cap** —
  **`302-308`** (`item.stock - reservedUnits`).
- `ProductFoundSheet` `reservedUnits` prop — **`494`, `502-503`**; `maxAddable` —
  **`508-511`** (`product.stock - reservedUnits - currentCartQty`); `available` —
  **`512-515`** (`product.stock - reservedUnits`); `reservedBlocks` — **`533`**;
  `cartHoldsMax` — **`534`**; `showLimitedInfo` — **`536-541`**; reason clause —
  **`542-544`**; warn chip — **`606-609`**; "Unidades en espera" DANGER banner —
  **`720-727`**.
- `ManualSearchSheet` `reserved` prop — **`827`, `832-833`**; chip — **`935-936`**.
- Cart-panel component `reserved` prop — **`972`, `990-991`**; passes
  `reservedUnits` down to `CartItemRow` — **`1061`**.
- `SaleScreen` (main): destructures `reserved` — **`1317`**; scan-add gate —
  **`1475`** (`product.stock - (reserved[id]||0) - inCart <= 0`); `availableCap`
  — **`1501-1503`** (feeds `inc` at 1508 and `setQty` at 1519); catalog-tile chip
  — **`1717-1718`**; and the per-call-site `reservedUnits` / `reserved` props on
  the sheets/rows in **both the wide and narrow layout branches** — **`1786`,
  `1927`, `1961`, `2009`** (narrow) and **`2199`→`setQty`, `2203`, `2223`,
  `2257`, `2303`** (wide).

> **KEEP, do not touch:** the **physical** guards in `ProductFoundSheet` that do
> NOT reference reserved — `insufficientStock = totalQty > product.stock`
> (**`523`**) and the confirm `disabled={insufficientStock || maxAddable < 1}`
> (**`759`**). After removal `maxAddable` becomes `product.stock - currentCartQty`
> and these still correctly cap a single cart at **live physical stock**. We are
> removing the cross-cart *reservation term*, not the physical-stock cap.

---

## Remove vs Keep

| | Item | File:line | Action |
|---|---|---|---|
| **REMOVE** | `reservedByProductMap` | `sales.ts:179-191` | delete |
| **REMOVE** | reserved backstop in `checkout` | `sales.ts:336-346` | validate physical only (mirror `syncOffline`) |
| **REMOVE** | `reserved` context field + memo | `CartContext.tsx:41-42,164-172,203,277` | delete |
| **REMOVE** | every "N en espera" chip | Scan, Products, Sale | delete |
| **REMOVE** | reserved terms in Sale caps/gates/banners | `Sale.tsx` (see Layer 3) | drop the `- reserved…` term; delete reserved-only banners |
| **KEEP** | park / resume / discard mutations | `heldCarts.ts` | unchanged |
| **KEEP** | held-carts list + "Ventas en espera" screen | `Stored.tsx`, nav, routes | unchanged |
| **KEEP** | physical-stock guards (single-cart cap, `insufficientStock`) | `sales.ts` totals, `Sale.tsx:523,759` | unchanged |
| **KEEP** | `syncOffline` physical-only validation | `sales.ts:440-445` | already correct |
| **ADD** | resume reconciliation vs LIVE stock | `CartContext.resumeSale` | new (see below) |

---

## The counterpart to ADD — resume reconciliation vs LIVE stock

Removing the reservation means a parked cart can go stale: another cashier may
have sold the units while it sat. The catch point moves from *park-time blocking*
to **resume-time reconciliation**.

`CartContext.resumeSale` (**`CartContext.tsx:228-266`**) **already reconciles**
against live products — it drops **deleted** lines silently (**`239`**) and drops
**paused** (`sellable === false`) lines with a by-name notice via `pausedRemovals`
(**`240-243`, `247-248`**), surfaced as the Venta acknowledge modal
(`Sale.tsx:1405`… paused-removals sheet).

**The ADD:** extend that same loop (**`237-245`**) to also check **live
`product.stock`**:

- For each resumed line, compare held `it.qty` against live `live.stock`.
- If `live.stock <= 0` → drop the line and record it as *"ya no hay"* (out of
  stock now).
- If `0 < live.stock < it.qty` → **clamp** `qty` to `live.stock` and record it as
  *"stock reducido"* (only N left).
- Surface these the same way paused lines are surfaced today: either extend
  `pausedRemovals` into a small structured notice or add a sibling
  `shortRemovals` state reusing the same modal plumbing
  (`setPausedRemovals`/`dismissPausedRemovals` pattern, `CartContext.tsx:84,
  160-161,208`). Copy suggestion: *"{name}: ya no hay stock — se quitó de la
  venta"* / *"{name}: solo quedan {n} — se ajustó la cantidad."*

**No backend change for resume.** `heldCarts.resume` (**`heldCarts.ts:76-103`**)
already just returns the snapshot and deletes the row; reconciliation stays
**client-side** against `useProducts()` live stock — exactly how paused/deleted
are handled today. This keeps the change consistent with the existing pattern.

---

## Step-by-step removal plan (phased, low-risk → delicate)

Each phase compiles and its tests pass on its own. Recommended order:

### Phase 1 — Informational chips: Scan + Products  *(low-risk, cosmetic)*

Purely visual "N en espera" chips; removing them changes no behavior. They read
`useCart().reserved` but leaving that field on the context for now means no type
break.

- **Scan.tsx**: delete the `reservedUnits` prop from `ProductInfoSheet`
  (`23,30-31`) and its chip (`49-51`); delete the tile chip (`290-292`); stop
  destructuring `reserved` (`148-149`) and passing it (`315`).
- **Products.tsx**: delete `reservedUnits` from both the card (`56,62-63`) and
  detail-sheet (`364,374-375`) components and their chips (`74-76`, `406-409`);
  stop destructuring `reserved` (`793-794`) and passing it (`1167,1248`).

### Phase 2 — Sale.tsx caps, gates, banners  *(delicate — sell-time behavior)*

Drop every `- reservedUnits` / `- (reserved[id]||0)` **term** (keep the physical
`item.stock` / `product.stock` cap), and delete the reserved-only chips/banners.

- `CartItemRow`: remove `reservedUnits` prop (`290,298-299`); stepper cap
  (`305-308`) becomes `item.stock` (physical only).
- `ProductFoundSheet`: remove `reservedUnits` (`494,502-503`); `maxAddable`
  (`508-511`) → `product.stock - currentCartQty`; `available` (`515`) →
  `product.stock`; delete `reservedBlocks` (`533`) and simplify `cartHoldsMax`
  (`534`) to `nothingAddable && currentCartQty > 0`; `showLimitedInfo`
  (`540-541`) → `!nothingAddable && currentCartQty > 0`; drop the reserved reason
  part (`544`); delete the warn chip (`606-609`) and the "Unidades en espera"
  DANGER banner branch (`720-727`), keeping the `cartHoldsMax` / out-of-stock
  branches. **Leave `insufficientStock` (523) and the disabled rule (759).**
- `ManualSearchSheet`: remove `reserved` prop (`827,832-833`) and chip
  (`935-936`).
- Cart-panel component: remove `reserved` prop (`972,990-991`) and the
  `reservedUnits={…}` pass-through to `CartItemRow` (`1061`).
- `SaleScreen`: stop destructuring `reserved` (`1317`); scan gate (`1475`) →
  `product.stock - inCart <= 0`; `availableCap` (`1501-1503`) → `item.stock`;
  delete the catalog-tile chip (`1717-1718`); remove the `reservedUnits` /
  `reserved` props at every call site in **both layout branches** (`1786,1927,
  1961,2009` and `2203,2223,2257,2303`).

### Phase 3 — Backend backstop in `checkout`  *(delicate, but isolated)*

Independently shippable and unit-testable; no UI coupling.

- Delete `reservedByProductMap` (`179-191`).
- In `checkout`, remove the reserved map + backstop block (`336-346`). Validate
  **physical stock only**, exactly like `syncOffline` does — either call the
  simplified guard with an empty map or inline `qty > product.stock`.
- Simplify `assertStockAvailable` (`199-214`) to a plain physical check (drop the
  `reservedMap` parameter). `syncOffline` (`440-445`) adapts to the new signature
  and keeps throwing `STOCK_INSUFFICIENT`. Keep checkout's Spanish
  "Stock insuficiente" message (drop only the "hay N en espera" branch).

### Phase 4 — CartContext overlay  *(cleanup — safe once Phases 1-2 land)*

Now that no screen reads `reserved`, delete it:

- Remove the interface field + doc (`41-42`), the memo (`164-172`), the value
  entry (`203`), and the dep (`277`).

### Phase 5 — Resume reconciliation  *(the ADD — new behavior)*

Implement the LIVE-stock reconcile in `resumeSale` (`228-266`) as described
above. This is where oversell-relative-to-holds is caught.

---

## Tests to update

**Backend — `tests/convex/sales.test.ts`** — the `describe('sales.checkout —
reserved ("en espera") availability')` block (**`250-313`**):
- **`266-283`** *"rejects qty 5 when 1 unit is held"* → **REMOVE / INVERT.** With
  the backstop gone, qty 5 against physical 5 now **succeeds**. Replace with a
  test asserting checkout sells the full physical stock even while a held cart
  exists (stock → 0, the held cart still present).
- **`285-298`** *"allows qty 4 when 1 unit is held"* → still passes on physical
  stock, but rename/refocus to "checkout validates physical stock only" (the
  "1 unit is held" premise is now irrelevant).
- **`300-312`** *"park is NOT blocked by reserved units"* → **KEEP** (park still
  neither consumes nor is blocked).

**Context — `tests/state/contexts.test.tsx`** — **`258-267`** *"reserved stock
aggregates held-cart quantities per product"* → **REMOVE** (`reserved` no longer
exists). **ADD** a `resumeSale` reconcile test: a held line short on live stock is
clamped/dropped and surfaces the notice.

**Component tests — DELETE (assert the removed chips/caps/banners):**
- `tests/components/scan-en-espera.test.tsx`
- `tests/components/products-en-espera.test.tsx`
- `tests/components/sale-en-espera.test.tsx`
- `tests/components/sale-stepper-cap.test.tsx` (caps at physical − reserved)

**Component test — PRUNE — `tests/components/sale-product-found-availability.test.tsx`:**
drop the reserved-driven cases (`101-118`, `151-197`) and remove `reservedUnits`
props from the survivors; **keep** the physical-only / valid-max / cart-holds-max
cases (`65-100`, `135-150`, `199-236`).

**Mock shape cleanup (low priority):** several cart mocks declare
`reserved: Record<string, number>` / pass `reserved: {}` — they compile as-is but
should shed the field once the context type drops it:
`sale-cancel-stays`, `sale-exempt-chip`, `sale-iva-rounding`, `sale-totals-order`,
`sale-paused-modal`, `products-offline-blocking`, `scan-offline`.

---

## Doc consistency — `guides/OFFLINE_FIRST_PLAN.md` follow-ups

Not edited here (PLAN ONLY), but these lines reference reserved and should be
reconciled when the removal lands so the two plans agree:
- **`640`** (Phase 6.3): "Share `snapshotLines` + the reserved backstop with
  `checkout`" — the backstop is gone; only `snapshotLines` + physical validation
  are shared.
- **`703-704`, `711`** (Phase 8): the "reserved-stock overlay
  (`CartContext.tsx:128-136`)" and "reserved-stock math still reduces Venta
  availability offline" — both removed.
- **`300`** (Phase 1) and **`460`** (Phase 5): the `useCart().reserved` consumer
  notes for Products/Scan — no longer consumed.

---

## Consequences

- **Sales can now oversell relative to parked holds — that is the point.** Two
  cashiers can each sell the last unit of a product that a third cashier parked;
  stock is live for everyone. Physical single-cart caps and the server's
  physical-stock guard still prevent selling more than actually exists at the
  moment of sale.
- **The catch moves to RESUME.** A parked cart that lost its stock is reconciled
  when resumed (Phase 5): the cashier is told *"ya no hay"* / *"stock reducido"*
  and the line is dropped or clamped — the same UX family as the existing
  paused/deleted-line handling.
- **`checkout` and `syncOffline` fully converge** on physical-stock validation,
  removing the last behavioral difference between the online and offline sale
  paths (and the `assertStockAvailable` reserved parameter that only existed to
  serve `checkout`).
