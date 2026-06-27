// Plain employees-table login (email + 6-digit PIN). No auth package — by
// explicit owner decision. Login no longer hands back the employee document
// `_id` as the credential; it mints a hashed, expiring SESSION TOKEN (returned
// once) that the client persists and replays on every privileged call.
//
// NOTE: the plaintext PIN compare is DELIBERATELY kept here — PIN hashing and
// removing the PIN from any response is the deferred `login-hardening` change.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { employeeDocValidator } from './schema';
import { resolveSession } from './permissions';
import {
  generateToken,
  hashToken,
  IDLE_TTL_MS,
  ABSOLUTE_TTL_MS,
} from './sessions';

export const login = mutation({
  args: {
    email: v.string(),
    pin: v.string(),
  },
  // The success branch returns ONLY the raw token + its expiry — never the
  // employee `_id` or `pin`. The token is the credential, surfaced this once.
  returns: v.union(
    v.object({
      ok: v.literal(true),
      token: v.string(),
      expiresAt: v.number(),
    }),
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

    // Mint a session: store only the hash, return the raw token once. The
    // returned `expiresAt` is the IDLE deadline (when the client must renew or
    // re-login); the 24h absolute cap is stored but not surfaced.
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const now = Date.now();
    const expiresAt = now + IDLE_TTL_MS;
    const absoluteExpiresAt = now + ABSOLUTE_TTL_MS;
    await ctx.db.insert('sessions', {
      employeeId: employee._id,
      tokenHash,
      expiresAt,
      absoluteExpiresAt,
      lastSeenAt: now,
    });
    await ctx.db.patch('employees', employee._id, { lastActive: now });

    return { ok: true as const, token, expiresAt };
  },
});

export const logout = mutation({
  // Real server-side revocation: delete the session row so the token is
  // immediately unusable everywhere, not merely cleared on the client.
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .unique();
    if (session) await ctx.db.delete('sessions', session._id);
    return null;
  },
});

export const me = query({
  // Boot revalidation: the client persists the TOKEN (not the id). A stale or
  // expired token from an older deployment must resolve to null — NEVER throw.
  args: { token: v.union(v.string(), v.null()) },
  returns: v.union(employeeDocValidator, v.null()),
  handler: async (ctx, args) => {
    const resolved = await resolveSession(ctx, args.token);
    return resolved ? resolved.employee : null;
  },
});

export const renewSession = mutation({
  // Sliding-window heartbeat: the client calls this to push the IDLE deadline
  // forward while a cashier stays active — WITHOUT ever exceeding the 24h
  // absolute cap (the returned expiresAt is clamped to absoluteExpiresAt). A
  // session already idled out, past its cap, or otherwise invalid is rejected so
  // the client must re-login. Mirrors `login`'s `{ ok }` discriminated union and
  // reuses the same reject copy as `requireSession`.
  args: { token: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), expiresAt: v.number() }),
    v.object({ ok: v.literal(false), error: v.string() })
  ),
  handler: async (ctx, args) => {
    const resolved = await resolveSession(ctx, args.token);
    if (!resolved) {
      return {
        ok: false as const,
        error: 'Sesión inválida o expirada. Inicia sesión de nuevo.',
      };
    }
    // Clamp the slid idle deadline to the absolute cap — never beyond it.
    const now = Date.now();
    const expiresAt = Math.min(
      now + IDLE_TTL_MS,
      resolved.session.absoluteExpiresAt
    );
    await ctx.db.patch('sessions', resolved.session._id, {
      expiresAt,
      lastSeenAt: now,
    });
    return { ok: true as const, expiresAt };
  },
});
