## Context

`login` (`convex/auth.ts`) normalizes the email via `args.email.trim().toLowerCase()`, finds the matching employee, compares the PIN in plaintext (`employee.pin !== args.pin`), checks `employee.active`, and on success mints a hashed, expiring session token (`generateToken` + `hashToken` from `convex/sessions.ts`). On failure it returns `{ ok: false, error: 'Credenciales inválidas. Verifica e intenta de nuevo.' }`. There is no attempt counter anywhere in this path — server or client. A 6-digit PIN is 10^6 combinations; at one attempt per second a brute-force run completes in under 12 days; at any realistic concurrency it is much faster.

The plaintext PIN compare is deliberately kept intact in this change. AUTH-4 (PIN hashing via PBKDF2) is deferred.

## Goals / Non-Goals

**Goals:**
- Count failed login attempts per normalized email in a fixed time window.
- Reject the (N+1)th attempt within the window with a generic lockout error — regardless of whether the credentials would otherwise be correct — so no credential information leaks after the threshold.
- Count attempts for unknown emails identically to attempts for known emails (no enumeration).
- Reset the counter on a successful login.
- Auto-lift the lockout when the window expires — no admin action required.
- Named, tunable constants for `MAX_ATTEMPTS` and `WINDOW_MS`.

**Non-Goals (deferred to later phases of this change):**
- AUTH-4: PIN hashing. Plaintext compare is kept; hashing requires a widen→backfill→narrow migration on `employees`. Later phase.
- AUTH-5: Content-Security-Policy headers. Client/build concern, no Convex code involved. Later phase.
- IP-based rate-limiting. Convex mutations do not expose client IP in the default runtime; per-email windowing is sufficient and accurate for a POS login endpoint.
- Scheduled cleanup of stale `loginAttempts` rows. They are logically expired by the window check and the table stays tiny for POS workloads.

## Decisions

**1. Homegrown fixed-window table — not `@convex-dev/rate-limiter`.**

The Convex rate-limiter component (`@convex-dev/rate-limiter`) would satisfy this requirement in terms of policy, but it introduces an explicit Convex component that must be registered in `convex.config.ts` via `app.use(...)`. That registration step:
- Requires a `convex.config.ts` file that does not currently exist in the project.
- Changes how the in-memory `convex-test` suite discovers and loads modules — `import.meta.glob` does not span component boundaries without additional configuration, which would require touching the test harness.
- Locks the rate-limit policy to the component's API surface and its release cadence.

A homegrown table achieves identical semantics, is purely additive code, is fully testable in-memory with `convex-test` as-is (no new test infrastructure), and is appropriate for POS login throughput (single-digit TPS at most). No dependency is added.

**2. Single-sentinel fixed-window row per email: `{ email, windowStart, count }`.**

Two shapes were evaluated:

| Shape | Rows written per attempt | Lockout check | Counter reset |
|-------|--------------------------|---------------|---------------|
| Per-attempt rows `{ email, at: v.number() }` | INSERT one row | Collect rows with `at >= now - WINDOW_MS`, count them | DELETE all rows for the email |
| Single sentinel `{ email, windowStart, count }` | UPSERT (patch or insert) | One-row index lookup + arithmetic | `ctx.db.delete(row._id)` or `patch({ count: 0 })` |

The sentinel is chosen: O(1) read and write per attempt, single-document transaction, simple reset. Fixed-window semantics are correct for this use case — the window begins at the first failed attempt.

Exact table definition that the implementer MUST mirror:

```ts
loginAttempts: defineTable({
  email: v.string(),       // normalized: trim() + toLowerCase() — same normalization as login
  windowStart: v.number(), // Date.now() when the current window began
  count: v.number(),       // failed attempts recorded so far in this window
}).index('by_email', ['email'])
```

`by_email` indexes only `['email']` — do NOT include `_creationTime` (Convex appends it automatically; including it in a custom index definition errors as `IndexNameReserved`).

**3. Enforcement constants.**

```ts
const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000; // 15 minutes
```

Both MUST be named constants so the policy is tunable in one place. Recommended location: top of `convex/auth.ts` (co-located with the code that uses them) or exported from `convex/sessions.ts` alongside the existing `IDLE_TTL_MS` / `ABSOLUTE_TTL_MS` constants — pick whichever is more consistent with the codebase pattern.

