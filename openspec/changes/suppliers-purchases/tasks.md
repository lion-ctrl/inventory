> Two work units. Unit 1 is the supplier base end to end (schema, permission,
> functions, screen, offline contract); Unit 2 is the purchase that raises stock.
> **These artifacts were written AFTER the code landed** — the change was built
> conversationally and specced afterwards to regularize the process, so the boxes
> below record what exists rather than a plan to follow. Tasks 3.x remain genuinely
> open.

## Unit 1 — Supplier base — DONE

- [x] 1.1 `convex/schema.ts`: `supplierFields` mirroring `clientFields` (same `taxPrefixValidator` + `taxId`, flat `address`) plus `contactName` / `mobile` / `paymentTerms` / `website` / `notes` / `active` / `createdAt`; `supplierDocValidator`; `suppliers` table indexed `by_taxId` on `['taxPrefix','taxId']`.
- [x] 1.2 `convex/schema.ts`: add `manage_suppliers: v.optional(v.boolean())` to `permissionsValidator` — optional so pre-existing employee documents stay schema-valid and an absent key reads as `false`.
- [x] 1.3 `convex/permissions.ts`: widen `PermissionId` with `'manage_suppliers'`; note in `can()` that a missing key is fail-closed.
- [x] 1.4 `src/lib/rbac.ts`: add the permission to `PermissionId` and to `PERMISSIONS` (positioned between `manage_clients` and `manage_employees`); redefine `PermissionMap` to mirror `permissionsValidator` exactly (six required + one optional) because the map is sent back on save; rewrite `perms()` to build the object key by key so a new permission fails to compile until handled; export `ALL_PERMISSION_IDS`.
- [x] 1.5 `src/screens/Employees.tsx`: drop the three `Object.fromEntries(...) as PermissionMap` casts in favour of `perms(...)` / `perms(...ALL_PERMISSION_IDS)`.
- [x] 1.6 `convex/suppliers.ts`: `list` (session-gated — the purchase form must pick a supplier), `create` / `update` / `remove` behind `manage_suppliers`; `assertRifIsFree` resolving `by_taxId` with an `exceptId` escape for updates; empty-string optionals omitted on create and cleared on update.
- [x] 1.7 `src/types.ts`: `Supplier`. `src/state/db.ts`: `db.version(3)` adding the `suppliers` store (`_id, name, [taxPrefix+taxId], active, createdAt`). `src/state/useMirroredQuery.ts`: widen `MirrorTable`. `src/state/hooks.ts`: `useSuppliers`.
- [x] 1.8 `src/state/SessionContext.tsx`: clear `db.suppliers` in the pending-ops logout branch alongside the other disposable mirrors (Dexie's variadic `transaction` overloads stop at five stores — use the array form).
- [x] 1.9 `src/screens/Suppliers.tsx` as a structural twin of `Clients.tsx` — list, search, Estado filter, pager, detail sheet, create/edit sheet, delete confirmation. **Every class reused from the prototype**; `src/styles/` gains nothing. `src/components/Icon.tsx` registers `truck`.
- [x] 1.10 `src/AppShell.tsx`: `/proveedores` route behind `<Guard perm="manage_suppliers">`, its `ROUTE_IDS` entry, and the Nav item.
- [x] 1.11 Tests: `tests/convex/suppliers.test.ts` (create defaults to active and drops empty optionals, permission split, duplicate RIF, empty-string clearing, deactivation stays readable, session gating); `tests/convex/fixtures.ts` gains an `admin` employee with granular permissions — never `'all'` — so a permission test cannot pass by accident.
- [x] 1.12 Tests: `tests/components/suppliers-offline-blocking.test.tsx` — offline disables create/edit/delete behind the notice, reads still render, Estado filters the list.

## Unit 2 — Purchases that raise stock — DONE

- [x] 2.1 `convex/schema.ts`: `purchaseItemValidator` (`productId`, frozen `name`, `qty` — no unit cost), `purchaseCurrencyValidator` (`'usd' | 'bs'`), `purchaseFields` (frozen `supplierName`, `items`, `total` USD, `entered`, `currency`, `exchangeRate`, `note?`, `createdBy` + `createdByName`, `createdAt`), `purchaseDocValidator`, and the `purchases` table indexed `by_supplier`.
- [x] 2.2 `convex/purchases.ts` `bySupplier`: session-gated, index-resolved, newest first.
- [x] 2.3 `convex/purchases.ts` `create`: `manage_suppliers`; reject an empty order, non-positive/non-finite quantities and amounts; derive the USD total server-side from `entered` + `currency` + `settings.bsRate` and store the rate with the purchase; refuse a bolívar amount when no positive rate is configured; resolve every product BEFORE patching stock so a missing one aborts the whole order; raise each product's stock.
- [x] 2.4 `convex/purchases.ts` `remove`: `manage_suppliers`; subtract each line clamped with `Math.max(0, …)`; silent no-op on an already-deleted id.
- [x] 2.5 `src/types.ts`: `Purchase`. `src/screens/Suppliers.tsx`: `SupplierPurchases` block inside the supplier detail — history, "Registrar compra", per-purchase delete — stating that the history requires a connection while offline instead of rendering an empty list.
- [x] 2.6 `src/screens/Suppliers.tsx`: `PurchaseForm` in its own Sheet (detail closes first — no stacked sheets): product search, lines with a `qty` stepper, and **two mirrored amount fields** (Bs and $) where the field last typed in is the source of truth; `sanitizeAmount` reused from `Payment.tsx`; delete confirmation states how many units will leave inventory.
- [x] 2.7 Tests: `tests/convex/purchases.test.ts` — stock raised, names and rate frozen, Bs→USD conversion, USD passthrough, permission, empty/zero rejections, all-or-nothing rollback on a deleted product, per-supplier scoping, reversal, reversal clamped at zero.
- [x] 2.8 Tests: the two mirrored amount fields convert both ways and the save button gates on lines + amount (`tests/components/suppliers-offline-blocking.test.tsx`).
- [x] 2.9 Fix: the results list uses `.card`, not `.search-results` — under 700px that class is `flex: 1` and collapses to zero height inside `.client-form`'s scrolling column, hiding the rows. Layout regressions of this kind are not observable in jsdom.

## Unit 3 — Follow-ups (open)

- [ ] 3.1 Grant `manage_suppliers` in Empleados to each admin who should manage the supplier base — until then only the owner (`permissions: 'all'`) sees the section.
- [ ] 3.2 Decide whether spending is reported anywhere beyond the per-supplier history (a period view across suppliers).
- [ ] 3.3 Decide whether a purchase produces a printable "comprobante"; the stored fields already suffice to render one.
- [ ] 3.4 Optional: seed demo suppliers in `convex/seed.ts` (untouched by this change).
- [ ] 3.5 When the product form is restructured, wire its "Add supplier" link against `suppliers.list` and decide whether a product carries one preferred supplier or several.
