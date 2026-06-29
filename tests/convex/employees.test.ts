/// <reference types="vite/client" />
// AUTH-4: Employee CRUD stores pinHash/pinSalt (never plaintext pin).
// Public projection (list, me) strips pinHash/pinSalt before returning.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api, internal } from '@convex/_generated/api';
import schema from '@convex/schema';
import { verifyPin } from '@convex/sessions';
import { permsOf, seedBase } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
  return { t, fx };
}

// ---------------------------------------------------------------------------
// employees.list — public projection
// ---------------------------------------------------------------------------
describe('employees.list — public projection (AUTH-4)', () => {
  test('returned employees have no pin, pinHash, or pinSalt', async () => {
    const { t, fx } = await setup();
    const list = await t.query(api.employees.list, { token: fx.ownerToken });
    for (const emp of list) {
      expect(emp).not.toHaveProperty('pin');
      expect(emp).not.toHaveProperty('pinHash');
      expect(emp).not.toHaveProperty('pinSalt');
    }
    // Sanity: list is non-empty and has the expected public fields
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty('name');
    expect(list[0]).toHaveProperty('email');
    expect(list[0]).toHaveProperty('role');
  });
});

// ---------------------------------------------------------------------------
// employees.create — AUTH-4 PIN hashing
// ---------------------------------------------------------------------------
describe('employees.create — AUTH-4 PIN hashing', () => {
  test('stores pinHash+pinSalt, never plaintext pin; verifyPin true for the original PIN', async () => {
    const { t, fx } = await setup();
    const id = await t.mutation(api.employees.create, {
      token: fx.ownerToken,
      name: 'Nuevo Cajero',
      email: 'nuevo@mitienda.com',
      phone: '04140000000',
      role: 'cajero',
      permissions: permsOf('manage_clients'),
      pin: '123456',
      active: true,
    });

    const stored = await t.run((ctx) => ctx.db.get('employees', id));
    // plaintext pin is gone
    expect(stored!).not.toHaveProperty('pin');
    // hash+salt are stored
    expect(typeof stored!.pinHash).toBe('string');
    expect(stored!.pinHash!.length).toBe(64); // 256 bits hex
    expect(typeof stored!.pinSalt).toBe('string');
    expect(stored!.pinSalt!.length).toBeGreaterThan(0);
    // PBKDF2 round-trip
    expect(await verifyPin('123456', stored!.pinSalt!, stored!.pinHash!)).toBe(true);
    // Wrong PIN must NOT verify
    expect(await verifyPin('000000', stored!.pinSalt!, stored!.pinHash!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// employees.update — AUTH-4 PIN hashing
// ---------------------------------------------------------------------------
describe('employees.update — AUTH-4 PIN hashing', () => {
  test('re-hashes with a FRESH salt on PIN change; new PIN verifies, old PIN does not', async () => {
    const { t, fx } = await setup();
    const before = await t.run((ctx) => ctx.db.get('employees', fx.cajeroPlain));

    await t.mutation(api.employees.update, {
      token: fx.ownerToken,
      employeeId: fx.cajeroPlain,
      patch: { pin: '111222' },
    });

    const after = await t.run((ctx) => ctx.db.get('employees', fx.cajeroPlain));
    expect(after!).not.toHaveProperty('pin');
    expect(typeof after!.pinHash).toBe('string');
    // fresh salt — must differ from the previous one
    expect(after!.pinSalt).not.toBe(before!.pinSalt);
    // new PIN verifies
    expect(await verifyPin('111222', after!.pinSalt!, after!.pinHash!)).toBe(true);
    // old PIN no longer works
    expect(await verifyPin('975330', after!.pinSalt!, after!.pinHash!)).toBe(false);
  });

  test('non-PIN fields update without touching pinHash/pinSalt', async () => {
    const { t, fx } = await setup();
    const before = await t.run((ctx) => ctx.db.get('employees', fx.cajeroPlain));

    await t.mutation(api.employees.update, {
      token: fx.ownerToken,
      employeeId: fx.cajeroPlain,
      patch: { name: 'Ana T. Cambiada' },
    });

    const after = await t.run((ctx) => ctx.db.get('employees', fx.cajeroPlain));
    expect(after!.name).toBe('Ana T. Cambiada');
    // hash+salt unchanged
    expect(after!.pinHash).toBe(before!.pinHash);
    expect(after!.pinSalt).toBe(before!.pinSalt);
  });
});

// ---------------------------------------------------------------------------
// employees.updateSelf — AUTH-4 PIN hashing
// ---------------------------------------------------------------------------
describe('employees.updateSelf — AUTH-4 PIN hashing', () => {
  test('re-hashes own PIN with a fresh salt; non-PIN fields patch correctly', async () => {
    const { t, fx } = await setup();
    await t.mutation(api.employees.updateSelf, {
      token: fx.cajeroPlainToken,
      patch: { pin: '999888', name: 'Ana T. Nueva' },
    });

    const ana = await t.run((ctx) => ctx.db.get('employees', fx.cajeroPlain));
    expect(ana!).not.toHaveProperty('pin');
    expect(await verifyPin('999888', ana!.pinSalt!, ana!.pinHash!)).toBe(true);
    expect(ana!.name).toBe('Ana T. Nueva');
  });
});

// ---------------------------------------------------------------------------
// auth.me — public projection (AUTH-4)
// ---------------------------------------------------------------------------
describe('auth.me — public projection (AUTH-4)', () => {
  test('returned employee has no pin, pinHash, or pinSalt; has expected public fields', async () => {
    const { t, fx } = await setup();
    const me = await t.query(api.auth.me, { token: fx.ownerToken });

    expect(me).not.toBeNull();
    expect(me!).not.toHaveProperty('pin');
    expect(me!).not.toHaveProperty('pinHash');
    expect(me!).not.toHaveProperty('pinSalt');
    // Public fields intact
    expect(me!._id).toBe(fx.owner);
    expect(typeof me!.name).toBe('string');
    expect(typeof me!.email).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// auth.login — correct PIN against STORED HASH (AUTH-4)
// ---------------------------------------------------------------------------
describe('auth.login — verifies against stored hash (AUTH-4)', () => {
  test('correct PIN succeeds; response has no pin/pinHash/pinSalt/_id', async () => {
    const { t } = await setup();
    const res = await t.mutation(api.auth.login, {
      email: 'carlos@mitienda.com',
      pin: '482106',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok login');
    expect(typeof res.token).toBe('string');
    expect(res.expiresAt).toBeGreaterThan(Date.now());
    expect(res).not.toHaveProperty('pin');
    expect(res).not.toHaveProperty('pinHash');
    expect(res).not.toHaveProperty('pinSalt');
    expect(res).not.toHaveProperty('_id');
  });

  test('wrong PIN fails; rate-limit counter still increments', async () => {
    const { t } = await setup();
    const res = await t.mutation(api.auth.login, {
      email: 'carlos@mitienda.com',
      pin: '000000',
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error).toBe('Credenciales inválidas. Verifica e intenta de nuevo.');

    // AUTH-3 counter still increments after a hash-compare failure
    const row = await t.run((ctx) =>
      ctx.db
        .query('loginAttempts')
        .withIndex('by_email', (q) => q.eq('email', 'carlos@mitienda.com'))
        .unique()
    );
    expect(row?.count).toBe(1);
  });

  test('success mints exactly one session row and bumps lastActive', async () => {
    const { t, fx } = await setup();
    const beforeSessions = await t.run((ctx) =>
      ctx.db.query('sessions').collect()
    );

    await t.mutation(api.auth.login, {
      email: 'carlos@mitienda.com',
      pin: '482106',
    });

    const afterSessions = await t.run((ctx) =>
      ctx.db.query('sessions').collect()
    );
    expect(afterSessions.length).toBe(beforeSessions.length + 1);

    const emp = await t.run((ctx) => ctx.db.get('employees', fx.owner));
    expect(typeof emp!.lastActive).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// seed.run — seeded employees have pinHash/pinSalt; owner can log in (AUTH-4)
// ---------------------------------------------------------------------------
describe('seed.run — AUTH-4 hashed PINs end-to-end', () => {
  test('seeded employees have pinHash/pinSalt, no pin; owner login with known PIN succeeds', async () => {
    const t = convexTest(schema, modules);

    // Run the internal seed mutation
    await t.run(async (ctx) => {
      await ctx.runMutation(internal.seed.run, {});
    });

    // Owner row must have pinHash/pinSalt, not pin
    const owner = await t.run(async (ctx) => {
      const emps = await ctx.db.query('employees').collect();
      return emps.find((e) => e.email === 'carlos@mitienda.com') ?? null;
    });
    expect(owner).not.toBeNull();
    expect(owner!).not.toHaveProperty('pin');
    expect(typeof owner!.pinHash).toBe('string');
    expect(owner!.pinHash!.length).toBe(64);
    expect(typeof owner!.pinSalt).toBe('string');

    // Login with the known owner PIN must succeed end-to-end
    const res = await t.mutation(api.auth.login, {
      email: 'carlos@mitienda.com',
      pin: '482106',
    });
    expect(res.ok).toBe(true);
  });
});
