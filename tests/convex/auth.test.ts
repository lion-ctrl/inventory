/// <reference types="vite/client" />
// Session-token auth: login mints a hashed, expiring token (NEVER the doc _id),
// logout revokes it server-side, and me() revalidates a token on boot.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import schema from '@convex/schema';
import { ABSOLUTE_TTL_MS, hashToken, IDLE_TTL_MS } from '@convex/sessions';
import { LOCKOUT_MSG, MAX_ATTEMPTS, WINDOW_MS } from '@convex/auth';
import { mintSession, seedBase } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
  return { t, fx };
}

describe('auth.login', () => {
  test('correct credentials mint a token — no _id or pin in the response', async () => {
    const { t, fx } = await setup();
    const res = await t.mutation(api.auth.login, {
      email: '  CARLOS@Mitienda.com ', // messy casing/whitespace still matches
      pin: '482106',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok login');
    // The credential is a fresh random token + its expiry — nothing else.
    expect(typeof res.token).toBe('string');
    expect(res.token.length).toBeGreaterThan(0);
    expect(res.expiresAt).toBeGreaterThan(Date.now());
    // The login RESPONSE must never hand back the id/pin as the auth means.
    expect(res).not.toHaveProperty('employee');
    expect(res).not.toHaveProperty('_id');
    expect(res).not.toHaveProperty('pin');
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('482106'); // the PIN
    expect(serialized).not.toContain(fx.owner); // the employee document id
  });

  test('the persisted session stores only the hash, never the raw token', async () => {
    const { t, fx } = await setup();
    const res = await t.mutation(api.auth.login, {
      email: 'carlos@mitienda.com',
      pin: '482106',
    });
    if (!res.ok) throw new Error('expected ok login');

    const expectedHash = await hashToken(res.token);
    const session = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('sessions')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', expectedHash))
        .unique();
      return rows;
    });

    expect(session).not.toBeNull();
    expect(session!.employeeId).toBe(fx.owner);
    expect(session!.tokenHash).toBe(expectedHash);
    expect(session!.tokenHash).not.toBe(res.token); // hash at rest, not the raw
    expect(session!.expiresAt).toBe(res.expiresAt);
  });

  test('a successful login still bumps the employee lastActive', async () => {
    const { t, fx } = await setup();
    const before = await t.run((ctx) => ctx.db.get('employees', fx.owner));
    await t.mutation(api.auth.login, {
      email: 'carlos@mitienda.com',
      pin: '482106',
    });
    const after = await t.run((ctx) => ctx.db.get('employees', fx.owner));
    expect(typeof after!.lastActive).toBe('number');
    expect(after!.lastActive!).toBeGreaterThanOrEqual(before!.lastActive ?? 0);
  });

  test('wrong PIN and unknown email share one generic error and mint no session', async () => {
    const { t } = await setup();
    const before = await t.run((ctx) => ctx.db.query('sessions').collect());

    const wrongPin = await t.mutation(api.auth.login, {
      email: 'carlos@mitienda.com',
      pin: '000000',
    });
    expect(wrongPin).toEqual({
      ok: false,
      error: 'Credenciales inválidas. Verifica e intenta de nuevo.',
    });

    const unknown = await t.mutation(api.auth.login, {
      email: 'nadie@mitienda.com',
      pin: '482106',
    });
    expect(unknown).toEqual({
      ok: false,
      error: 'Credenciales inválidas. Verifica e intenta de nuevo.',
    });

    const after = await t.run((ctx) => ctx.db.query('sessions').collect());
    expect(after).toHaveLength(before.length); // no new session rows created
  });

  test('inactive employees get the inactive error and no session', async () => {
    const { t } = await setup();
    const res = await t.mutation(api.auth.login, {
      email: 'carlos.rivas@mitienda.com',
      pin: '864253',
    });
    expect(res).toEqual({
      ok: false,
      error: 'Usuario inactivo. Contacta al propietario.',
    });
  });
});

