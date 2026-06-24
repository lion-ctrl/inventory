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
  pin: v.string(),
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
});
