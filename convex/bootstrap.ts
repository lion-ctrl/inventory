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
 * It opens the SETTINGS singleton in the same breath, and that is not a
 * convenience. `getSettings` throws when the row is absent, and `sales.checkout`,
 * `heldCarts` and `purchases` all call it — so an owner created without settings
 * can log in and can sell nothing. `settings.update` cannot rescue them either:
 * it patches an existing row, so it throws too. Creating the owner alone leaves
 * a deployment whose only exit is another command-line call, which is the same
 * unrecoverable shape this function exists to prevent.
 *
 * INTERNAL on purpose, exactly like `seed.run`. It is invoked once from the
 * command line at deploy time:
 *
 *   npx convex run bootstrap:createFirstOwner --prod '{"name":"…","email":"…","phone":"…","pin":"……","storeName":"…","storeRif":"J-…","ivaPct":16,"bsRate":36.5}'
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
    // The four shop facts this function refuses to guess. Everything else has a
    // defensible default the owner edits later in Ajustes; these four do not.
    // A wrong RIF is a fiscal problem on every printed invoice, and a wrong Bs
    // rate misprices every bolívar taken in — silently, and per sale, since each
    // sale freezes the rate it was made at.
    storeName: v.string(),
    storeRif: v.string(),
    ivaPct: v.number(),
    bsRate: v.number(),
    /** Shown on receipts. Blank is visibly incomplete; a guess is not. */
    storePhone: v.optional(v.string()),
    address: v.optional(v.string()),
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
    // any insert so a rejected PIN leaves the deployment still bootstrappable.
    assertPin(args.pin);

    if (args.storeName.trim() === '' || args.storeRif.trim() === '') {
      throw new ConvexError(
        'El nombre y el RIF de la tienda son obligatorios.'
      );
    }
    if (!Number.isFinite(args.ivaPct) || args.ivaPct < 0 || args.ivaPct > 100) {
      throw new ConvexError('El porcentaje de IVA no es válido.');
    }
    // Strictly positive: a zero or negative rate would divide or price every
    // bolívar figure into nonsense rather than merely being inaccurate.
    if (!Number.isFinite(args.bsRate) || args.bsRate <= 0) {
      throw new ConvexError('La tasa del bolívar no es válida.');
    }

    const { pinHash, pinSalt } = await hashPin(args.pin);
    const ownerId = await ctx.db.insert('employees', {
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

    // The settings singleton. Guarded on its own emptiness rather than assumed
    // from the employees check, so a deployment seeded by any other route keeps
    // exactly one row.
    const settings = await ctx.db.query('settings').first();
    if (!settings) {
      await ctx.db.insert('settings', {
        storeName: args.storeName.trim(),
        storeRif: args.storeRif.trim(),
        phone: args.storePhone ?? '',
        address: args.address ?? '',
        currency: 'USD',
        taxName: 'IVA',
        ivaPct: args.ivaPct,
        bsRate: args.bsRate,
        // A brand-new shop's first invoice is number 1, and its first held cart
        // is code 1. Nothing has been issued yet.
        nextInvoiceNumber: 1,
        nextHeldCode: 1,
        // Printing stays OFF until the owner has actually connected a printer;
        // a new deployment cannot know one exists.
        printAuto: false,
        emailReceipt: false,
        lowStockAlerts: true,
        soundScan: true,
        scannerMode: 'physical',
      });
    }

    return ownerId;
  },
});
