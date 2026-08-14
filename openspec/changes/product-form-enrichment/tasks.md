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

## Unit 2 — Product photo (first use of Convex File Storage) — DONE

- [x] 2.1 `convex/schema.ts`: add `imageId: v.optional(v.id('_storage'))` to `productFields`.
- [x] 2.2 `convex/products.ts`: a `generateUploadUrl` mutation behind `manage_products`. The binary never travels through a mutation payload.
- [x] 2.3 (RED) `tests/convex/products.test.ts`: `list` returns an image address ONLY for products that have a photo; attaching, replacing and removing a photo each round-trip.
- [x] 2.4 `convex/products.ts` `list`: resolve `ctx.storage.getUrl(imageId)` per photographed product and return it as `imageUrl`; products without a photo cost nothing. Widen the returns validator.
- [x] 2.5 REMOVE `glyph` from `productFields`, from the form, and from every render. Ships in the SAME commit as the photo — removing it first leaves products with no visual identity at all.
      **Corrected during implementation, twice:**
      (a) `saleItemValidator.glyph` STAYS. It is a frozen snapshot of a line item at sale time, and every sale already stored carries it; dropping it from the validator invalidates real financial history, which Convex would then refuse to read. It is tolerated legacy: no longer written, no longer rendered, never removed.
      (b) `productFields.glyph` cannot simply be deleted either. Convex enforces schema consistency against existing data, so the field must be CLEARED from every product document while it is still declared, and only then dropped — a two-step deploy (2.5a below), not one push.
- [x] 2.5a `convex/migrations.ts`: an `internalMutation` that patches `glyph: undefined` on every product. Deployed, RUN against dev (23 products, 0 left carrying the field), and then DELETED — once the schema stops declaring `glyph` the migration cannot typecheck. **It was deleted BEFORE any commit, so it is not in git history either**; that was recorded here as "it stays in git history", which was wrong. The recipe now lives as a comment on `productFields` in `convex/schema.ts`, because the next deployment to need it will not have the file. Production needed none: it holds no tables at all (verified), so the field-less schema pushes against it cleanly.
- [x] 2.5b The placeholder is the product's INITIAL, not a generic icon: `Clients.tsx` (`clientGlyph`) and `Suppliers.tsx` already answer "no image" that way, and offline — where a photographed product has no address to render — an initial still tells two products apart. Reuses the existing box classes, so X.2 holds.
- [x] 2.6 `src/screens/Products.tsx`: upload control in the form (pick file → upload → save the returned id), photo in the list row and the detail sheet, with a neutral placeholder behind it and an `onError` fallback so a failed fetch never shows a broken image.
- [x] 2.7 (RED→GREEN) `tests/components/`: a product with no photo renders the placeholder; a photographed product renders the image; a failed image falls back to the placeholder; OFFLINE a photographed product renders the placeholder and stays searchable and sellable.
- [x] 2.8 Confirm the Dexie mirror is unaffected: the product document (now carrying `imageUrl`) round-trips through `useMirroredQuery` untouched, and nothing tries to cache the binary.

## Unit 3 — Base unit and fractional quantities — DONE

- [x] 3.1 `convex/schema.ts`: `productUnitValidator` — a closed union of the thirteen catalogue values (piece, bottle, crate, can, jar, bag, pack, keg, pallet, liter, milliliter, kilogram, gram), optional on `productFields`, absent meaning piece. Custom is NOT shipped (see design decision 6). Export ONE shared list of which units are MEASURED, so 'may this be fractional' is derived and can never disagree with the unit.
- [x] 3.2 (RED) `tests/convex/sales.test.ts` + `tests/convex/purchases.test.ts`: a fractional quantity survives checkout and a purchase — totals, stock decrement and stock increment all correct. **The server needs no change** (`snapshotLines` validates only `qty > 0`, `sales.ts:139`); these tests exist to PIN that tolerance so a future guard does not silently break weighed products.
- [x] 3.3 `convex/products.ts`: `create`/`update` accept `unit`.
- [x] 3.4 (RED) `tests/components/`: the quantity input accepts `1.5` for a kilogram product and refuses a fraction for a whole-unit product, **in the same cart**.
- [x] 3.5 `src/screens/Sale.tsx`: make the four `parseInt(…replace(/\D/g, '')…)` sites unit-aware (lines ~355, ~365, ~669, ~680). Integer path stays byte-identical for `'unit'` products, including the `MAX_QTY` cap; the weighed path allows a decimal separator and clamps to live stock.
- [x] 3.6 `src/screens/Suppliers.tsx`: the purchase form's quantity stepper follows the same per-product rule.
- [x] 3.7 Display: quantity and unit shown together wherever a quantity appears (`Sale`, `Scan`, `Products`, `Payment` receipt lines). **The receipt question is answered YES**, on the terms the spec already set: a bare `1.5` on a fiscal line does not say 1.5 of what, and the reason the number can be fractional at all is the unit. Shown whenever the line is not exactly one COUNTED unit, omitted for the default — where a bare number has always meant what it means.
- [x] 3.8 `src/screens/Products.tsx`: unit selector in the form (a `cat-select`, like every other dropdown).

**Decided while building, and worth keeping:**

