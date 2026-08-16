import { defineSchema, defineTable } from 'convex/server';
import { PRODUCT_UNITS } from './units';
import { v } from 'convex/values';

// ---------------------------------------------------------------------------
// Reusable validators (single source of truth — reused in schema, args and
// returns validators across every module).
// ---------------------------------------------------------------------------

export const taxPrefixValidator = v.union(
  v.literal('V'),
  v.literal('J'),
  v.literal('E')
);

export const clientKindValidator = v.union(
  v.literal('person'),
  v.literal('business'),
  v.literal('foreign')
);

export const roleValidator = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('cajero')
);

/** Employee permissions: 'all' (owner sentinel) or a granular boolean map. */
export const permissionsValidator = v.union(
  v.literal('all'),
  v.object({
    view_reports: v.boolean(),
    void_sales: v.boolean(),
    manage_products: v.boolean(),
    manage_clients: v.boolean(),
    manage_employees: v.boolean(),
    manage_settings: v.boolean(),
    // Optional so pre-existing employee rows stay valid. Absent reads as FALSE
    // through `can()`, so the supplier base opens only to whoever is granted it
    // explicitly — never by silent inheritance.
    manage_suppliers: v.optional(v.boolean()),
  })
);

/** Client snapshot embedded in sales / held carts (frozen at sale time). */
export const clientSnapshotValidator = v.object({
  name: v.string(),
  taxPrefix: v.string(),
  taxId: v.string(),
  kind: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(v.string()),
});

/** Sale line-item snapshot (frozen product data at sale/park time). */
export const saleItemValidator = v.object({
  productId: v.id('products'),
  name: v.string(),
  sku: v.optional(v.string()),
  barcode: v.optional(v.string()),
  cat: v.optional(v.string()),
  price: v.number(),
  qty: v.number(),
  glyph: v.optional(v.string()),
  /** Frozen at sale time so a receipt still reads '1.5 kg' years later. */
  unit: v.optional(v.string()),
  exempt: v.optional(v.boolean()),
});

/** One row of a split payment (amounts always in USD). */
export const splitItemValidator = v.object({
  method: v.string(),
  amount: v.number(),
  entered: v.optional(v.number()),
  currency: v.optional(v.string()),
});

/**
 * One line of a supplier purchase: WHAT came in, never at what unit cost. The
 * money lives once, on the purchase's global `total` — the owner records a single
 * amount for the whole order, so per-unit cost (and therefore profit per product)
 * is deliberately out of scope.
 */
export const purchaseItemValidator = v.object({
  productId: v.id('products'),
  /** Frozen at purchase time — renaming the product later must not rewrite history. */
  name: v.string(),
  qty: v.number(),
});

/** Which currency the owner typed the purchase total in. */
export const purchaseCurrencyValidator = v.union(
  v.literal('usd'),
  v.literal('bs')
);

// ---------------------------------------------------------------------------
// Table field maps (exported so modules can build full-doc returns validators
// as v.object({ _id, _creationTime, ...fields }) without duplication).
// ---------------------------------------------------------------------------

export const categoryFields = {
  label: v.string(),
};

/**
 * The unit a product is sold in — built FROM the catalogue in `units.ts` rather
 * than restating it, so a unit added there cannot be one the server rejects.
 * Closed on purpose: a free-text unit is a field every screen would then have to
 * guess the meaning of.
 */
export const productUnitValidator = v.union(
  ...PRODUCT_UNITS.map((unit) => v.literal(unit.id))
);

