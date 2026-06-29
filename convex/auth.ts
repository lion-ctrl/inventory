// Plain employees-table login (email + 6-digit PIN). No auth package — by
// explicit owner decision. Login mints a hashed, expiring SESSION TOKEN
// (returned once) that the client persists and replays on every privileged call.
// AUTH-4: login now verifies the PIN against PBKDF2 hash+salt stored at rest
// (never plaintext). me() uses the publicEmployeeValidator projection so that
// pinHash/pinSalt never leave the server.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { publicEmployeeValidator } from './schema';
import { resolveSession } from './permissions';
import {
  generateToken,
  hashToken,
  verifyPin,
  IDLE_TTL_MS,
  ABSOLUTE_TTL_MS,
} from './sessions';

// ---------------------------------------------------------------------------
// AUTH-3 — login rate-limiting (homegrown fixed-window lockout; no dependency).
//
// A 6-digit PIN is only 10^6 combinations, so the public `login` endpoint must
// throttle brute force. We count FAILED attempts per normalized email in a
// fixed window via the `loginAttempts` sentinel table (one row per email):
// after MAX_ATTEMPTS failures the email is locked out for the rest of the
// window — even when the correct PIN is later supplied — and the lockout error
// is generic so it can never be used to probe which emails exist. A successful
// login clears the counter; the window auto-lifts with no admin action.
//
// Exported so the test suite asserts against the SAME values (single source of
// truth) and so the policy stays tunable in exactly one place. If WINDOW_MS
// changes, update the minutes quoted in LOCKOUT_MSG to match.
// ---------------------------------------------------------------------------
export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOCKOUT_MSG =
  'Demasiados intentos. Intenta de nuevo en 15 minutos.';

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
    const now = Date.now();

    // AUTH-3: read the rate-limit sentinel for this email BEFORE evaluating any
    // credentials, so a locked-out email never reveals whether the PIN matched.
    // `.unique()` is safe: the handler only ever UPSERTs one row per email.
    const attempt = await ctx.db
      .query('loginAttempts')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique();
    const withinWindow =
      attempt !== null && now - attempt.windowStart <= WINDOW_MS;

    // Locked out → reject immediately with the generic message. Do NOT evaluate
    // credentials and do NOT increment (the counter is already at the cap).
    if (attempt !== null && withinWindow && attempt.count >= MAX_ATTEMPTS) {
      return { ok: false as const, error: LOCKOUT_MSG };
    }

    const employees = await ctx.db.query('employees').collect();
    const employee =
      employees.find((e) => e.email.trim().toLowerCase() === email) ?? null;

    // AUTH-4: compare against the stored PBKDF2 hash; never plaintext.
    // verifyPin is only called when the employee row exists (short-circuit).
    const pinMatch = employee
      ? await verifyPin(args.pin, employee.pinSalt, employee.pinHash)
      : false;

    if (!employee || !pinMatch) {
      // Record the failed attempt. Single-row UPSERT keyed by email — never an
      // extra insert when a row exists, so the `.unique()` lookup stays valid.
      // Unknown emails are counted exactly like known ones (no enumeration).
      if (attempt === null) {
        await ctx.db.insert('loginAttempts', {
          email,
          windowStart: now,
          count: 1,
        });
      } else if (withinWindow) {
        await ctx.db.patch('loginAttempts', attempt._id, {
          count: attempt.count + 1,
        });
      } else {
        // Stale window → reset it in place (fresh window, count 1).
        await ctx.db.patch('loginAttempts', attempt._id, {
          windowStart: now,
          count: 1,
        });
      }
      return {
        ok: false as const,
        error: 'Credenciales inválidas. Verifica e intenta de nuevo.',
      };
    }
    if (!employee.active) {
      // Correct credentials but a disabled account: not a brute-force signal, so
      // the attempt counter is left untouched (neither incremented nor reset).
      return {
        ok: false as const,
        error: 'Usuario inactivo. Contacta al propietario.',
      };
    }

    // Success → clear this email's attempt counter (clean slate for next time),
    // then mint the session: store only the hash, return the raw token once. The
    // returned `expiresAt` is the IDLE deadline (when the client must renew or
    // re-login); the 72h absolute cap is stored but not surfaced.
    if (attempt) await ctx.db.delete('loginAttempts', attempt._id);

    const token = generateToken();
    const tokenHash = await hashToken(token);
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
  // AUTH-4: returns publicEmployeeValidator (pinHash/pinSalt stripped) so that
  // hashing material never leaves the server.
  args: { token: v.union(v.string(), v.null()) },
  returns: v.union(publicEmployeeValidator, v.null()),
  handler: async (ctx, args) => {
    const resolved = await resolveSession(ctx, args.token);
    if (!resolved) return null;
    const { pinHash: _h, pinSalt: _s, ...pub } = resolved.employee;
    return pub;
  },
});

export const renewSession = mutation({
  // Sliding-window heartbeat: the client calls this to push the IDLE deadline
  // forward while a cashier stays active — WITHOUT ever exceeding the 72h
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
