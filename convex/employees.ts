import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { assertPin, requirePerm } from './permissions';
import {
  employeeDocValidator,
  permissionsValidator,
  roleValidator,
} from './schema';

export const list = query({
  args: { actorId: v.id('employees') },
  returns: v.array(employeeDocValidator),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, 'manage_employees');
    const employees = await ctx.db.query('employees').collect();
    return employees.filter((e) => e._id !== args.actorId);
  },
});

export const create = mutation({
  args: {
    actorId: v.id('employees'),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    role: roleValidator,
    permissions: permissionsValidator,
    pin: v.string(),
    active: v.boolean(),
  },
  returns: v.id('employees'),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, 'manage_employees');
    assertPin(args.pin);
    const { actorId: _actorId, ...fields } = args;
    return await ctx.db.insert('employees', {
      ...fields,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    actorId: v.id('employees'),
    employeeId: v.id('employees'),
    patch: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      role: v.optional(roleValidator),
      permissions: v.optional(permissionsValidator),
      pin: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, 'manage_employees');
    const employee = await ctx.db.get('employees', args.employeeId);
    if (!employee) throw new ConvexError('Empleado no encontrado.');
    if (args.patch.pin !== undefined) assertPin(args.patch.pin);
    await ctx.db.patch('employees', args.employeeId, args.patch);
    return null;
  },
});

// Anyone edits their OWN profile (name/email/phone/pin) — no permission guard.
export const updateSelf = mutation({
  args: {
    actorId: v.id('employees'),
    patch: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      pin: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await ctx.db.get('employees', args.actorId);
    if (!employee) throw new ConvexError('Empleado no encontrado.');
    if (args.patch.pin !== undefined) assertPin(args.patch.pin);
    await ctx.db.patch('employees', args.actorId, args.patch);
    return null;
  },
});

export const remove = mutation({
  args: {
    actorId: v.id('employees'),
    employeeId: v.id('employees'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePerm(ctx, args.actorId, 'manage_employees');
    const employee = await ctx.db.get('employees', args.employeeId);
    if (employee) await ctx.db.delete('employees', args.employeeId);
    return null;
  },
});