describe('auth.logout', () => {
  test('deletes the session so the token is rejected by a privileged call', async () => {
    const { t } = await setup();
    const res = await t.mutation(api.auth.login, {
      email: 'carlos@mitienda.com',
      pin: '482106',
    });
    if (!res.ok) throw new Error('expected ok login');

    // The fresh token authenticates a privileged read.
    await expect(
      t.query(api.sales.history, { token: res.token })
    ).resolves.toBeDefined();

    await t.mutation(api.auth.logout, { token: res.token });

    // After logout the session is gone → the same token is rejected.
    await expect(
      t.query(api.sales.history, { token: res.token })
    ).rejects.toThrow('Sesión inválida o expirada. Inicia sesión de nuevo.');
  });

  test('is a silent no-op for an unknown token', async () => {
    const { t } = await setup();
    await expect(
      t.mutation(api.auth.logout, { token: 'not-a-real-token' })
    ).resolves.toBeNull();
  });
});

describe('auth.me — boot revalidation by token', () => {
  test('resolves the employee for a valid token', async () => {
    const { t, fx } = await setup();
    const me = await t.query(api.auth.me, { token: fx.ownerToken });
    expect(me?._id).toBe(fx.owner);
  });

  test('returns null (never throws) for null, garbage, inactive or expired tokens', async () => {
    const { t, fx } = await setup();

    await expect(t.query(api.auth.me, { token: null })).resolves.toBeNull();
    await expect(
      t.query(api.auth.me, { token: 'garbage-from-an-old-deployment' })
    ).resolves.toBeNull();

    // A session bound to an INACTIVE employee resolves to null.
    await expect(
      t.query(api.auth.me, { token: fx.inactiveToken })
    ).resolves.toBeNull();

    // An EXPIRED session resolves to null.
    const expiredToken = await t.run((ctx) =>
      mintSession(ctx, fx.owner, { expiresAt: Date.now() - 1000 })
    );
    await expect(
      t.query(api.auth.me, { token: expiredToken })
    ).resolves.toBeNull();
  });

  test('returns null after the employee behind a valid token is deleted', async () => {
    const { t, fx } = await setup();
    const token = await t.run((ctx) => mintSession(ctx, fx.cajeroPlain));
    await t.run((ctx) => ctx.db.delete('employees', fx.cajeroPlain));
    await expect(t.query(api.auth.me, { token })).resolves.toBeNull();
  });
});

describe('auth.login — idle deadline + absolute cap', () => {
  test('sets expiresAt to the idle TTL and stores a 72h absolute cap', async () => {
    const { t } = await setup();
    const before = Date.now();
    const res = await t.mutation(api.auth.login, {
      email: 'carlos@mitienda.com',
      pin: '482106',
    });
    if (!res.ok) throw new Error('expected ok login');
    const after = Date.now();

    // The returned expiresAt is the IDLE deadline (~2 h out), not 12h.
    expect(res.expiresAt).toBeGreaterThanOrEqual(before + IDLE_TTL_MS);
    expect(res.expiresAt).toBeLessThanOrEqual(after + IDLE_TTL_MS);

    const session = await t.run(async (ctx) => {
      const hash = await hashToken(res.token);
      return ctx.db
        .query('sessions')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', hash))
        .unique();
    });
    expect(session!.expiresAt).toBe(res.expiresAt);
    // absoluteExpiresAt is the 72h cap, strictly beyond the idle deadline.
    expect(session!.absoluteExpiresAt).toBeGreaterThanOrEqual(
      before + ABSOLUTE_TTL_MS
    );
    expect(session!.absoluteExpiresAt).toBeLessThanOrEqual(
      after + ABSOLUTE_TTL_MS
    );
    expect(session!.absoluteExpiresAt).toBeGreaterThan(session!.expiresAt);
  });
});

