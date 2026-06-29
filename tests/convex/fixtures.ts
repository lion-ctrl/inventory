// Seed fixtures shared by the convex backend test suites.
import type { MutationCtx } from '@convex/_generated/server';
import type { Id } from '@convex/_generated/dataModel';
import {
  generateToken,
  hashToken,
  hashPin,
  IDLE_TTL_MS,
  ABSOLUTE_TTL_MS,
} from '@convex/sessions';

/**
 * Mint a session row for an employee and return the RAW token — exactly what
 * `login` hands back. Migrated convex-tests authenticate by passing this token
 * as the `token` arg.
 *
 * Forge specific expiry states for tests:
 *  - `expiresAt` in the past → an idle-expired session.
 *  - `absoluteExpiresAt` in the past → a session past its 72h absolute cap
 *    (even when the idle window is still fresh).
 */
export async function mintSession(
  ctx: MutationCtx,
  employeeId: Id<'employees'>,
  opts: { expiresAt?: number; absoluteExpiresAt?: number } = {}
): Promise<string> {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  await ctx.db.insert('sessions', {
    employeeId,
    tokenHash,
    expiresAt: opts.expiresAt ?? now + IDLE_TTL_MS,
    absoluteExpiresAt: opts.absoluteExpiresAt ?? now + ABSOLUTE_TTL_MS,
    lastSeenAt: now,
  });
  return token;
}

export const PERMISSION_IDS = [
  'view_reports',
  'void_sales',
  'manage_products',
  'manage_clients',
  'manage_employees',
  'manage_settings',
] as const;

export type PermissionId = (typeof PERMISSION_IDS)[number];

export const permsOf = (...granted: PermissionId[]) =>
  Object.fromEntries(
    PERMISSION_IDS.map((p) => [p, granted.includes(p)])
  ) as Record<PermissionId, boolean>;

export interface Fixtures {
  settingsId: Id<'settings'>;
  categoryId: Id<'categories'>;
  /** price 1.50, stock 24, taxable */
  cola: Id<'products'>;
  /** price 0.80, stock 56, EXEMPT */
  agua: Id<'products'>;
  /** price 22.50, stock 3, PAUSED (sellable: false) */
  pintura: Id<'products'>;
  /** price 5.80, stock 2 (low) */
  cafe: Id<'products'>;
  clientId: Id<'clients'>;
  /** role owner, permissions 'all', pin 482106, email carlos@mitienda.com */
  owner: Id<'employees'>;
  /** cajero with void_sales (+ view_reports) */
  cajeroVoid: Id<'employees'>;
  /** cajero with manage_clients only */
  cajeroPlain: Id<'employees'>;
  /** inactive employee with permissions 'all' */
  inactive: Id<'employees'>;
  /** valid session token for `owner` (permissions 'all') */
  ownerToken: string;
  /** valid session token for `cajeroVoid` (view_reports + void_sales) */
  cajeroVoidToken: string;
  /** valid session token for `cajeroPlain` (manage_clients only) */
  cajeroPlainToken: string;
  /** session bound to the INACTIVE employee — requireSession must reject it */
  inactiveToken: string;
}

export async function seedBase(ctx: MutationCtx): Promise<Fixtures> {
  const now = Date.now();

  const settingsId = await ctx.db.insert('settings', {
    storeName: 'Tienda Ejemplo, C.A',
    storeRif: 'J-31234567-8',
    phone: '+507 269-0000',
    address: 'Av. Principal 123, Urb. Centro, Caracas',
    currency: 'USD',
    taxName: 'IVA',
    ivaPct: 13,
    bsRate: 36.5,
    nextInvoiceNumber: 43,
    nextHeldCode: 1001,
    printAuto: true,
    emailReceipt: false,
    lowStockAlerts: true,
    soundScan: true,
  });

  const categoryId = await ctx.db.insert('categories', { label: 'Bebidas' });

  const cola = await ctx.db.insert('products', {
    barcode: '7591000000123',
    sku: 'COCA-600',
    name: 'Coca-Cola 600ml',
    price: 1.5,
    stock: 24,
    minStock: 5,
    categoryId,
    glyph: '🥤',
  });
  const agua = await ctx.db.insert('products', {
    barcode: '7591000000130',
    sku: 'AGUA-1L',
    name: 'Agua mineral 1L',
    price: 0.8,
    stock: 56,
    minStock: 5,
    categoryId,
    exempt: true,
    glyph: '💧',
  });
  const pintura = await ctx.db.insert('products', {
    barcode: '7594000000132',
    sku: 'PIN-1GAL',
    name: 'Pintura blanca 1gal',
    price: 22.5,
    stock: 3,
    minStock: 5,
    categoryId,
    sellable: false,
    glyph: '🎨',
  });
  const cafe = await ctx.db.insert('products', {
    barcode: '7591000000154',
    sku: 'CAF-250',
    name: 'Café molido 250g',
    price: 5.8,
    stock: 2,
    minStock: 5,
    categoryId,
    glyph: '☕',
  });

  const clientId = await ctx.db.insert('clients', {
    name: 'María González',
    taxPrefix: 'V',
    taxId: '5.123.456',
    kind: 'person',
    email: 'maria@correo.com',
    phone: '+507 6000-1122',
    createdAt: now,
  });

  // AUTH-4: store PBKDF2 hash+salt for each fixture employee (never plaintext).
  // PIN values are preserved so login tests can still call login({pin:'...'}).
  const ownerPin = await hashPin('482106');
  const owner = await ctx.db.insert('employees', {
    name: 'Carlos Méndez',
    email: 'carlos@mitienda.com',
    phone: '04141112233',
    role: 'owner',
    permissions: 'all',
    pinHash: ownerPin.pinHash,
    pinSalt: ownerPin.pinSalt,
    active: true,
    createdAt: now,
  });
  const cajeroVoidPin = await hashPin('582441');
  const cajeroVoid = await ctx.db.insert('employees', {
    name: 'Pedro Ramírez',
    email: 'pedro.ramirez@mitienda.com',
    phone: '04141239988',
    role: 'cajero',
    permissions: permsOf('view_reports', 'void_sales'),
    pinHash: cajeroVoidPin.pinHash,
    pinSalt: cajeroVoidPin.pinSalt,
    active: true,
    createdAt: now,
  });
  const cajeroPlainPin = await hashPin('975330');
  const cajeroPlain = await ctx.db.insert('employees', {
    name: 'Ana Torres',
    email: 'ana.torres@mitienda.com',
    phone: '04167788990',
    role: 'cajero',
    permissions: permsOf('manage_clients'),
    pinHash: cajeroPlainPin.pinHash,
    pinSalt: cajeroPlainPin.pinSalt,
    active: true,
    createdAt: now,
  });
  const inactivePin = await hashPin('864253');
  const inactive = await ctx.db.insert('employees', {
    name: 'Carlos Rivas',
    email: 'carlos.rivas@mitienda.com',
    phone: '04122233445',
    role: 'cajero',
    permissions: 'all',
    pinHash: inactivePin.pinHash,
    pinSalt: inactivePin.pinSalt,
    active: false,
    createdAt: now,
  });

  const ownerToken = await mintSession(ctx, owner);
  const cajeroVoidToken = await mintSession(ctx, cajeroVoid);
  const cajeroPlainToken = await mintSession(ctx, cajeroPlain);
  const inactiveToken = await mintSession(ctx, inactive);

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
    ownerToken,
    cajeroVoidToken,
    cajeroPlainToken,
    inactiveToken,
  };
}