export const productFields = {
  barcode: v.string(),
  sku: v.string(),
  name: v.string(),
  price: v.number(), // USD
  stock: v.number(),
  minStock: v.number(),
  categoryId: v.id('categories'),
  exempt: v.optional(v.boolean()),
  // NO `glyph`. The product emoji was removed: a photograph identifies a product,
  // and where there is none the catalogue shows the product's initial, which
  // nobody has to pick and which survives offline.
  //
  // PUSHING THIS TO A DEPLOYMENT WHOSE PRODUCTS STILL CARRY `glyph` WILL FAIL.
  // Convex validates existing documents against the schema and rejects fields it
  // no longer declares, and it pushes schema and functions together — so a
  // migration written to fix it cannot land in the same push that breaks. Clear
  // the field FIRST, from a deployment where the schema still declares it:
  //
  //   internalMutation → for each product, ctx.db.patch(id, { glyph: undefined })
  //
  // That one-off was written, run against this project's deployment, and then
  // deleted rather than committed: once the field is gone it no longer typechecks,
  // so keeping it would have meant a cast against a phantom field. Recorded here
  // as a recipe instead, because the next deployment to need it will not have the
  // file either.
  //
  // Note `saleItemValidator` KEEPS its `glyph`: that one is a frozen snapshot of
  // a line as it was sold, carried by every sale already stored, and rewriting
  // financial history to tidy up a decorative field is not on the table.
  // undefined/true = on sale; false = paused
  sellable: v.optional(v.boolean()),
  // The supplier this product is normally reordered from — a reordering hint,
  // never sales data. Optional so every pre-existing product stays valid, and
  // SINGULAR on purpose: `purchases` already records everyone this was actually
  // bought from, with dates. This answers "who do I call", which has one answer.
  supplierId: v.optional(v.id('suppliers')),
  // Convex File Storage reference — the app's first stored binary. Only the id
  // lives on the document; `products.list` resolves it to an address so no
  // screen has to ask per product. Optional: most of the catalogue has none.
  imageId: v.optional(v.id('_storage')),
  // What `price` and `stock` are each PER. Optional, and absent means the default
  // counted unit — which is what every product created before this capability
  // is, so there is no backfill and no visible change for any of them.
  // Whether the product may be sold in fractions is DERIVED from this value
  // (`isMeasured` in `units.ts`) rather than stored beside it: a second flag is
  // a second source of truth, and the day it disagrees you get half a crate.
  unit: v.optional(productUnitValidator),
};

export const clientFields = {
  name: v.string(),
  taxPrefix: taxPrefixValidator,
  taxId: v.string(),
  kind: clientKindValidator,
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(v.string()),
  createdAt: v.number(),
};

// A supplier is a company the store BUYS from. Deliberately mirrors clientFields
// (same RIF pair, same flat `address`, same optional-contact shape) — the two are
// the same kind of party record, and reusing the shape keeps every form, search
// and validator consistent. `paymentTerms` is the one supplier-only concept:
// free text ("15 días neto") because Venezuelan terms are negotiated per deal,
// not picked from a fixed list.
export const supplierFields = {
  name: v.string(),
  taxPrefix: taxPrefixValidator,
  taxId: v.string(),
  /** The human answering the phone at that company. */
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  /** Kept apart from `phone`: WhatsApp is the working channel here. */
  mobile: v.optional(v.string()),
  address: v.optional(v.string()),
  paymentTerms: v.optional(v.string()),
  website: v.optional(v.string()),
  notes: v.optional(v.string()),
  /** false = retired. Never deleted on retire: past expenses still point here. */
  active: v.boolean(),
  createdAt: v.number(),
};

// A purchase placed with a supplier. Registering one RAISES stock by each
// line's qty; deleting one puts it back. Money follows the same contract as a
// payment split: `total` in USD is canonical, while `entered` + `currency` keep
// what the owner actually typed and `exchangeRate` freezes the Bs rate of that
// day — reading the live rate later would silently rewrite past purchases.
export const purchaseFields = {
  supplierId: v.id('suppliers'),
  /** Frozen supplier name, same reason as the line names. */
  supplierName: v.string(),
  items: v.array(purchaseItemValidator),
  /** Global amount for the WHOLE order, in USD. */
  total: v.number(),
  entered: v.number(),
  currency: purchaseCurrencyValidator,
  exchangeRate: v.number(),
  note: v.optional(v.string()),
  createdBy: v.id('employees'),
  createdByName: v.string(),
  createdAt: v.number(),
};

