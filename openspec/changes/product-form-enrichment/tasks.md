> Three capabilities, three work units, in dependency order: the supplier link is
> the cheapest and closes the loop with `suppliers-purchases`; the photo is the
> app's first use of file storage; the base unit is last because it touches every
> quantity input in the app. **Written BEFORE implementation** — unlike
> `suppliers-purchases`, these boxes are a plan, and TDD means the test is written
> and observed FAILING before the code that satisfies it.

## Unit 1 — Preferred supplier on the product — DONE

- [x] 1.1 `convex/schema.ts`: add `supplierId: v.optional(v.id('suppliers'))` to `productFields`. Optional — every existing product document must stay valid with no backfill.
- [x] 1.2 (RED) `tests/convex/products.test.ts`: create/update round-trips the supplier; clearing it removes the field; a product without one is unaffected.
- [x] 1.3 `convex/products.ts`: `create` and `update` accept `supplierId`; an empty patch value CLEARS it, following the optional-field contract `suppliers.update` already uses.
- [x] 1.4 (RED) `tests/convex/suppliers.test.ts`: deleting a supplier referenced by a product is refused with a Spanish message pointing at deactivation, and both survive; deactivating that supplier keeps the product's link intact.
- [x] 1.5 `convex/suppliers.ts` `remove`: add the product guard alongside the existing purchases guard, resolved through an index — a `first()` hit, not a count. **Needs a `by_supplier` index on `products`** (`convex/schema.ts`) so the guard never scans the catalogue.
- [x] 1.6 `src/types.ts`: widen `Product`. `src/screens/Products.tsx`: supplier picker in the form fed by `useSuppliers()`, and the supplier shown on the product detail (marked when inactive).
- [x] 1.7 (RED→GREEN) `tests/components/`: the form saves and clears the supplier; an inactive supplier still displays, marked; the picker renders for a user with `manage_products` but not `manage_suppliers`.

## Unit 2 — Product photo (first use of Convex File Storage)

- [ ] 2.1 `convex/schema.ts`: add `imageId: v.optional(v.id('_storage'))` to `productFields`.
- [ ] 2.2 `convex/products.ts`: a `generateUploadUrl` mutation behind `manage_products`. The binary never travels through a mutation payload.
- [ ] 2.3 (RED) `tests/convex/products.test.ts`: `list` returns an image address ONLY for products that have a photo; attaching, replacing and removing a photo each round-trip.
- [ ] 2.4 `convex/products.ts` `list`: resolve `ctx.storage.getUrl(imageId)` per photographed product and return it as `imageUrl`; products without a photo cost nothing. Widen the returns validator.
- [ ] 2.5 REMOVE `glyph`: from `productFields`, from `saleItemValidator`'s snapshot, from the form, and from every render. Ships in the SAME commit as the photo — removing it first leaves products with no visual identity at all.
- [ ] 2.6 `src/screens/Products.tsx`: upload control in the form (pick file → upload → save the returned id), photo in the list row and the detail sheet, with a neutral placeholder behind it and an `onError` fallback so a failed fetch never shows a broken image.
- [ ] 2.7 (RED→GREEN) `tests/components/`: a product with no photo renders the placeholder; a photographed product renders the image; a failed image falls back to the placeholder; OFFLINE a photographed product renders the placeholder and stays searchable and sellable.
- [ ] 2.8 Confirm the Dexie mirror is unaffected: the product document (now carrying `imageUrl`) round-trips through `useMirroredQuery` untouched, and nothing tries to cache the binary.

## Unit 3 — Base unit and fractional quantities

- [ ] 3.1 `convex/schema.ts`: `productUnitValidator` — a closed union of the thirteen catalogue values (piece, bottle, crate, can, jar, bag, pack, keg, pallet, liter, milliliter, kilogram, gram), optional on `productFields`, absent meaning piece. Custom is NOT shipped (see design decision 6). Export ONE shared list of which units are MEASURED, so 'may this be fractional' is derived and can never disagree with the unit.
- [ ] 3.2 (RED) `tests/convex/sales.test.ts` + `tests/convex/purchases.test.ts`: a fractional quantity survives checkout and a purchase — totals, stock decrement and stock increment all correct. **The server needs no change** (`snapshotLines` validates only `qty > 0`, `sales.ts:139`); these tests exist to PIN that tolerance so a future guard does not silently break weighed products.
- [ ] 3.3 `convex/products.ts`: `create`/`update` accept `unit`.
- [ ] 3.4 (RED) `tests/components/`: the quantity input accepts `1.5` for a kilogram product and refuses a fraction for a whole-unit product, **in the same cart**.
- [ ] 3.5 `src/screens/Sale.tsx`: make the four `parseInt(…replace(/\D/g, '')…)` sites unit-aware (lines ~355, ~365, ~669, ~680). Integer path stays byte-identical for `'unit'` products, including the `MAX_QTY` cap; the weighed path allows a decimal separator and clamps to live stock.
- [ ] 3.6 `src/screens/Suppliers.tsx`: the purchase form's quantity stepper follows the same per-product rule.
- [ ] 3.7 Display: quantity and unit shown together wherever a quantity appears (`Sale`, `Scan`, `Products`, `Payment` receipt lines). Decide the receipt case — see the design's open questions.
- [ ] 3.8 `src/screens/Products.tsx`: unit selector in the form (a `cat-select`, like every other dropdown).

## Cross-cutting — do these regardless of unit order

- [x] X.1 `src/screens/Products.tsx` carries `(e: any)` in its form setter (`:150`). The file is being edited and the pre-commit review blocks on `any`; narrow it from `unknown` at the boundary the way `Stored.tsx`/`Suppliers.tsx` already do.
- [ ] X.2 **No new CSS.** `src/styles/` is a verbatim port and `designs/products.jsx` predates all three fields. Before reusing any prototype class, read its own rules — media queries, `flex`, `grid-template-areas` with `> .child` assignments. Two precedents already paid for: `.search-results` collapses to zero height inside `.client-form`, and `.cartrow` needs a `.thumb` first child.
- [ ] X.3 Keep each commit to roughly 4-6 code files. The review hook now has 900s of headroom, but a large screen file still dominates a review.
- [ ] X.4 Follow-up, NOT in this change: replacing or deleting a photo leaves the previous file in storage with no cleanup.
