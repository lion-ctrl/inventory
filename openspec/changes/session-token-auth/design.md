## Context

Today `login` (`convex/auth.ts:8-40`) returns the full employee doc; the client persists `employee._id` in `localStorage` (`pos.employeeId`) and sends it back as `actorId` to every privileged function, where `requirePerm` (`convex/permissions.ts:34-44`) does `ctx.db.get('employees', actorId)`. The document `_id` is therefore a permanent, non-secret bearer credential, and it leaks: `sales.history` and `heldCarts.list` return `cashierId`. There is no external identity provider — auth is email + 6-digit PIN by explicit owner decision (no auth package). Convex runs the client over a WebSocket authenticated from JS, on a cross-origin deployment, so cookie-based sessions do not apply.

## Goals / Non-Goals

**Goals:**
- The credential is a high-entropy **session token**, not a document id.
- The token **expires** — by **inactivity** (a 30-minute idle window, slid forward by activity) and by a hard **absolute cap** (24h from login) — and is **revocable** server-side (`logout`).
- Privileged functions authenticate via the session; a raw employee id is no longer accepted.
- Public reads stop handing out employee identity credentials (`cashierId`).
- No behavioral change for the cashier beyond re-logging in once.

**Non-Goals (deferred to a follow-up change `login-hardening`):**
- PIN hashing and removing the PIN from responses (AUTH-4).
- Login rate-limiting / lockout (AUTH-3).
- Content-Security-Policy hardening (AUTH-5).
- Multi-device session management UI, and scheduled cleanup of expired rows. (Sliding idle expiry + an absolute cap ARE now in scope for this change — see Decision 7.)

## Decisions

**1. Custom `sessions` table + random token — not Convex Auth / `ctx.auth`.**
Convex's built-in auth (`ctx.auth.getUserIdentity()`) expects an external OIDC/JWT issuer; there is none here (PIN login). The idiomatic fit for self-managed credentials is a `sessions` table holding the token, validated per function. Alternative considered: JWT signed in-function — rejected, because revocation then needs a denylist table anyway, so a session row is simpler and gives revocation for free.

```ts
sessions: defineTable({
  employeeId: v.id('employees'),
  tokenHash: v.string(),         // sha256(token); the raw token is never stored
  expiresAt: v.number(),         // IDLE deadline — slides forward on activity
  absoluteExpiresAt: v.number(), // hard cap fixed at login — never slides
  lastSeenAt: v.number(),
}).index('by_tokenHash', ['tokenHash']).index('by_employee', ['employeeId'])
```

**2. Token generation + hash-at-rest.** `login` mints `crypto.getRandomValues(new Uint8Array(32))` → base64url (256 bits of entropy), stores `sha256(token)` via `crypto.subtle.digest('SHA-256', …)`, and returns the **raw token once**. Web Crypto is available in Convex's default runtime — no `"use node"`. The lookup hashes the client-supplied token and queries `by_tokenHash`. A fast hash (SHA-256, not PBKDF2/bcrypt) is correct here because the token is already high-entropy — slow KDFs are only needed for low-entropy secrets like the 6-digit PIN (that is AUTH-4's concern, not this one).

**3. `requireSession(ctx, token)` replaces the `actorId` trust boundary.** New helper: hash token → `by_tokenHash` lookup → reject if absent / past the idle deadline (`expiresAt`) / past the absolute cap (`absoluteExpiresAt`) / employee `active === false`; on success (in a mutation ctx) **slide** `expiresAt = min(now + IDLE_TTL_MS, absoluteExpiresAt)` and bump `lastSeenAt`, then return the employee (queries validate without writing). See Decision 7. `requirePerm` is refactored from `(ctx, actorId, perm)` to `(employee, perm)`. Each privileged function becomes: `const employee = await requireSession(ctx, args.token); requirePerm(employee, 'perm');`. The ~22 functions swap `actorId: v.id('employees')` for `token: v.string()` in their `args`.

