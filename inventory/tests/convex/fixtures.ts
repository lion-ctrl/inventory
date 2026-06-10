// Seed fixtures shared by the convex backend test suites.
import type { MutationCtx } from "@convex/_generated/server";
import type { Id } from "@convex/_generated/dataModel";

export const PERMISSION_IDS = [
  "view_reports",
  "void_sales",
  "manage_products",
  "manage_clients",
  "manage_employees",
  "manage_settings",
] as const;

export type PermissionId = (typeof PERMISSION_IDS)[number];

export const permsOf = (...granted: PermissionId[]) =>
  Object.fromEntries(PERMISSION_IDS.map((p) => [p, granted.includes(p)])) as Record<
    PermissionId,
    boolean
  >;

export interface Fixtures {
  settingsId: Id<"settings">;
  categoryId: Id<"categories">;
  /** price 1.50, stock 24, taxable */
  cola: Id<"products">;
  /** price 0.80, stock 56, EXEMPT */
  agua: Id<"products">;
  /** price 22.50, stock 3, PAUSED (sellable: false) */
  pintura: Id<"products">;
  /** price 5.80, stock 2 (low) */
  cafe: Id<"products">;
  clientId: Id<"clients">;
  /** role owner, permissions 'all', pin 482106, email carlos@mitienda.com */
  owner: Id<"employees">;
  /** cajero with void_sales (+ view_reports) */
  cajeroVoid: Id<"employees">;
  /** cajero with manage_clients only */
  cajeroPlain: Id<"employees">;
  /** inactive employee with permissions 'all' */
  inactive: Id<"employees">;
}

export async function seedBase(ctx: MutationCtx): Promise<Fixtures> {
  const now = Date.now();

  const settingsId = await ctx.db.insert("settings", {
    storeName: "Tienda Ejemplo, C.A",
    storeRif: "J-31234567-8",
    phone: "+507 269-0000",
    address: "Av. Principal 123, Urb. Centro, Caracas",
    currency: "USD",
    taxName: "IVA",
    ivaPct: 13,
    bsRate: 36.5,
    nextInvoiceNumber: 43,
    nextHeldCode: 1001,
    salesType: "invoice",
    printAuto: true,
    emailReceipt: false,
    lowStockAlerts: true,
    soundScan: true,
  });

  const categoryId = await ctx.db.insert("categories", { label: "Bebidas" });

  const cola = await ctx.db.insert("products", {
    barcode: "7591000000123",
    sku: "COCA-600",
    name: "Coca-Cola 600ml",
    price: 1.5,
    stock: 24,
    minStock: 5,
    categoryId,
    glyph: "🥤",
  });
  const agua = await ctx.db.insert("products", {
    barcode: "7591000000130",
    sku: "AGUA-1L",
    name: "Agua mineral 1L",
    price: 0.8,
    stock: 56,
    minStock: 5,
    categoryId,
    exempt: true,
    glyph: "💧",
  });
  const pintura = await ctx.db.insert("products", {
    barcode: "7594000000132",
    sku: "PIN-1GAL",
    name: "Pintura blanca 1gal",
    price: 22.5,
    stock: 3,
    minStock: 5,
    categoryId,
    sellable: false,
    glyph: "🎨",
  });
  const cafe = await ctx.db.insert("products", {
    barcode: "7591000000154",
    sku: "CAF-250",
    name: "Café molido 250g",
    price: 5.8,
    stock: 2,
    minStock: 5,
    categoryId,
    glyph: "☕",
  });

  const clientId = await ctx.db.insert("clients", {
    name: "María González",
    taxPrefix: "V",
    taxId: "5.123.456",
    kind: "person",
    email: "maria@correo.com",
    phone: "+507 6000-1122",
    createdAt: now,
  });

  const owner = await ctx.db.insert("employees", {
    name: "Carlos Méndez",
    email: "carlos@mitienda.com",
    phone: "04141112233",
    role: "owner",
    permissions: "all",
    pin: "482106",
    active: true,
    createdAt: now,
  });
  const cajeroVoid = await ctx.db.insert("employees", {
    name: "Pedro Ramírez",
    email: "pedro.ramirez@mitienda.com",
    phone: "04141239988",
    role: "cajero",
    permissions: permsOf("view_reports", "void_sales"),
    pin: "582441",
    active: true,
    createdAt: now,
  });
  const cajeroPlain = await ctx.db.insert("employees", {
    name: "Ana Torres",
    email: "ana.torres@mitienda.com",
    phone: "04167788990",
    role: "cajero",
    permissions: permsOf("manage_clients"),
    pin: "975330",
    active: true,
    createdAt: now,
  });
  const inactive = await ctx.db.insert("employees", {
    name: "Carlos Rivas",
    email: "carlos.rivas@mitienda.com",
    phone: "04122233445",
    role: "cajero",
    permissions: "all",
    pin: "864253",
    active: false,
    createdAt: now,
  });

  return {
    settingsId,
    categoryId,
    cola,
    agua,
    pintura,
    cafe,
    clientId,
    owner,
    cajeroVoid,
    cajeroPlain,
    inactive,
  };
}