export const employeeFields = {
  name: v.string(),
  email: v.string(),
  phone: v.string(),
  role: roleValidator,
  permissions: permissionsValidator,
  // AUTH-4: PIN is stored as a PBKDF2-SHA-256 hash+salt (never plaintext).
  // Both are lowercase hex strings (see convex/sessions.ts hashPin/verifyPin).
  pinHash: v.string(), // PBKDF2 derived bits, hex-encoded (64 chars / 256 bits)
  pinSalt: v.string(), // random 16-byte salt, hex-encoded (32 chars)
  active: v.boolean(),
  createdAt: v.number(),
  lastActive: v.optional(v.number()),
};

export const saleFields = {
  invoiceNumber: v.string(),
  clientId: v.id('clients'),
  client: clientSnapshotValidator,
  cashierId: v.id('employees'),
  cashierName: v.string(),
  items: v.array(saleItemValidator),
  subtotal: v.number(),
  tax: v.number(),
  total: v.number(), // USD
  method: v.string(),
  splits: v.optional(v.array(splitItemValidator)),
  tendered: v.optional(v.number()),
  ivaPct: v.number(),
  exchangeRate: v.number(), // Bs per $ snapshot at sale time
  soldAt: v.number(),
  refund: v.optional(v.object({ date: v.number(), reason: v.string() })),
  // Offline-first (Phase 6.3): set ONLY by `sales.syncOffline` for sales created
  // offline and later drained by the sync engine. Both are `v.optional`
  // (widen-migrate-narrow) so every pre-existing online sale row stays valid —
  // ADDITIVE, no backfill needed. `idempotencyKey` (minted at ENQUEUE on the
  // client, FEATURES §8-9) lets a replayed sync return the existing sale via the
  // `by_idempotencyKey` index instead of double-charging; `deviceId` is the §19
  // audit trail of which device originated the sale.
  idempotencyKey: v.optional(v.string()),
  deviceId: v.optional(v.string()),
};

export const heldCartFields = {
  code: v.string(),
  clientId: v.optional(v.id('clients')),
  client: v.optional(clientSnapshotValidator),
  cashierId: v.id('employees'),
  items: v.array(saleItemValidator),
  splits: v.optional(v.array(splitItemValidator)),
  total: v.number(),
  note: v.optional(v.string()),
  createdAt: v.number(),
};

/**
 * A recorded cash-register close: a cashier counts their physical drawer and
 * the server records what it computed as expected for that cashier's window,
 * the count, and the difference — per currency. Every field is REQUIRED (D6
 * in the design): this table starts with zero rows, so there is nothing to
 * backfill, and an optional `expectedUsd` would permit a close with no
 * expectation, which is not a close. See `convex/closes.ts` for why
 * blindness, window continuity and immutability are structural here rather
 * than checks that could be bypassed.
 */
export const closeFields = {
  cashierId: v.id('employees'), // AUTH-2: stored for audit, stripped from returns
  cashierName: v.string(), // frozen snapshot — what the UI displays
  openedAt: v.number(), // window start, EXCLUSIVE
  closedAt: v.number(), // window end, INCLUSIVE — server clock, never client-supplied
  expectedUsd: v.number(),
  expectedBs: v.number(), // Bs AS TYPED (Σ entered) — never amount × any rate
  countedUsd: v.number(),
  countedBs: v.number(),
  differenceUsd: v.number(), // counted − expected; negative = Faltante
  differenceBs: v.number(),
  // Absent means the expected figures cover the WHOLE window — the normal case.
  // Present means the window held more sales than one close transaction can
  // read, so the cashier confirmed a partial close and the expected figures
  // cover only (countedFrom, closedAt]. Recorded rather than silently applied:
  // a close is a permanent financial record, and the surplus this produces has
  // to be explainable years later. `closedAt` is still the true window end, so
  // the NEXT close continues from it and nothing is skipped going forward.
  countedFrom: v.optional(v.number()),
};

