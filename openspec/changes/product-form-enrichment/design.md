## Context

`productFields` (`convex/schema.ts`) has been stable since the port: barcode, sku, name, price, stock, minStock, categoryId, plus three optional flags (`exempt`, `glyph`, `sellable`). Products are Dexie-mirrored, so the whole catalogue lives on the client and every screen filters an in-memory array — that is the offline-first contract and it stays untouched here.

Three facts were checked against the repo before designing, and each one moved a decision:

1. **Convex File Storage has never been used.** `ctx.storage` appears nowhere in `convex/`. The photo is the first binary this app stores, so the upload flow, the URL resolution and their costs are all new ground rather than an extension of something existing.
2. **The server already accepts fractional quantities.** `snapshotLines` validates `if (!(line.qty > 0))` (`convex/sales.ts:139`) and nothing downstream rounds. `purchases.create` uses the same `isPositiveNumber` shape.
3. **The client is what forbids them.** `Sale.tsx` reads quantities with `parseInt(e.target.value.replace(/\D/g, ''), 10)` in four places — every non-digit is stripped before parsing, so a decimal point cannot even be typed. `MAX_QTY = 1000000` and the stock caps assume integers too.

That third pair inverts the expected shape of the base-unit work: it is a client change with a schema field, not a money-path migration.

## Goals / Non-Goals

**Goals:**
- Answer "who do I reorder this from" without leaving the product form.
- Let a product be recognised by sight online, without ever leaving it faceless offline.
- Make it possible to sell 1.5 kg, without making it possible to sell 1.5 staplers.
- Add three optional fields with no migration, no backfill and no new CSS.

**Non-Goals (declined, not deferred by omission):**
- Multi-location stock — considered against this same reference form and dropped: it turns `stock` from a field into a table and reaches into checkout, `syncOffline`, cart reconciliation, the mirror and purchases.
- Several suppliers per product. The purchase history already records every supplier actually used.
- Unit conversion between purchase and sale (buy by the sack, sell by the kilo).
- Offline photos. See decision 5.
- Photo editing of any kind: crop, compress, rotate, multiple images.

## Decisions

**1. One optional preferred supplier, not a list.**
`supplierId: v.optional(v.id('suppliers'))`. A join table would model "every supplier that has ever sold us this", which the `purchases` history already answers precisely and with dates. This field answers a different, operational question — who to call — and that question has one answer at a time. Optional because most of the catalogue will never have it set, and because every existing product must stay valid.

**2. A referenced supplier cannot be deleted.**
`suppliers.remove` already refuses when purchases exist; it gains the same guard for products. Without it, a product would hold a dangling `supplierId`, and unlike a purchase — which freezes `supplierName` — the product has no snapshot to fall back on, so the form would show an empty picker with no explanation. Retiring (`active: false`) stays the intended path and leaves the link intact; an inactive supplier still displays on the product, marked, because it is historically true.

**3. The photo is a storage id on the product; the URL is resolved server-side in `list`.**
`imageId: v.optional(v.id('_storage'))`. The client uploads to a URL minted by a new mutation, then saves the returned id with the product — the standard Convex flow, and the only one that keeps the binary out of the mutation payload.

`products.list` resolves `ctx.storage.getUrl(imageId)` per photographed product and returns `imageUrl`. The alternative — returning bare ids and letting each screen resolve them — multiplies queries by the number of products on screen, which is worse for the same total work. The cost is one extra `await` per **photographed** product on the app's most-used query; products without a photo cost nothing. This is acceptable for a catalogue bounded by the business (hundreds), and it is the same bounded-by-the-business reasoning that keeps `products.list` uncapped for the Dexie mirror. If the catalogue ever grows past that, the mirror is the thing that breaks first, not this.

**4. `glyph` is removed, and the photo replaces it. Owner decision.**
The first draft of this design kept the emoji as the identity of last resort. The owner decided otherwise, twice, after the consequence was put in writing. It is removed: not stored, not asked for, not displayed.

The consequence, recorded so nobody later reports it as a bug: **storage addresses are network-backed and are not in the Dexie mirror**, so a disconnected register cannot fetch them, and there is no longer an emoji underneath. Offline, a photographed product renders as a neutral placeholder and is told apart by name, SKU and barcode. Mirroring the binaries would mean copying the catalogue's images into IndexedDB with quota management (FEATURES §21) this app does not have.

