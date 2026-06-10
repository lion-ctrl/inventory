// Helper module — no exported Convex functions (queries/mutations) here.
import { ConvexError } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

export type PermissionId =
  | 'view_reports'
  | 'void_sales'
  | 'manage_products'
  | 'manage_clients'
  | 'manage_employees'
  | 'manage_settings';

type Ctx = QueryCtx | MutationCtx;

/**
 * Central RBAC check (mirrors the prototype's `can`):
 * permissions === 'all' → true; inactive → false; else the granular flag.
 */
export function can(
  employee: Doc<'employees'> | null | undefined,
  perm: PermissionId
): boolean {
  if (!employee) return false;
  if (employee.permissions === 'all') return true;
  if (employee.active === false) return false;
  return !!employee.permissions[perm];
}

/**
 * Load the acting employee and throw a Spanish ConvexError unless they hold
 * the given permission. Returns the employee doc for convenience.
 */
export async function requirePerm(
  ctx: Ctx,
  actorId: Id<'employees'>,
  perm: PermissionId
): Promise<Doc<'employees'>> {
  const employee = await ctx.db.get('employees', actorId);
  if (!employee || !can(employee, perm)) {
    throw new ConvexError('Sin permisos para esta acción.');
  }
  return employee;
}

/** Load the settings singleton; throw if the deployment was never seeded. */
export async function getSettings(ctx: Ctx): Promise<Doc<'settings'>> {
  const settings = await ctx.db.query('settings').first();
  if (!settings) {
    throw new ConvexError('La configuración de la tienda no está disponible.');
  }
  return settings;
}

/** PINs are exactly 6 digits, validated server-side. */
export function assertPin(pin: string): void {
  if (!/^\d{6}$/.test(pin)) {
    throw new ConvexError('El PIN debe tener 6 dígitos.');
  }
}

/** Round to 2 decimal places (money in USD). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
