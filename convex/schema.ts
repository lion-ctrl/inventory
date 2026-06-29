import { defineSchema, defineTable } from 'convex/server';
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
  exempt: v.optional(v.boolean()),
});

/** One row of a split payment (amounts always in USD). */
export const splitItemValidator = v.object({
  method: v.string(),
  amount: v.number(),
  entered: v.optional(v.number()),
  currency: v.optional(v.string()),
});

// ---------------------------------------------------------------------------
// Table field maps (exported so modules can build full-doc returns validators
// as v.object({ _id, _creationTime, ...fields }) without duplication).
// ---------------------------------------------------------------------------

export const categoryFields = {
  label: v.string(),
};

export const productFields = {
  barcode: v.string(),
  sku: v.string(),
  name: v.string(),
  price: v.number(), // USD
  stock: v.number(),
  minStock: v.number(),
  categoryId: v.id('categories'),
  exempt: v.optional(v.boolean()),
  glyph: v.optional(v.string()),
  // undefined/true = on sale; false = paused
  sellable: v.optional(v.boolean()),
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
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export default defineSchema({
  categories: defineTable(categoryFields),

  products: defineTable(productFields)
    .index('by_barcode', ['barcode'])
    .index('by_category', ['categoryId']),

  clients: defineTable(clientFields).index('by_taxId', ['taxPrefix', 'taxId']),

  employees: defineTable(employeeFields),

  sales: defineTable(saleFields)
    .index('by_invoice', ['invoiceNumber'])
    .index('by_soldAt', ['soldAt']),

  heldCarts: defineTable(heldCartFields),

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