- [x] 3.9 `convex/units.ts` is the catalogue and it is PURE (no `v`, no `ctx`), so `schema.ts` BUILDS `productUnitValidator` from it with a spread rather than restating the thirteen literals. The union stays exact — the compiler rejects `'parsec'` at a call site — and a unit added to the catalogue cannot be one the server rejects.
- [x] 3.10 `saleItemValidator` gained an optional `unit`, frozen with the line like `sku` and `cat`. Without it a receipt reprinted next year reads today's unit, or none at all once the product is deleted. Written only for a non-default unit, so every line already stored stays exactly as it is.
- [x] 3.11 `src/lib/qty.ts` — ONE parser and ONE formatter for every quantity field, because the spec's promise is that a quantity accepted in the cart is accepted in a purchase. A measured field takes both `.` and `,` (a Spanish keyboard gives the comma) and deliberately drops thousands grouping: `es` writes one thousand as `1.000`, and a field that groups cannot also carry a decimal.
- [x] 3.12 `inputMode` follows the unit — `decimal` for measured, `numeric` otherwise. On the phone this app runs on, a numeric keypad has no separator key, which would leave a weighed product unsellable.

## Unit 4 — The SKU derives itself from the name

> Added after Unit 2, at the owner's request: the user should not invent a code.
> Depends on nothing in Unit 3, so it can ship before it.

- [x] 4.1 `convex/sku.ts`: a PURE module — no Convex imports — exporting `skuFromName` and `nextFreeSku`. Pure so the form and the server derive the same code from the same name; imported client-side through the existing `@convex/*` alias, which both `vite.config.ts` and `tsconfig.app.json` already declare.
- [x] 4.2 (RED) `tests/convex/sku.test.ts`: accents folded, punctuation inside a word not fragmenting it (`Harina P.A.N. 1kg` → `HARINA-PAN-1KG`), length bounded at a word boundary, a name with no usable characters still producing a SKU, and the suffix sequence skipping taken codes.
- [x] 4.3 `convex/schema.ts`: `.index('by_sku', ['sku'])`. Uniqueness is decided by a range read over that index, so the check never scans the catalogue.
- [x] 4.4 (RED) `tests/convex/products.test.ts`: `create` takes NO `sku` and stores a derived one; three products from the same name get the code, `-2` and `-3`; renaming a product leaves its SKU untouched.
- [x] 4.5 `convex/products.ts` `create`: drop `sku` from the args, derive it, and resolve collisions in ONE indexed prefix read rather than probing one candidate per query. Bound that read and fail loudly if the bound is hit — never silently reuse a code.
- [x] 4.6 (RED→GREEN) `tests/components/`: the SKU field is not editable, previews the code while the name is typed, and shows the STORED SKU when editing rather than re-deriving it from the name.
- [x] 4.7 `src/screens/Products.tsx`: read-only SKU field, and stop sending `sku` on create and on update.

## Unit 4 addendum — guards the review surfaced

> Found while reviewing Unit 4, all in . Each one is the same
> shape: a rule that held in one function and not in its neighbour.

- [x] 4.8  deleted the product document and left its photo in storage.  already deletes a replaced blob, for the reason written there — a file nothing points at has no owner and no way to be found again.
- [x] 4.9  kept its own  check instead of , whose docblock claims it is applied at EVERY entry point.  is false and  carries NaN, so a NaN stock got through and poisoned every catalogue total derived from it.
- [x] 4.10 / accepted a  or  that no longer exists. A reference validator checks the SHAPE of an id, never that the document is still there.
- [x] 4.11  read ONE row, correct only because its caller happens to skip the check when the code is unchanged.
- [x] 4.12 The photo upload had no size limit (phone cameras hand back 8-12 MB; this runs on Venezuelan mobile data), and the preview's object URL was never revoked.

## Unit 4 addendum — guards the review surfaced

> Found while reviewing Unit 4, all in `convex/products.ts`. Every one is the
> same shape: a rule that held in one function and not in its neighbour.

- [x] 4.8 `remove` deleted the product document and left its photo in storage. `update` already deletes a replaced blob, for the reason written there — a file nothing points at has no owner and no way to be found again.
- [x] 4.9 `adjustStock` kept its own `stock < 0` check instead of `assertProductNumbers`, whose docblock claims it is applied at EVERY entry point. `NaN < 0` is false and `v.number()` carries NaN, so a NaN stock got through and poisoned every catalogue total derived from it.
- [x] 4.10 `create`/`update` accepted a `categoryId` or `supplierId` that no longer exists. A reference validator checks the SHAPE of an id, never that the document is still there, and the screen renders a dangling category as an empty label with no error.
- [x] 4.11 `assertBarcodeIsFree` read ONE row, correct only because its caller happens to skip the check when the code is unchanged.
- [x] 4.12 The photo upload had no size limit — a phone camera hands back 8-12 MB per shot and this runs on Venezuelan mobile data — and the preview's object URL was never revoked.

> Two claims the review made that were checked and rejected, recorded so they
> are not chased again: that `sku` was a newly-required field needing a
> widen-migrate-narrow (it is required since before this change, and every live
> product carries one), and that `Icon.tsx` was unformatted (`prettier --check`
> passes, and feeding Prettier the proposed alternative returns the file's own
> form).

## Cross-cutting — do these regardless of unit order

- [x] X.1 `src/screens/Products.tsx` carries `(e: any)` in its form setter (`:150`). The file is being edited and the pre-commit review blocks on `any`; narrow it from `unknown` at the boundary the way `Stored.tsx`/`Suppliers.tsx` already do.
- [x] X.2 **No new CSS.** `src/styles/` is a verbatim port and `designs/products.jsx` predates all three fields. Before reusing any prototype class, read its own rules — media queries, `flex`, `grid-template-areas` with `> .child` assignments. Two precedents already paid for: `.search-results` collapses to zero height inside `.client-form`, and `.cartrow` needs a `.thumb` first child.
- [ ] X.3 Keep each commit to roughly 4-6 code files. The review hook now has 900s of headroom, but a large screen file still dominates a review.
- [ ] X.4 Follow-up, NOT in this change: replacing or deleting a photo leaves the previous file in storage with no cleanup.
