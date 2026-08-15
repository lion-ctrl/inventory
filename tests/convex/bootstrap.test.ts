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
