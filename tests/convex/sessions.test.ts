/// <reference types="vite/client" />
// requireSession — the authentication trust boundary that replaced the trusted
// `actorId`. It validates the client-supplied token and returns the acting
// employee, rejecting unknown / expired / inactive ones. A raw document id is
// no longer a valid credential.
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '@convex/_generated/api';
import schema from '@convex/schema';
import { requireSession } from '@convex/permissions';
import { ABSOLUTE_TTL_MS, hashToken, IDLE_TTL_MS } from '@convex/sessions';
import { mintSession, seedBase } from './fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await t.run(seedBase);
  return { t, fx };
}

const REJECT = 'Sesión inválida o expirada. Inicia sesión de nuevo.';

describe('requireSession', () => {
  test('a valid token returns the bound employee and bumps lastSeenAt', async () => {
    const { t, fx } = await setup();
    const token = await t.run((ctx) => mintSession(ctx, fx.owner));
    const tokenHash = await hashToken(token);

    // Force lastSeenAt into the past so the bump is unambiguously observable.
    await t.run(async (ctx) => {
      const s = await ctx.db
        .query('sessions')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
        .unique();
      await ctx.db.patch('sessions', s!._id, { lastSeenAt: 0 });
    });

    const employee = await t.run((ctx) => requireSession(ctx, token));
    expect(employee._id).toBe(fx.owner);

    const after = await t.run((ctx) =>
      ctx.db
        .query('sessions')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
        .unique()
    );
    expect(after!.lastSeenAt).toBeGreaterThan(0); // patched by requireSession
  });

  test('an unknown token throws', async () => {
    const { t } = await setup();
    await expect(
      t.run((ctx) => requireSession(ctx, 'not-a-real-token'))
    ).rejects.toThrow(REJECT);
  });

  test('a raw employee document id is NOT accepted as a token', async () => {
    const { t, fx } = await setup();
    await expect(
      t.run((ctx) => requireSession(ctx, fx.owner as unknown as string))
    ).rejects.toThrow(REJECT);
  });

  test('an expired session throws', async () => {
    const { t, fx } = await setup();
    const expired = await t.run((ctx) =>
      mintSession(ctx, fx.owner, { expiresAt: Date.now() - 1 })
    );
    await expect(
      t.run((ctx) => requireSession(ctx, expired))
    ).rejects.toThrow(REJECT);
  });

  test('a session bound to an inactive employee throws', async () => {
    const { t, fx } = await setup();
    // fx.inactiveToken is a real session row for the (active === false) employee.
    await expect(
      t.run((ctx) => requireSession(ctx, fx.inactiveToken))
    ).rejects.toThrow(REJECT);
  });

  test('a session whose employee was deleted throws', async () => {
    const { t, fx } = await setup();
    const token = await t.run((ctx) => mintSession(ctx, fx.cajeroPlain));
    await t.run((ctx) => ctx.db.delete('employees', fx.cajeroPlain));
    await expect(
      t.run((ctx) => requireSession(ctx, token))
    ).rejects.toThrow(REJECT);
  });
});

describe('requireSession — sliding idle window + absolute cap', () => {
  test('a mutation slides the idle deadline forward (and bumps lastSeenAt)', async () => {
    const { t, fx } = await setup();
    // A near-future idle deadline that is still valid, so the slide is visible.
    const soon = Date.now() + 1000;
    const token = await t.run((ctx) =>
      mintSession(ctx, fx.owner, { expiresAt: soon })
    );
    const tokenHash = await hashToken(token);

    // t.run hands requireSession a MUTATION ctx → it slides + bumps.
    await t.run((ctx) => requireSession(ctx, token));

    const after = await t.run((ctx) =>
      ctx.db
        .query('sessions')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
        .unique()
    );
    // expiresAt jumped from `soon` up to ~now + IDLE_TTL_MS.
    expect(after!.expiresAt).toBeGreaterThan(soon);
    expect(after!.expiresAt).toBeGreaterThan(Date.now() + IDLE_TTL_MS - 5_000);
    expect(after!.lastSeenAt).toBeGreaterThan(0);
  });

  test('a query context validates WITHOUT sliding the idle deadline', async () => {
    const { t, fx } = await setup();
    const fixed = Date.now() + 60_000;
    const token = await t.run((ctx) =>
      mintSession(ctx, fx.owner, { expiresAt: fixed })
    );
    const tokenHash = await hashToken(token);

    // sales.history is a QUERY gated by requireSession → read-only, no slide.
    await t.query(api.sales.history, { token });

    const after = await t.run((ctx) =>
      ctx.db
        .query('sessions')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
        .unique()
    );
    expect(after!.expiresAt).toBe(fixed); // unchanged — queries never slide
  });

  test('an idle-expired session (cap still fresh) is rejected', async () => {
    const { t, fx } = await setup();
    const token = await t.run((ctx) =>
      mintSession(ctx, fx.owner, {
        expiresAt: Date.now() - 1, // idled out
        absoluteExpiresAt: Date.now() + ABSOLUTE_TTL_MS, // cap NOT reached
      })
    );
    await expect(
      t.run((ctx) => requireSession(ctx, token))
    ).rejects.toThrow(REJECT);
  });

  test('a session past the absolute cap is rejected even with a fresh idle window', async () => {
    const { t, fx } = await setup();
    const token = await t.run((ctx) =>
      mintSession(ctx, fx.owner, {
        expiresAt: Date.now() + IDLE_TTL_MS, // idle window fresh
        absoluteExpiresAt: Date.now() - 1, // cap exceeded
      })
    );
    await expect(
      t.run((ctx) => requireSession(ctx, token))
    ).rejects.toThrow(REJECT);
  });

  test('sliding never pushes the idle deadline past the absolute cap', async () => {
    const { t, fx } = await setup();
    const cap = Date.now() + 60_000; // 1 min away — far less than IDLE_TTL_MS
    const token = await t.run((ctx) =>
      mintSession(ctx, fx.owner, {
        expiresAt: Date.now() + 1000,
        absoluteExpiresAt: cap,
      })
    );
    const tokenHash = await hashToken(token);

    await t.run((ctx) => requireSession(ctx, token));

    const after = await t.run((ctx) =>
      ctx.db
        .query('sessions')
        .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
        .unique()
    );
    expect(after!.expiresAt).toBe(cap); // clamped to the cap, not now + IDLE_TTL_MS
    expect(after!.expiresAt).toBeLessThan(Date.now() + IDLE_TTL_MS);
  });
});