Optional global backstop: a sentinel row with `email = '__global__'` can accumulate a cross-email count. Define `GLOBAL_MAX` (e.g. 50) and check it alongside the per-email check to limit volumetric attacks that spread across many email addresses. This is optional; the per-email limit is the required guard.

**4. Enforcement order inside `login` — step by step.**

The implementer MUST follow this sequence:

1. **Normalize** email: `const email = args.email.trim().toLowerCase()`.
2. **Sentinel lookup**: `ctx.db.query('loginAttempts').withIndex('by_email', q => q.eq('email', email)).unique()`.
3. **Lockout check**: if the row exists AND `Date.now() - row.windowStart <= WINDOW_MS` AND `row.count >= MAX_ATTEMPTS` → return `{ ok: false as const, error: LOCKOUT_MSG }` immediately. Do NOT evaluate credentials. Do NOT increment (the counter is already at the cap).
4. **Credential evaluation** (existing, unchanged): employee lookup by email, plaintext PIN compare, `active` check.
5. **On credential failure** — record the attempt:
   - If no row exists, OR the existing row's window has expired (`Date.now() - row.windowStart > WINDOW_MS`): `ctx.db.insert('loginAttempts', { email, windowStart: Date.now(), count: 1 })`.
   - If within window (count < MAX, since step 3 passed): `ctx.db.patch(row._id, { count: row.count + 1 })`.
   - Return the existing wrong-credentials error.
6. **On success** — reset the counter then mint the session:
   - Delete the sentinel row if it exists: `if (row) await ctx.db.delete('loginAttempts', row._id)`.
   - Mint and return the session (existing logic, unchanged).

**5. Lockout message — generic, enumeration-safe.**

```ts
const LOCKOUT_MSG = 'Demasiados intentos. Intenta de nuevo en 15 minutos.';
```

This message MUST be a named constant so it stays consistent across the handler and tests. It MUST be identical regardless of whether the email address exists in `employees`. It is intentionally distinct from the wrong-credentials error (`'Credenciales inválidas. Verifica e intenta de nuevo.'`). The window duration in the string matches `WINDOW_MS / 60_000` minutes; if `WINDOW_MS` changes, update the string too.

**6. AUTH-4 (PIN hashing) — later phase of this change.**

AUTH-4 replaces `employees.pin: v.string()` with `pinHash: v.string()` and `pinSalt: v.string()` (PBKDF2 via `crypto.subtle`, which runs in the default Convex runtime — no `"use node"`). It is deferred because it requires a widen→backfill→narrow migration: first add `pinHash`/`pinSalt` as optional, then backfill (or re-seed since data is dummy), then remove `pin`. The migration is trivial with dummy data but involves more than one schema push. It will be implemented as a second phase in this `login-hardening` change folder.

**7. AUTH-5 (CSP headers) — later phase of this change.**

AUTH-5 adds Content-Security-Policy headers in the Vite build configuration. It involves no Convex code changes and is independent of the backend rate-limiting implemented here. It will be the third phase in this change folder.

## Risks / Trade-offs

- **Fixed-window reset timing.** A fixed window means an attacker who hits the limit at second 14:59 can immediately retry when the window resets. A sliding window or token-bucket would close this gap but requires per-attempt rows (more writes, more complex cleanup). For a semi-trusted POS environment the fixed window is an acceptable trade-off.
- **Email normalization parity.** The sentinel lookup normalizes the email the same way `login` does. If normalization ever changes in `login`, it MUST change in the lockout path too — otherwise attempts against the same account split across two sentinel keys.
- **Stale sentinel rows.** Rows for old windows accumulate (one per email that ever failed a login). They are harmless (the window check ignores expired ones on the next lookup) and the table stays tiny for a POS. A cleanup cron is a later nicety.
- **Concurrent attempts within one mutation transaction.** Convex mutations are serialized; there is no concurrent-write race for a given sentinel row. The single-row UPSERT is transactionally safe.

## Migration Plan

Adding `loginAttempts` to the schema is purely additive — no existing row is modified or removed. The schema push succeeds against live data. Deploy and the guard is immediately active. No backfill, no data wipe, zero downtime.

## Open Questions

None. Decisions 1–7 resolve all design questions for AUTH-3. AUTH-4 and AUTH-5 are explicitly deferred to later phases of this same change.
