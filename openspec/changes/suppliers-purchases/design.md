## Context

The app models one party (`clients`), one money-in flow (`sales`), and a stock number that only ever decreases. `clientFields` (`convex/schema.ts`) already encodes how this store identifies a legal entity in Venezuela: a `taxPrefix` (`V` | `J` | `E`) plus a `taxId`, a flat `address`, and optional contact fields. `splitItemValidator` already encodes how the app stores an amount that was typed in one currency and must be reasoned about in another: `amount` in USD alongside the raw `entered` value and its `currency`. Both patterns are load-bearing here, and both are reused rather than reinvented.

Two constraints shape the UI before any design choice is made. `designs/` contains no `suppliers.jsx`, and `.prettierignore` declares `src/styles/` a *"Verbatim CSS port from the prototype (pixel-fidelity contract)"* — so a Suppliers screen cannot introduce a single CSS class. `Clients.tsx` is the closest structural analogue (a searchable list of party records with a detail sheet and an edit form), so the screen is built as its twin from the same classes.

## Goals / Non-Goals

**Goals:**
- Record who the store buys from, identified by a RIF that cannot be duplicated.
- Record what arrived from each supplier, in what quantity, and what the whole order cost — and raise stock automatically, so quantities are never re-typed into the catalog.
- Keep the money honest across a moving exchange rate: a purchase registered today must still read the same next month.
- Add no CSS, no dependency, and no breaking schema change.
- Gate the new surface behind its own permission, fail-closed for everyone who does not hold it.

**Non-Goals (explicitly declined by the owner, not deferred by omission):**
- Per-unit cost, cost of goods sold, and profit or margin per product. A single global amount per order cannot attribute cost to a unit; the owner accepted this trade in exchange for a far smaller model.
- Operating expenses (rent, salaries, utilities). A "gasto" here is a supplier purchase and nothing else.
- Purchase orders, partial receiving, and accounts payable. A purchase is recorded after the fact, in one shot.
- Offline purchases. They move stock, which the offline sync engine already re-validates against the server; a second offline stock writer is not worth its conflict surface today.
- A printable purchase voucher.

## Decisions

