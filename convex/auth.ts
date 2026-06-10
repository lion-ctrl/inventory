// Plain employees-table login (email + 6-digit PIN). No auth package — by
// explicit owner decision. The client persists the employee _id locally and
// re-validates it through `me` on boot.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { employeeDocValidator } from './schema';

export const login = mutation({
  args: {
    email: v.string(),
    pin: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), employee: employeeDocValidator }),
    v.object({ ok: v.literal(false), error: v.string() })
  ),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const employees = await ctx.db.query('employees').collect();
    const employee =
      employees.find((e) => e.email.trim().toLowerCase() === email) ?? null;

    if (!employee || employee.pin !== args.pin) {
      return {
        ok: false as const,
        error: 'Credenciales inválidas. Verifica e intenta de nuevo.',
      };
    }
    if (!employee.active) {
      return {
        ok: false as const,
        error: 'Usuario inactivo. Contacta al propietario.',
      };
    }

    const now = Date.now();
    await ctx.db.patch('employees', employee._id, { lastActive: now });
    return { ok: true as const, employee: { ...employee, lastActive: now } };
  },
});

export const me = query({
  // Deliberately v.string(): the client persists the id in localStorage, so a
  // stale id from an older deployment must resolve to null — NEVER throw.
  args: { employeeId: v.union(v.string(), v.null()) },
  returns: v.union(employeeDocValidator, v.null()),
  handler: async (ctx, args) => {
    if (!args.employeeId) return null;
    const id = ctx.db.normalizeId('employees', args.employeeId);
    if (!id) return null;
    const employee = await ctx.db.get('employees', id);
    if (!employee || employee.active === false) return null;
    return employee;
  },
});