**5. The removal ships WITH the photo, never before it.**
Taking the emoji out on its own would leave every product with no visual identity at all — worse than either end state. The two changes are one commit.

**6. The unit catalogue mixes two different things, and the model separates them.**
The reference app offers Piece, Bottle, Crate, Can, Jar, Bag, Pack, Keg, Pallet, Liter, Milliliter, Kilogram, Gram, Custom. Read it closely and it is two lists: **packaging forms**, where nobody sells 1.5 bottles and the value is a label, and **measurements**, where 1.5 comes off a scale and means something. Choosing "bottle" over "piece" changes nothing but the word on screen; choosing "kilogram" changes what may be typed.

So `unit` is a closed union of the thirteen values, absent meaning the default counted unit, and "may this be fractional" is **derived** from it through one shared list rather than stored as a second field. Two fields could disagree; a derivation cannot.

**Custom is deliberately not shipped.** It buys a free-text unit at the cost of either a second field or a loosened validator, and every unit this store actually uses is already in the list. Adding it later is one optional string.

Price stays *per base unit*. There is no conversion anywhere: a product priced per kg is bought in kg and sold in kg. The moment purchase and sale units differ, cost accounting appears — and this app deliberately has none.

**7. Fractional quantity is a client concern, and it is enforced per product.**
The server needs no change. The client currently strips non-digits before parsing; that becomes conditional on the line's product unit:
- `unit` → integer-only, exactly today's behaviour, including the `MAX_QTY` cap.
- `kg` / `l` → decimals allowed, bounded by the same live stock cap, formatted to a sensible precision.

The rule lives with the product, not with the input, so the same cart can hold three staplers and 1.5 kg of coffee. Every place a quantity is typed follows it: the Venta stepper, the cart line, and the purchase form in `Suppliers.tsx`.

**8. No new CSS, again.**
`designs/products.jsx` predates all three fields. The supplier picker reuses the existing sheet-and-`lrow` pattern; the photo control reuses the form-field classes; the unit selector is a `cat-select` like every other dropdown. Two traps already paid for in `suppliers-purchases` are pre-conditions here: a prototype class can assume its container (`.search-results` collapses to zero height inside `.client-form`) and its siblings (`.cartrow` needs a `.thumb` first child). Read the class's own rules — media queries, `flex`, `grid-template-areas` — before reusing it.

## Risks / Trade-offs

- **A photo that fails to load looks like a bug even when it is the design.** Mitigated by decision 4: the emoji is always underneath, so the failure mode is "no photo" rather than "broken image".
- **`products.list` grows an await per photographed product.** Bounded by the catalogue, which is already bounded by the mirror. Worth measuring once real photos exist rather than optimising blind.
- **Fractional quantities meet money rounding.** `1.5 × 4.33` does not land on a cent. Totals already pass through `round2`, so this is not new — but it becomes reachable through the UI for the first time, and the split-payment tolerance (0.011) is where it will show up first if anywhere.
- **Storage has no cleanup.** Replacing a product's photo, or deleting the product, leaves the old file in storage. Not a correctness problem; worth a follow-up before the catalogue turns over a few times.
- **`Products.tsx` carries `(e: any)` in its form setter.** Pre-existing, but the file is being edited, and the pre-commit review blocks on it. Budget the cleanup rather than discovering it at commit time.

## Migration Plan

Additive and non-destructive; no backfill.

1. Deploy the schema: three optional fields on `products`. Every existing document stays valid, and every screen keeps working with all three absent.
2. Deploy functions and client. A product with no supplier, no photo and no unit renders exactly as it does today.
3. No operational step. Unlike `manage_suppliers`, nothing here is permission-gated beyond the existing `manage_products`.

Rollback is a deploy of the previous functions; the three fields can stay on the documents harmlessly, or be dropped since nothing reads them.

## Open Questions

- Should a low-stock product surface its preferred supplier on the Dashboard's low-stock tile, so reordering starts from where the shortage is noticed?
- Does the receipt show quantity with its unit ("1.5 kg"), or is that noise on a fiscal document?
- When a photo is replaced, is the old file deleted immediately, or swept later?