**1. A supplier is a party record, so it is shaped like a client.**
`supplierFields` mirrors `clientFields` field for field where the concepts coincide — the same `taxPrefixValidator`, the same `taxId`, the same flat optional `address`. The alternative (a supplier-specific identity model, or Inventario's split `Street` / `ZIP` / `City` / `Country (ISO)`) would have produced two ways to write a Venezuelan address and two ways to display a RIF. Supplier-only fields are the ones a client genuinely lacks: `contactName`, `mobile` (separate from `phone` because WhatsApp is a distinct channel here), `paymentTerms`, `website`, `notes`. `paymentTerms` is free text on purpose: "15 días neto", "50% al pedir", "contado" are all real, and an enum would be wrong within a week.

**2. The RIF is unique, enforced through the index.**
`assertRifIsFree` (`convex/suppliers.ts`) resolves `by_taxId` and refuses a collision. Without it, the same distributor entered twice would split its purchase history, and the split would only surface when someone totalled a month. `update` re-checks only when the patch actually moves the RIF, passing its own id as `exceptId`.

**3. Retiring a supplier is `active: false`, not a delete.**
Past purchases point at the supplier row. Deletion stays available for genuine mistakes, but the routine act of dropping a distributor is a state change, so the history survives.

**4. Reads are operational, writes are management.**
`suppliers.list` is `requireSession`-gated only, because the purchase form — and, later, the product form's supplier picker — must be able to pick one, and those users are not necessarily supplier administrators. `create` / `update` / `remove` sit behind `manage_suppliers`. This is exactly the `clients` split, minus the mid-sale walk-in exception, which has no supplier analogue.

**5. `manage_suppliers` is optional in the validator.**
Adding a required boolean to `permissionsValidator` would invalidate every existing employee document against the schema. Declared `v.optional(v.boolean())`, pre-existing rows stay valid and `can()` reads the missing key as `false`. The consequence is deliberate and fail-closed: nobody except the owner (`permissions: 'all'`) gains access until it is granted explicitly. The same optionality forced `PermissionMap` (`src/lib/rbac.ts`) to mirror the validator exactly — six required keys plus one optional — because that map is not only read, it is **sent back** on save and must satisfy the server. That in turn made `Object.fromEntries(...) as PermissionMap` uncompilable, which is a feature: `perms()` now builds the map key by key, so adding a permission fails to compile until it is handled.

**6. A purchase line records quantity, never cost; the money lives once.**
`purchaseItemValidator` is `{ productId, name, qty }`. Freezing `name` (and `supplierName`) follows the sale's client snapshot: renaming a product must not rewrite what a past order says arrived. The global `total` is the owner's decision, and it is what makes this change small — but it is also precisely why profit is unavailable, which the proposal states rather than hides. Adding `unitCost` to this validator later is additive and moves nothing else.

**7. The USD total is derived server-side, and the rate is frozen with the purchase.**
The client sends `entered` + `currency`; `purchases.create` reads `settings.bsRate` once, converts, and stores `total` (USD), `entered`, `currency` and `exchangeRate` together. Two problems are solved at once: a client can never submit a total that disagrees with what was typed, and a purchase registered at 36.5 still reads as the same purchase after the rate moves — the mistake `sales.syncOffline` made with `ivaPct`/`exchangeRate` before Phase 6.5 corrected it. When `currency` is `'bs'` and no positive rate is configured, the mutation refuses and says to enter the amount in dollars.

**8. Receiving is all-or-nothing.**
`create` resolves every product **before** patching any stock, so a deleted product aborts the whole order inside the Convex transaction rather than leaving a half-received purchase behind. Quantities and the amount are validated with `Number.isFinite(n) && n > 0`, because `NaN` or `Infinity` reaching a `stock` field would poison every downstream availability check.

**9. Reversal clamps at zero.**
`remove` subtracts each line's `qty` with `Math.max(0, …)`. The received units may already have been sold, and a negative `stock` would break `snapshotLines`, the Venta steppers, and the cart-reconciliation pass. Clamping loses arithmetic purity and keeps the invariant that matters.

**10. The screen is a twin of Clients, and the purchase form lives inside the supplier.**
No new CSS is possible, so every element reuses a class the prototype already ships. The purchase history and its form are rendered inside the supplier's detail rather than as a separate screen, matching how the owner described it ("se coloca en la parte proveedor"). Opening the purchase form closes the detail first — the same non-stacking pattern `openEdit` uses in `Clients.tsx`.

**11. The supplier list is mirrored; purchases are not.**
`db.version(3)` adds a `suppliers` store additively (Dexie needs no upgrade function for a new store with no data migration). Purchases stay server-only: they are online-only writes, and an empty offline list would read as "you never ordered anything" — so the block states that the history requires a connection, consistent with how the Dashboard sales tiles handle an unavailable figure. The suppliers mirror is cleared on logout with the rest of the disposable mirror.

## Risks / Trade-offs

- **No profit reporting, permanently, until a cost is added.** This is the central trade. The mitigation is honesty: the proposal, this design, and the module header of `convex/purchases.ts` all say it in writing, so nobody looks for a margin figure that cannot exist.
- **Deleting a purchase is the only correction mechanism.** There is no edit and no partial return; a wrong order is deleted (stock reverses) and re-entered. Acceptable at this volume, and it keeps stock movement to exactly two inverse operations.
- **Clamped reversal can silently under-correct.** Deleting an old purchase whose units were already sold leaves stock at 0 rather than negative, so the arithmetic no longer round-trips. Preferred over a negative stock that would break selling.
- **`manage_suppliers` defaults to off for everyone.** Existing admins will not see the section until someone ticks it. This is fail-closed by design, and the proposal records it as an operational step rather than a bug to discover.
- **Reusing prototype classes is context-sensitive.** A class can carry rules that assume the container the prototype used. `.search-results` is `flex: 1` under 700px and collapses to zero height inside `.client-form`'s scrolling column — it was replaced with `.card`. Class reuse must be checked against the class's own media queries and flex rules, not just its name.

## Migration Plan

Additive and non-destructive; no backfill and no data wipe.

1. Deploy the schema: two new tables with their indexes, plus the optional `manage_suppliers` key on `permissionsValidator`. Existing `employees`, `products` and `sales` documents remain valid.
2. Deploy the functions and the client. Existing screens are untouched.
3. The Dexie `db.version(3)` upgrade runs per device on first load; the new store starts empty and fills from the first successful `suppliers.list`.
4. **Operational step:** grant `manage_suppliers` in Empleados to each admin who should manage the supplier base. Until then only the owner sees the section.
5. Optional: seed demo suppliers. `convex/seed.ts` is untouched by this change, so a re-seed neither creates nor destroys suppliers.

Rollback is a deploy of the previous functions plus removing the two tables; no other table is modified, so nothing else needs unwinding.

## Open Questions

- Should a purchase produce a printable "comprobante", as Treinta's plan advertises? Out of scope here; the stored fields (frozen supplier, lines, total, rate, who registered it, when) are already sufficient to render one.
- Where does spending get reported — a period view of purchases across suppliers, or only the per-supplier history the detail sheet shows today?
- When the product form gains its "Add supplier" link, does a product carry one preferred supplier or many? The current model constrains nothing either way.
