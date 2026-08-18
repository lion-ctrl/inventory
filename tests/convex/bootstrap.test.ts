/// <reference types="vite/client" />
// bootstrap.createFirstOwner — the one way into a brand-new deployment.
//
// Without it the app is a locked door with the key inside: `employees.create`
// demands a session token, `login` demands an employee, and a fresh deployment
// has neither. This mutation is the only thing that may create an employee out
// of nothing, so the whole of its value is the guard: it works exactly once,
// while the table is empty, and never again.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api, internal } from '@convex/_generated/api';
import schema from '@convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

const owner = {
  name: 'Carlos Méndez',
  email: 'carlos@mitienda.com',
  phone: '0414-1234567',
  pin: '482106',
  storeName: 'Bodega La Esquina',
  storeRif: 'J-40123456-7',
  ivaPct: 16,
  bsRate: 36.5,
};

describe('bootstrap.createFirstOwner', () => {
  test('an empty deployment gets an owner who can immediately log in', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.bootstrap.createFirstOwner, owner);

    // The point of the whole exercise: the door opens.
    const session = await t.mutation(api.auth.login, {
      email: owner.email,
      pin: owner.pin,
    });
    expect(session.ok).toBe(true);
  });

  test('the owner is a real owner, with the sentinel permissions', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.bootstrap.createFirstOwner, owner);

    const row = await t.run(async (ctx) => {
      const all = await ctx.db.query('employees').collect();
      return all[0];
    });
    expect(row.role).toBe('owner');
    expect(row.permissions).toBe('all');
    expect(row.active).toBe(true);
  });

  test('the PIN is hashed, never stored as typed', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.bootstrap.createFirstOwner, owner);

    const row = await t.run(async (ctx) => {
      const all = await ctx.db.query('employees').collect();
      return all[0];
    });
    expect(row).not.toHaveProperty('pin');
    expect(row.pinHash).toBeDefined();
    expect(row.pinSalt).toBeDefined();
    expect(row.pinHash).not.toBe(owner.pin);
  });

  test('it REFUSES once any employee exists — the window closes for good', async () => {
    // This is the security boundary. A second successful call would mean anyone
    // who can reach the deployment can mint themselves an owner.
    const t = convexTest(schema, modules);
    await t.mutation(internal.bootstrap.createFirstOwner, owner);

    await expect(
      t.mutation(internal.bootstrap.createFirstOwner, {
        ...owner,
        email: 'intruso@otro.com',
      })
    ).rejects.toThrow('Ya existe al menos un empleado');

    const count = await t.run(
      async (ctx) => (await ctx.db.query('employees').collect()).length
    );
    expect(count).toBe(1);
  });

  test('it refuses an inactive leftover employee too — non-empty is non-empty', async () => {
    // A deactivated employee still means the shop has been set up. Counting
    // only ACTIVE rows would reopen the window every time the last employee is
    // deactivated, which is a state a real shop reaches.
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('employees', {
        name: 'Antiguo',
        email: 'viejo@mitienda.com',
        phone: '0000',
        role: 'cajero',
        permissions: 'all',
        pinHash: 'x',
        pinSalt: 'y',
        active: false,
        createdAt: 0,
      });
    });

    await expect(
      t.mutation(internal.bootstrap.createFirstOwner, owner)
    ).rejects.toThrow('Ya existe al menos un empleado');
  });

  test('it enforces the same six-digit PIN rule every other entry point does', async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(internal.bootstrap.createFirstOwner, { ...owner, pin: '123' })
    ).rejects.toThrow('El PIN debe tener 6 dígitos.');

    const count = await t.run(
      async (ctx) => (await ctx.db.query('employees').collect()).length
    );
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The settings singleton — without it the owner can log in and sell NOTHING
// ---------------------------------------------------------------------------
// `getSettings` throws when the row is absent, and `sales.checkout`,
// `heldCarts.hold` and `purchases.create` all call it. `settings.update` cannot
// rescue a deployment either: it patches an existing row, so it throws too.
// Creating the owner without settings therefore produced exactly the shape this
// whole module exists to prevent — a deployment with no way in from inside it.
describe('bootstrap.createFirstOwner — the settings singleton', () => {
  test('creates the row the sale, held-cart and purchase paths all read', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.bootstrap.createFirstOwner, owner);

    const rows = await t.run((ctx) => ctx.db.query('settings').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].storeName).toBe('Bodega La Esquina');
    expect(rows[0].storeRif).toBe('J-40123456-7');
    expect(rows[0].ivaPct).toBe(16);
    expect(rows[0].bsRate).toBe(36.5);
    // A brand-new shop has issued nothing yet.
    expect(rows[0].nextInvoiceNumber).toBe(1);
    expect(rows[0].nextHeldCode).toBe(1);
    // No printer can be assumed to exist on a deployment nobody has touched.
    expect(rows[0].printAuto).toBe(false);
  });

  test('the shop is CONFIGURABLE afterwards — settings.update no longer throws', async () => {
    // The integration this fix exists for. Before it, this call threw
    // 'La configuración de la tienda no está disponible.' and the owner had no
    // way to create the row from anywhere in the app.
    const t = convexTest(schema, modules);
    await t.mutation(internal.bootstrap.createFirstOwner, owner);

    const session = await t.mutation(api.auth.login, {
      email: owner.email,
      pin: owner.pin,
    });
    if (!session.ok) throw new Error('login failed');

    await t.mutation(api.settings.update, {
      token: session.token,
      patch: { bsRate: 40 },
    });

    const rows = await t.run((ctx) => ctx.db.query('settings').collect());
    expect(rows[0].bsRate).toBe(40);
  });

  test('refuses figures it must not guess, leaving the deployment bootstrappable', async () => {
    // Every guard runs BEFORE either insert, so a rejected call must leave BOTH
    // tables empty — otherwise the first typo would burn the one-shot window.
    const t = convexTest(schema, modules);

    for (const [bad, message] of [
      [
        { storeName: '   ' },
        'El nombre y el RIF de la tienda son obligatorios.',
      ],
      [{ storeRif: '' }, 'El nombre y el RIF de la tienda son obligatorios.'],
      [{ ivaPct: -1 }, 'El porcentaje de IVA no es válido.'],
      [{ ivaPct: 101 }, 'El porcentaje de IVA no es válido.'],
      [{ ivaPct: Number.NaN }, 'El porcentaje de IVA no es válido.'],
      [{ bsRate: 0 }, 'La tasa del bolívar no es válida.'],
      [{ bsRate: -5 }, 'La tasa del bolívar no es válida.'],
      [
        { bsRate: Number.POSITIVE_INFINITY },
        'La tasa del bolívar no es válida.',
      ],
    ] as const) {
      await expect(
        t.mutation(internal.bootstrap.createFirstOwner, { ...owner, ...bad })
      ).rejects.toThrow(message);
    }

    const employees = await t.run((ctx) => ctx.db.query('employees').collect());
    const settings = await t.run((ctx) => ctx.db.query('settings').collect());
    expect(employees).toHaveLength(0);
    expect(settings).toHaveLength(0);
  });
});