// Owner-configured barcode input: physical HID scanner (default) or device camera.
export const scannerModeValidator = v.union(
  v.literal('physical'),
  v.literal('camera')
);

export const settingsFields = {
  storeName: v.string(),
  storeRif: v.string(),
  phone: v.string(),
  address: v.string(),
  currency: v.string(),
  taxName: v.string(),
  ivaPct: v.number(),
  bsRate: v.number(),
  nextInvoiceNumber: v.number(),
  nextHeldCode: v.number(),
  printAuto: v.boolean(),
  emailReceipt: v.boolean(),
  lowStockAlerts: v.boolean(),
  soundScan: v.boolean(),
  // Optional so pre-existing rows stay valid; absent means "physical".
  scannerMode: v.optional(scannerModeValidator),
};

/**
 * A hashed, expiring session token bound to an employee. The raw token is
 * returned to the client once (by `login`) and never stored — only its
 * `sha256` hash lives here, so a DB read can never recover a usable credential.
 *
 * Expiry is two-layered: `expiresAt` is the IDLE deadline (slid forward by
 * activity / `renewSession`), `absoluteExpiresAt` is the hard cap fixed at
 * login. A session is invalid once EITHER deadline has passed.
 */
export const sessionFields = {
  employeeId: v.id('employees'),
  tokenHash: v.string(), // sha256(token); the raw token is never persisted
  expiresAt: v.number(), // IDLE deadline; invalid once Date.now() >= this; slides on activity
  absoluteExpiresAt: v.number(), // hard cap fixed at login; invalid once Date.now() >= this; never slides
  lastSeenAt: v.number(), // bumped on each authenticated call
};

/**
 * AUTH-3 login rate-limiting sentinel: ONE row per normalized email tracking
 * FAILED login attempts inside a fixed window. `login` reads it before
 * evaluating credentials (locking the email out at `MAX_ATTEMPTS`), increments
 * it on each failure, and deletes it on success. The window auto-lifts: a
 * lookup whose `windowStart` is older than `WINDOW_MS` is treated as a fresh
 * window. Purely additive — no existing table or row is touched.
 */
export const loginAttemptFields = {
  email: v.string(), // normalized: trim() + toLowerCase() — same as login
  windowStart: v.number(), // Date.now() when the current window began
  count: v.number(), // failed attempts recorded so far in this window
};

// ---------------------------------------------------------------------------
// Full-document validators (for `returns` validators of functions that hand
// whole docs to the client).
// ---------------------------------------------------------------------------

export const categoryDocValidator = v.object({
  _id: v.id('categories'),
  _creationTime: v.number(),
  ...categoryFields,
});

export const productDocValidator = v.object({
  _id: v.id('products'),
  _creationTime: v.number(),
  ...productFields,
});

// What `products.list` returns: the document plus the RESOLVED photo address.
// `imageUrl` is derived per read, never stored — a storage address is not a fact
// about the product, and persisting one would go stale.
export const productWithImageValidator = v.object({
  _id: v.id('products'),
  _creationTime: v.number(),
  ...productFields,
  imageUrl: v.optional(v.string()),
});

export const clientDocValidator = v.object({
  _id: v.id('clients'),
  _creationTime: v.number(),
  ...clientFields,
});

export const employeeDocValidator = v.object({
  _id: v.id('employees'),
  _creationTime: v.number(),
  ...employeeFields,
});

