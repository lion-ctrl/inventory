// Helper module — no exported Convex functions (queries/mutations) here.
import { ConvexError } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { hashToken, IDLE_TTL_MS } from './sessions';

export type PermissionId =
  | 'view_reports'
  | 'void_sales'
  | 'manage_products'
  | 'manage_clients'
  | 'manage_employees'
  | 'manage_settings'
  | 'manage_suppliers';

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
  // DELIBERATE ORDERING: the 'all' sentinel is checked BEFORE `active`, so the
  // owner can never lock themselves out of their own store. Both test suites
  // pin this ("…and is checked before the active flag" — tests/unit/rbac.test.ts,
  // tests/convex/permissions.test.ts). It is not a hole: `resolveSession` already
  // refuses an inactive employee, so no session ever reaches here with one.
  if (employee.permissions === 'all') return true;
  if (employee.active === false) return false;
  // Within a GRANULAR map, a key that is simply absent (manage_suppliers was
  // added later, as optional) reads as false.
  return !!employee.permissions[perm];
}

/**
 * Pure permission gate on an already-resolved employee (resolved via
 * `requireSession`). Throws a Spanish ConvexError unless the employee holds the
 * given permission; returns the employee for convenient chaining.
 *
 * NOTE: this NO LONGER loads the employee from a client-supplied id — that was
 * the impersonation hole. The acting employee MUST come from the session.
 */
export function requirePerm(
  employee: Doc<'employees'> | null | undefined,
  perm: PermissionId
): Doc<'employees'> {
  if (!employee || !can(employee, perm)) {
    throw new ConvexError('Sin permisos para esta acción.');
  }
  return employee;
}

/**
 * Resolve a session token to its employee WITHOUT throwing. Returns `null` when
 * the token is absent, unknown, expired, or its employee is missing/inactive.
 * Used by `auth.me` for boot revalidation (mirrors the old stale-id tolerance).
 */
export async function resolveSession(
  ctx: Ctx,
  token: string | null | undefined
): Promise<{ session: Doc<'sessions'>; employee: Doc<'employees'> } | null> {
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const session = await ctx.db
    .query('sessions')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .unique();
  // Invalid once the IDLE deadline (expiresAt, slid by activity) OR the ABSOLUTE
  // cap (absoluteExpiresAt, fixed at login) has passed — whichever comes first.
  const now = Date.now();
  if (
    !session ||
    session.expiresAt <= now ||
    session.absoluteExpiresAt <= now
  ) {
    return null;
  }
  const employee = await ctx.db.get('employees', session.employeeId);
  if (!employee || employee.active === false) return null;
  return { session, employee };
}

/**
 * The authentication trust boundary for every privileged function. Validates
 * the client-supplied session token and returns the acting employee, throwing
 * if the token is missing / unknown / expired / inactive. On success it bumps
 * `lastSeenAt` (only in a mutation context — queries cannot write).
 */
export async function requireSession(
  ctx: Ctx,
  token: string
): Promise<Doc<'employees'>> {
  const resolved = await resolveSession(ctx, token);
  if (!resolved) {
    throw new ConvexError(
      'Sesión inválida o expirada. Inicia sesión de nuevo.'
    );
  }
  // Slide the idle window forward + bump last-seen, but ONLY when we can write.
  // `'patch' in ctx.db` narrows the union to the mutation writer, so query
  // contexts (history/list) validate without writing. The new idle deadline is
  // clamped to the absolute cap, so an active session can never outlive 72h.
  if ('patch' in ctx.db) {
    const now = Date.now();
    await ctx.db.patch('sessions', resolved.session._id, {
      expiresAt: Math.min(
        now + IDLE_TTL_MS,
        resolved.session.absoluteExpiresAt
      ),
      lastSeenAt: now,
    });
  }
  return resolved.employee;
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
