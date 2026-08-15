import { ConvexError, v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { assertPin } from './permissions';
import { hashPin } from './sessions';

/**
 * The one way into a brand-new deployment.
 *
 * Every other door needs a key that is already inside: `employees.create`
 * demands a session token, `requireSession` demands a session, and a session
 * only exists once someone has logged in as an employee. A deployment with an
 * empty `employees` table therefore cannot be opened at all — not a missing
 * feature, a locked room with the key on the inside.
 *
 * INTERNAL on purpose, exactly like `seed.run`. It is invoked once from the
 * command line at deploy time:
 *
 *   npx convex run bootstrap:createFirstOwner '{"name":"…","email":"…","phone":"…","pin":"482106"}'
 *
 * A public mutation would be reachable by anyone who knows the deployment URL,
 * and the whole value of this function is that the person running it is the
 * person who owns the deployment. Whoever can deploy can already do anything;
 * whoever merely found the URL should not be able to mint themselves an owner
 * in the minutes between `convex deploy` and the shop's first login.
 */
export const createFirstOwner = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    /** Plaintext here and hashed below — never stored as typed (AUTH-4). */
    pin: v.string(),
  },
  returns: v.id('employees'),
  handler: async (ctx, args) => {
    // ANY employee closes the window, active or not. Counting only active rows
    // would reopen it every time a shop deactivates its last employee — a state
    // a real shop reaches, and one that must never hand out a fresh owner.
    // `first()` rather than a count: the question is "is this table empty", and
    // one row is the whole answer.
    const existing = await ctx.db.query('employees').first();
    if (existing) {
      throw new ConvexError(
        'Ya existe al menos un empleado. Crea los demás desde la pantalla Empleados.'
      );
    }

    // The same six-digit rule every other entry point enforces. Checked BEFORE
    // the insert so a rejected PIN leaves the deployment still bootstrappable.
    assertPin(args.pin);

    const { pinHash, pinSalt } = await hashPin(args.pin);
    return await ctx.db.insert('employees', {
      name: args.name,
      email: args.email,
      phone: args.phone,
      role: 'owner',
      // The owner sentinel: `can()` short-circuits on it, so the first account
      // can reach the Empleados screen and grant everyone else their own.
      permissions: 'all',
      pinHash,
      pinSalt,
      active: true,
      createdAt: Date.now(),
    });
  },
});