**4. Keep the stored `cashierId`; drop it only from query *returns*.** The `sales`/`heldCarts` tables keep `cashierId` for audit. We only remove it from the public `returns` validators (`sales.history` `sales.ts:217`, `heldCarts.list` `heldCarts.ts:12`) and gate those reads behind `requireSession`. The UI already renders the `cashierName` snapshot, so no client display breaks.

**5. Boot revalidation moves from id → token.** The client's boot check (`me`) takes the token instead of the employee id; an unknown/expired token resolves to `null` (show login), mirroring how `me` already tolerates a stale id without throwing.

**6. `settings.get` stays public (decision, not oversight).** The login screen needs store branding (name/logo) before a session exists. It returns only non-sensitive store config, so it remains a public read — documented, not silently left open.

**7. Expiry is a sliding 30-minute idle window under a 24-hour absolute cap (resolves the prior "fixed 12h" open question).** `expiresAt` is reinterpreted as the IDLE deadline, and a new `absoluteExpiresAt` is the hard ceiling fixed at login. Tunable constants `IDLE_TTL_MS = 30 * 60 * 1000` and `ABSOLUTE_TTL_MS = 24 * 60 * 60 * 1000` live in `convex/sessions.ts` (replacing the old `SESSION_TTL_MS`). `login` sets `expiresAt = now + IDLE_TTL_MS` and `absoluteExpiresAt = now + ABSOLUTE_TTL_MS`. `resolveSession` rejects once `now >= expiresAt` OR `now >= absoluteExpiresAt`. `requireSession` — in a mutation ctx only — slides `expiresAt = min(now + IDLE_TTL_MS, absoluteExpiresAt)` and bumps `lastSeenAt`; query contexts validate without writing. A new `renewSession(token)` mutation lets the client extend the idle window mid-shift (returning the new `expiresAt`), and is rejected once past idle or the cap. The `min()` clamp guarantees a session can never outlive 24h no matter how often it renews. Why this shape: idle expiry shrinks the exposure window of a stolen, inactive token from 12h to 30 min, while the absolute cap bounds the worst case regardless of activity, and sliding keeps an active cashier from being kicked out mid-shift.

## Risks / Trade-offs

- **Wide blast radius (~22 functions + every `useMutation` call site).** → Migrate table-by-table with tests green at each step, in one coordinated change; `requirePerm`'s new signature makes the compiler flag every site that still passes `actorId`.
- **Token still lives in `localStorage` → XSS can steal it.** → This change makes the stolen token **short-lived and revocable** (limited, killable window) — a strict improvement over the permanent id. Full XSS defense (CSP, optional in-memory storage) is AUTH-5. Residual risk acknowledged.
- **Expired sessions accumulate as dead rows.** → Harmless (always rejected); a scheduled cleanup cron is a later nicety, out of scope.
- **All callers break at once (args change).** → Acceptable: single deployment, single client bundle; users simply re-login once (stale `pos.employeeId` is discarded).

## Migration Plan

Dummy/dev data, so this is low-risk and needs **no destructive migration**:
1. Adding the `sessions` table is additive — the schema push succeeds against existing data (no field removed from a populated table).
2. The `actorId → token` arg changes and the `cashierId` removal from `returns` are **code-only** (no table change).
3. Deploy; the client clears the now-useless `pos.employeeId` and shows login. Each user logs in once to get a token.
4. Re-seeding is **optional** (not required for this change). When `login-hardening` (AUTH-4) lands and PINs are hashed, a clear + re-seed will be the simplest path then.

Rollback: revert the change set; the previous `actorId` flow returns. (No data shape was destroyed — `sessions` rows are simply ignored.)

## Open Questions

_Resolved._ The earlier "sliding vs fixed 12h" and "idle vs absolute" questions are decided in **Decision 7**: a 30-minute idle window slid forward by activity (and by `renewSession`), under a 24-hour absolute cap. `expiresAt` is now the idle deadline and `absoluteExpiresAt` the hard ceiling. No open questions remain for this change. (Scheduled cleanup of expired rows and multi-device session UI stay out of scope.)