// AUTH-4: Public projection of an employee — strips pinHash + pinSalt so that
// sensitive hashing material never leaves the server. Mirror of the existing
// publicSaleDocValidator / publicHeldCartDocValidator pattern.
// Use this as the `returns` validator for any function that returns an employee
// to a client (me, employees.list, etc.).
const {
  pinHash: _empPinHash,
  pinSalt: _empPinSalt,
  ...publicEmployeeFields
} = employeeFields;
export const publicEmployeeValidator = v.object({
  _id: v.id('employees'),
  _creationTime: v.number(),
  ...publicEmployeeFields,
});

export const saleDocValidator = v.object({
  _id: v.id('sales'),
  _creationTime: v.number(),
  ...saleFields,
});

export const heldCartDocValidator = v.object({
  _id: v.id('heldCarts'),
  _creationTime: v.number(),
  ...heldCartFields,
});

export const supplierDocValidator = v.object({
  _id: v.id('suppliers'),
  _creationTime: v.number(),
  ...supplierFields,
});

export const purchaseDocValidator = v.object({
  _id: v.id('purchases'),
  _creationTime: v.number(),
  ...purchaseFields,
});

// Same AUTH-2 rule as sales and held carts: `createdBy` is an employee-identity
// surface, so it is stripped from every returns validator while staying STORED
// for audit. `createdByName` is the frozen snapshot meant for display.
const { createdBy: _purchaseCreatedBy, ...publicPurchaseFields } =
  purchaseFields;
export const publicPurchaseDocValidator = v.object({
  _id: v.id('purchases'),
  _creationTime: v.number(),
  ...publicPurchaseFields,
});

export const closeDocValidator = v.object({
  _id: v.id('closes'),
  _creationTime: v.number(),
  ...closeFields,
});

// Same AUTH-2 rule as sales / held carts / purchases: `cashierId` is an
// employee-identity surface, stripped from every returns validator while
// staying STORED for audit (`by_cashier_closedAt` needs it). `cashierName` is
// the frozen snapshot meant for display.
const { cashierId: _closeCashierId, ...publicCloseFields } = closeFields;
export const publicCloseDocValidator = v.object({
  _id: v.id('closes'),
  _creationTime: v.number(),
  ...publicCloseFields,
});

export const settingsDocValidator = v.object({
  _id: v.id('settings'),
  _creationTime: v.number(),
  ...settingsFields,
});

export const sessionDocValidator = v.object({
  _id: v.id('sessions'),
  _creationTime: v.number(),
  ...sessionFields,
});

export const loginAttemptDocValidator = v.object({
  _id: v.id('loginAttempts'),
  _creationTime: v.number(),
  ...loginAttemptFields,
});

// Public projections — the stored `cashierId` is an employee-identity surface
// (a would-be credential), so it is omitted from query *returns*. The
// human-readable `cashierName` snapshot stays on sales for display; the id
// remains STORED on both tables for audit. (AUTH-2.)
const { cashierId: _saleCashierId, ...publicSaleFields } = saleFields;
export const publicSaleDocValidator = v.object({
  _id: v.id('sales'),
  _creationTime: v.number(),
  ...publicSaleFields,
});

