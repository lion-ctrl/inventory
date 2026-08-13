## Why

The product form carries what the POS needs to *sell* an item — name, SKU, barcode, price, stock, IVA exemption, paused flag — and nothing about where it comes from or what it looks like. Two gaps became concrete once `suppliers-purchases` landed:

- The store now records **who it buys from** and **what arrived**, but a product does not say which supplier it usually comes from. When stock runs low, the person reordering has to remember. The reference form from the **Inventario** app puts a SUPPLIERS section right on the item; that section is now cheap to honour because `suppliers.list` already exists and is session-gated precisely so other forms can pick one.
- A product is identified in every list, cart line and receipt by a hand-picked **emoji** (`glyph`, defaulting to 📦). It works, and it works offline, but a cashier scanning a shelf of six similar items gets six identical boxes. The same reference form offers a photo.

The third gap is narrower and only matters if the store sells anything by weight or volume: **quantity is integer-only**, enforced in the UI (`Sale.tsx` strips every non-digit through `parseInt(…replace(/\D/g, ''))`). Selling 1.5 kg of anything is impossible to type today. Notably the SERVER already tolerates it — `snapshotLines` validates only `qty > 0` (`convex/sales.ts:139`) — so this is a client-side constraint, not a data-model one.

Deliberately **not** in this change: multi-location stock. It was on the reference form and was considered and declined — stock would stop being a number on the product and become a per-location record, which reaches into checkout, `sales.syncOffline`, the cart reconciliation pass, the Dexie mirror and the purchases just built. It deserves its own change, or none.

## What Changes

- **NEW `supplierId` on products (optional)** — one preferred supplier per product, set from the product form through a picker fed by `suppliers.list`. Optional so every existing product stays valid, and singular because the purchase history already records who was *actually* bought from each time; this field answers "who do I call to reorder", not "who has ever supplied this".
- **`suppliers.remove` learns a second guard** — a supplier referenced by a product cannot be deleted, the same way one with purchases cannot. Retiring stays the intended path (`active: false`).
- **NEW `imageId` on products (optional)** — a Convex File Storage reference plus a client upload flow. This is the app's **first** use of file storage; nothing else stores binaries today.
- **`glyph` is REMOVED** — owner decision, taken after the consequence was stated: storage addresses are network-backed and are not in the Dexie mirror, so a photographed product cannot render offline and there is no longer an emoji underneath it. Offline, products are told apart by name, SKU and barcode; a neutral placeholder fills the space so nothing ever renders broken or blank. The removal ships *with* the photo, never before it — taking the emoji out first would leave products with no visual identity at all.
- **NEW `unit` on products (optional)** — a fixed catalogue taken from the reference app, absent meaning the default counted unit. The catalogue mixes two genuinely different things and the model separates them: **counted** units (the default, plus bottle, crate, can, jar, bag, pack, keg, pallet) are labels and keep quantity whole; **measured** units (litre, millilitre, kilogram, gram) permit fractional quantities. Whether decimals are allowed is *derived* from the unit rather than configured beside it, so the two can never disagree.
- **Quantity becomes unit-aware in the CLIENT** — the Venta stepper, the cart-line quantity input, the stock caps and the purchase form accept decimals for weighed products and keep integer-only behaviour for everything else. The backend needs no change: it already accepts any positive quantity.
- **Product form gains three fields** — supplier picker, photo, base unit — alongside the existing ones. The reference form's BASICS/STOCK/SUPPLIERS/PHOTO grouping is adopted only as far as the prototype's existing classes allow.

## Capabilities

### New Capabilities

- `product-supplier-link`: a product may name one preferred supplier, chosen from the supplier base; the link is optional, survives the supplier being retired, and blocks the supplier from being deleted.
- `product-photo`: a product may carry a photograph stored in Convex File Storage, which replaces the emoji as its visual identity; a neutral placeholder covers every case where no image can be shown, including offline.
- `product-base-unit`: a product declares the unit it is sold in, from a catalogue that separates counted packagings from measured weights and volumes, and quantity entry follows that declaration everywhere a quantity is typed or displayed.

### Modified Capabilities

<!-- None re-specified. `supplier-registry` gains one more deletion guard, which strengthens an existing requirement rather than changing its contract. `offline-data-mirror` and `offline-write-blocking` are unaffected: the new fields ride inside the already-mirrored product document, and the product form's writes are already blocked offline. -->

## Impact

- **Backend / convex** — `convex/schema.ts`: `productFields` gains `supplierId`, `imageId` and `unit`, all optional (additive, no backfill). `convex/products.ts`: `create`/`update` accept the three fields; `list` resolves each photo to a URL. `convex/suppliers.ts`: `remove` also refuses when a product references the supplier. A new upload-URL mutation for file storage.
- **Client / src** — `src/screens/Products.tsx`: three new form fields plus photo rendering in the list and detail. `src/screens/Sale.tsx`: unit-aware quantity input and stock caps (four `parseInt(…\D…)` sites). `src/screens/Suppliers.tsx`: the purchase form's quantity stepper becomes unit-aware too. `src/screens/Scan.tsx` and `src/screens/Payment.tsx`: display quantity and unit together. `src/types.ts`: the widened `Product`.
- **Design fidelity** — `designs/products.jsx` predates all three fields, and `src/styles/` is a verbatim CSS port that gains no classes, so every new control reuses an existing class. Two traps already documented in `suppliers-purchases` apply again: a prototype class can depend on the container it was written for (`.search-results` collapses inside `.client-form`) and on its sibling structure (`.cartrow` needs a `.thumb`).
- **Dependencies** — none. Convex File Storage is part of the platform.
- **Tests** — convex: the three fields round-trip through create/update; `products.list` returns a URL only when a photo exists; the supplier-deletion guard; fractional quantities survive checkout and purchase. Component: the form saves and clears each field; the quantity input accepts decimals only for weighed products; a product with no photo falls back to its emoji; offline a photographed product still renders its emoji.
- **Data** — additive. Existing products keep working with all three absent: no supplier, no photo, unit reads as `unit`. No migration, no backfill.
- **Out of scope** — multi-location stock; unit conversion (buying in one unit and selling in another); several suppliers per product; price-per-unit-of-measure display ("$/kg"); photo cropping, compression or multiple images; and mirroring photos for offline display.