describe('auth.renewSession', () => {
  test('renews a valid session, pushing expiresAt forward and persisting it', async () => {
    const { t, fx } = await setup();
    const soon = Date.now() + 1000;
    const token = await t.run((ctx) =>
      mintSession(ctx, fx.owner, { expiresAt: soon })
    );

    const res = await t.mutation(api.auth.renewSession, { token });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok renew');
    expect(res.expiresAt).toBeGreaterThan(soon);

    const tokenHash = await hashToken(token);
    const session = await t.run((ctx) =>
      ctx.db
        .query('sessions')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
        .unique()
    );
    expect(session!.expiresAt).toBe(res.expiresAt); // persisted, not just returned
  });

  test('rejects renewal once the idle window has passed (must re-login)', async () => {
    const { t, fx } = await setup();
    const token = await t.run((ctx) =>
      mintSession(ctx, fx.owner, { expiresAt: Date.now() - 1 })
    );
    const res = await t.mutation(api.auth.renewSession, { token });
    expect(res.ok).toBe(false);
  });

  test('rejects renewal once the absolute cap has passed (must re-login)', async () => {
    const { t, fx } = await setup();
    const token = await t.run((ctx) =>
      mintSession(ctx, fx.owner, {
        expiresAt: Date.now() + IDLE_TTL_MS, // idle window fresh
        absoluteExpiresAt: Date.now() - 1, // cap exceeded
      })
    );
    const res = await t.mutation(api.auth.renewSession, { token });
    expect(res.ok).toBe(false);
  });

  test('never pushes expiresAt beyond the absolute cap (clamp)', async () => {
    const { t, fx } = await setup();
    const cap = Date.now() + 60_000; // 1 min — far less than IDLE_TTL_MS
    const token = await t.run((ctx) =>
      mintSession(ctx, fx.owner, {
        expiresAt: Date.now() + 1000,
        absoluteExpiresAt: cap,
      })
    );
    const res = await t.mutation(api.auth.renewSession, { token });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok renew');
    expect(res.expiresAt).toBe(cap); // clamped to the cap, not now + IDLE_TTL_MS
    expect(res.expiresAt).toBeLessThan(Date.now() + IDLE_TTL_MS);
  });

  test('rejects an unknown token', async () => {
    const { t } = await setup();
    const res = await t.mutation(api.auth.renewSession, {
      token: 'not-a-real-token',
    });
    expect(res.ok).toBe(false);
  });
});

