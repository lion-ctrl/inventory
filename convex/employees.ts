import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { assertPin, requirePerm, requireSession } from './permissions';
import {
  publicEmployeeValidator,
  permissionsValidator,
  roleValidator,
} from './schema';
import { hashPin } from './sessions';

export const list = query({
  args: { token: v.string() },
  // AUTH-4: public projection — pinHash/pinSalt never leave the server.
  returns: v.array(publicEmployeeValidator),
  handler: async (ctx, args) => {
    const actor = await requireSession(ctx, args.token);
    requirePerm(actor, 'manage_employees');
    const employees = await ctx.db.query('employees').collect();
    return employees
      .filter((e) => e._id !== actor._id)
      .map(({ pinHash: _h, pinSalt: _s, ...pub }) => pub);
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    role: roleValidator,
    permissions: permissionsValidator,
    // AUTH-4: client still sends the plaintext PIN; the handler hashes it.
    pin: v.string(),
    active: v.boolean(),
  },
  returns: v.id('employees'),
  handler: async (ctx, args) => {
    const actor = await requireSession(ctx, args.token);
    requirePerm(actor, 'manage_employees');
    assertPin(args.pin);
    const { token: _token, pin, ...rest } = args;
    const { pinHash, pinSalt } = await hashPin(pin);
    return await ctx.db.insert('employees', {
      ...rest,
      pinHash,
      pinSalt,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    employeeId: v.id('employees'),
    patch: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      role: v.optional(roleValidator),
      permissions: v.optional(permissionsValidator),
      // AUTH-4: client still sends the plaintext PIN; the handler hashes it.
      pin: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireSession(ctx, args.token);
    requirePerm(actor, 'manage_employees');
    const employee = await ctx.db.get('employees', args.employeeId);
    if (!employee) throw new ConvexError('Empleado no encontrado.');
    const { pin, ...rest } = args.patch;
    if (pin !== undefined) {
      assertPin(pin);
      const { pinHash, pinSalt } = await hashPin(pin);
      await ctx.db.patch('employees', args.employeeId, {
        ...rest,
        pinHash,
        pinSalt,
      });
    } else {
      await ctx.db.patch('employees', args.employeeId, rest);
    }
    return null;
  },
});

// Anyone edits their OWN profile (name/email/phone/pin) — no permission guard.
// The acting employee is resolved FROM THE SESSION, never from a passed id.
export const updateSelf = mutation({
  args: {
    token: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      // AUTH-4: client still sends the plaintext PIN; the handler hashes it.
      pin: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const employee = await requireSession(ctx, args.token);
    const { pin, ...rest } = args.patch;
    if (pin !== undefined) {
      assertPin(pin);
      const { pinHash, pinSalt } = await hashPin(pin);
      await ctx.db.patch('employees', employee._id, {
        ...rest,
        pinHash,
        pinSalt,
      });
    } else {
      await ctx.db.patch('employees', employee._id, rest);
    }
    return null;
  },
});

export const remove = mutation({
  args: {
    token: v.string(),
    employeeId: v.id('employees'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireSession(ctx, args.token);
    requirePerm(actor, 'manage_employees');
    const employee = await ctx.db.get('employees', args.employeeId);
    if (employee) await ctx.db.delete('employees', args.employeeId);
    return null;
  },
});