const { cashierId: _heldCashierId, ...publicHeldCartFields } = heldCartFields;
export const publicHeldCartDocValidator = v.object({
  _id: v.id('heldCarts'),
  _creationTime: v.number(),
  ...publicHeldCartFields,
  // Supervisor-only attribution: WHO parked the sale, by name. Owners/admins see
  // every cart and need to tell them apart; a cajero only ever receives their own
  // carts, so the field is omitted for them. The employee `_id` still never
  // leaves the server (AUTH-2) — a name is enough to display.
  cashierName: v.optional(v.string()),
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export default defineSchema({
  categories: defineTable(categoryFields),

  // by_supplier: `suppliers.remove` must know whether any product still points
  // at a supplier before deleting it — a `first()` probe, never a catalogue scan.
  products: defineTable(productFields)
    .index('by_supplier', ['supplierId'])
    .index('by_barcode', ['barcode'])
    // `create` derives the SKU from the name and has to know which codes are
    // already taken. Read as a RANGE over the derived prefix, so the collision
    // check costs one indexed read rather than a scan of the catalogue.
    .index('by_sku', ['sku'])
    .index('by_category', ['categoryId']),

  clients: defineTable(clientFields).index('by_taxId', ['taxPrefix', 'taxId']),

  // by_taxId: the RIF is the supplier's real identity — the index backs both the
  // duplicate guard on create and lookup by RIF.
  suppliers: defineTable(supplierFields).index('by_taxId', [
    'taxPrefix',
    'taxId',
  ]),

  // by_supplier: purchases are always read through their supplier's detail sheet.
  // `createdAt` is part of the index so the newest-first read and its cap agree
  // on the SAME field — ordering on the index's implicit _creationTime and then
  // re-sorting by createdAt would cut one set and display another.
  // by_createdAt: `reports.cashFlow` needs a GLOBAL period range over every
  // purchase, not scoped to one supplier — `by_supplier` cannot serve that.
  purchases: defineTable(purchaseFields)
    .index('by_supplier', ['supplierId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),

  employees: defineTable(employeeFields),

  sales: defineTable(saleFields)
    .index('by_invoice', ['invoiceNumber'])
    .index('by_soldAt', ['soldAt'])
    // Offline-first (Phase 6.3): idempotent replay lookup for `sales.syncOffline`.
    .index('by_idempotencyKey', ['idempotencyKey'])
    // `reports.cashFlow` attributes a refund to the period it happened in, not
    // the period the sale was made — this indexes that separately from
    // `by_soldAt`. The path is on the OPTIONAL `refund` field: `v.optional()`
    // preserves `FieldPaths` (verified against installed convex@^1.36.1), so
    // `['refund.date']` typechecks. A non-refunded sale has
    // `refund.date === undefined`, which sorts before every number and so
    // self-excludes from a `gte` bound — no `filter` needed (forbidden by the
    // project's query guideline).
    .index('by_refundDate', ['refund.date'])
    // `closes.create` bounds its read by ONE cashier's own window. Ranging on
    // `by_soldAt` and filtering by cashier afterwards would let the whole
    // shop's volume consume a single cashier's read cap — with three people on
    // the register, a third of the cap locks each of them out. These two
    // indexes put the cashier INSIDE the range so the cap measures only that
    // cashier's own work.
    .index('by_cashier_soldAt', ['cashierId', 'soldAt'])
    .index('by_cashier_refundDate', ['cashierId', 'refund.date']),

  // by_cashier: a cajero's "Ventas en espera" list is scoped to their OWN parked
  // sales, so the query must not scan the table to throw most rows away.
  heldCarts: defineTable(heldCartFields).index('by_cashier', ['cashierId']),

  // by_cashier_closedAt: `closes.create` looks up THIS cashier's own last close
  // to derive the window start (D2/D4) — a duplicate window is unreachable
  // because `from` is never a client input, only ever this lookup's result.
  // Also backs `closes.list({scope:'own'})`, newest first.
  // by_closedAt: backs `closes.list({scope:'all'})` — newest first across
  // every cashier, capped + `truncated`, same shape as `sales.history`.
  closes: defineTable(closeFields)
    .index('by_cashier_closedAt', ['cashierId', 'closedAt'])
    .index('by_closedAt', ['closedAt']),

  // Singleton row
  settings: defineTable(settingsFields),

  // Hashed, expiring session tokens (the bearer credential — never a doc _id).
  sessions: defineTable(sessionFields)
    .index('by_tokenHash', ['tokenHash'])
    .index('by_employee', ['employeeId']),

  // AUTH-3 login rate-limiting: one fixed-window failed-attempt counter per
  // normalized email (looked up by `login` before evaluating credentials).
  loginAttempts: defineTable(loginAttemptFields).index('by_email', ['email']),
});