// AUTH-3 — login rate-limiting / lockout. A 6-digit PIN is brute-forceable, so
// `login` counts FAILED attempts per normalized email in a fixed window
// (`loginAttempts` sentinel) and locks the email out after MAX_ATTEMPTS — even
// when the correct PIN is later supplied — with a generic message that can't be
// used to probe which emails exist. Success clears the counter; the window
// auto-lifts. These assert behaviour against the SAME constants the handler uses.
describe('auth.login — rate limiting / lockout (AUTH-3)', () => {
  const REAL_EMAIL = 'carlos@mitienda.com';
  const REAL_PIN = '482106';
  const WRONG_PIN = '000000';
  const WRONG_CREDS = 'Credenciales inválidas. Verifica e intenta de nuevo.';

  const attemptRow = (t: Awaited<ReturnType<typeof setup>>['t'], email: string) =>
    t.run((ctx) =>
      ctx.db
        .query('loginAttempts')
        .withIndex('by_email', (q) => q.eq('email', email))
        .unique()
    );

  const countSessions = async (t: Awaited<ReturnType<typeof setup>>['t']) =>
    (await t.run((ctx) => ctx.db.query('sessions').collect())).length;

  test('fewer than MAX_ATTEMPTS failures never trigger the lockout', async () => {
    const { t } = await setup();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      const res = await t.mutation(api.auth.login, {
        email: REAL_EMAIL,
        pin: WRONG_PIN,
      });
      expect(res).toEqual({ ok: false, error: WRONG_CREDS });
    }
    // Counter sits one short of the cap — still no lockout.
    const row = await attemptRow(t, REAL_EMAIL);
    expect(row?.count).toBe(MAX_ATTEMPTS - 1);
  });

  test('the (MAX+1)th attempt is rejected even with the CORRECT PIN, minting no session', async () => {
    const { t } = await setup();
    const before = await countSessions(t);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const res = await t.mutation(api.auth.login, {
        email: REAL_EMAIL,
        pin: WRONG_PIN,
      });
      expect(res).toEqual({ ok: false, error: WRONG_CREDS });
    }

    // Correct PIN, but the lockout fires BEFORE credentials are evaluated.
    const locked = await t.mutation(api.auth.login, {
      email: REAL_EMAIL,
      pin: REAL_PIN,
    });
    expect(locked).toEqual({ ok: false, error: LOCKOUT_MSG });
    expect(await countSessions(t)).toBe(before); // no session while locked
  });

  test('the lockout lifts once the fixed window has expired', async () => {
    const { t } = await setup();
    // Plant a maxed-out counter whose window already elapsed.
    await t.run((ctx) =>
      ctx.db.insert('loginAttempts', {
        email: REAL_EMAIL,
        windowStart: Date.now() - WINDOW_MS - 1,
        count: MAX_ATTEMPTS,
      })
    );

    const res = await t.mutation(api.auth.login, {
      email: REAL_EMAIL,
      pin: REAL_PIN,
    });
    expect(res.ok).toBe(true); // expired window → fresh attempt → succeeds
    // The successful login also cleared the stale sentinel.
    expect(await attemptRow(t, REAL_EMAIL)).toBeNull();
  });

  test('a failure after the window expired restarts the counter at 1 (no duplicate rows)', async () => {
    const { t } = await setup();
    await t.run((ctx) =>
      ctx.db.insert('loginAttempts', {
        email: REAL_EMAIL,
        windowStart: Date.now() - WINDOW_MS - 1,
        count: MAX_ATTEMPTS,
      })
    );

    // Wrong PIN: window is expired so NOT locked → recorded as a fresh failure.
    const res = await t.mutation(api.auth.login, {
      email: REAL_EMAIL,
      pin: WRONG_PIN,
    });
    expect(res).toEqual({ ok: false, error: WRONG_CREDS });

    // Exactly ONE row remains (stale window reset in place, not duplicated —
    // `.unique()` would throw if a duplicate existed) with a fresh count of 1.
    const rows = await t.run((ctx) =>
      ctx.db
        .query('loginAttempts')
        .withIndex('by_email', (q) => q.eq('email', REAL_EMAIL))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
    expect(Date.now() - rows[0].windowStart).toBeLessThanOrEqual(WINDOW_MS);
  });

  test('a successful login resets the counter to a clean slate', async () => {
    const { t } = await setup();
    for (let i = 0; i < 3; i++) {
      await t.mutation(api.auth.login, { email: REAL_EMAIL, pin: WRONG_PIN });
    }
    expect((await attemptRow(t, REAL_EMAIL))?.count).toBe(3);

    const ok = await t.mutation(api.auth.login, {
      email: REAL_EMAIL,
      pin: REAL_PIN,
    });
    expect(ok.ok).toBe(true);
    expect(await attemptRow(t, REAL_EMAIL)).toBeNull(); // counter removed

    // The next failure is the FIRST of a brand-new window, not a lockout.
    const next = await t.mutation(api.auth.login, {
      email: REAL_EMAIL,
      pin: WRONG_PIN,
    });
    expect(next).toEqual({ ok: false, error: WRONG_CREDS });
    expect((await attemptRow(t, REAL_EMAIL))?.count).toBe(1);
  });

  test('an unknown email is counted and locks out with the SAME message — no enumeration', async () => {
    const { t } = await setup();
    const ghost = 'ghost@nowhere.com';

    // Drive both a real and a non-existent email to the threshold.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await t.mutation(api.auth.login, { email: REAL_EMAIL, pin: WRONG_PIN });
      await t.mutation(api.auth.login, { email: ghost, pin: WRONG_PIN });
    }

    const realLocked = await t.mutation(api.auth.login, {
      email: REAL_EMAIL,
      pin: REAL_PIN,
    });
    const ghostLocked = await t.mutation(api.auth.login, {
      email: ghost,
      pin: REAL_PIN,
    });
    if (realLocked.ok || ghostLocked.ok) {
      throw new Error('expected both emails to be locked out');
    }

    // Byte-for-byte identical lockout error, and NOT the wrong-credentials copy.
    expect(realLocked.error).toBe(LOCKOUT_MSG);
    expect(ghostLocked.error).toBe(realLocked.error);
    expect(realLocked.error).not.toBe(WRONG_CREDS);

    // The unknown email accumulated a real counter — proof it was counted, so
    // lockout timing can't reveal which addresses exist.
    expect((await attemptRow(t, ghost))?.count).toBe(MAX_ATTEMPTS);
  });
});
