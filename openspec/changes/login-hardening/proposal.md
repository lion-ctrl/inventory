## Why

A 6-digit PIN has only 1,000,000 combinations (`assertPin` enforces `/^\d{6}$/` in `convex/permissions.ts`). The `login` mutation (`convex/auth.ts`) imposes zero throttling or lockout — a remote attacker can submit unlimited requests against any email address and exhaust the full PIN space in minutes against the public Convex deployment URL. This is the `AUTH-3` finding from the 2026-06-24 security review.

AUTH-1 (session tokens) and AUTH-2 (stop leaking employee ids) closed the impersonation hole that allowed credential-free access; they did not address brute-force. Rate-limiting is the next required security layer.

## What Changes

- **AUTH-3 — Login rate-limiting (THIS phase, implemented now):** A new `loginAttempts` Convex table counts failed attempts per normalized email in a fixed 15-minute window. The `login` mutation checks the counter before evaluating credentials, returns a generic lockout error when the threshold is reached, increments the counter on every failure (including unknown emails so enumeration is impossible), and resets the counter on a successful login. No external dependency is added — this is a homegrown, fully in-memory-testable implementation.

- **AUTH-4 — PIN hashing (LATER phase of this change):** Replace the plaintext `pin: v.string()` field on `employees` with `pinHash + pinSalt` (PBKDF2 via `crypto.subtle`). Deferred because it requires a widen→backfill→narrow migration on the `employees` table. Will be implemented as a later phase of this same `login-hardening` change.

- **AUTH-5 — CSP headers (LATER phase of this change):** Content-Security-Policy headers in the Vite build configuration to harden against XSS. A client/build concern independent of the backend rate-limiting shipped here. Also deferred to a later phase of this change.

## Capabilities

### New Capabilities

- `login-hardening`: login rate-limiting — `login` enforces a fixed-window attempt counter per normalized email; the lockout error is generic to prevent email enumeration; the counter resets on success and auto-lifts when the window expires.

### Modified Capabilities

<!-- None. AUTH-3 is purely additive: a new table and a check inside `login`. No existing capability contract changes. -->

## Impact

- **Schema** — new `loginAttempts` table with index `by_email`.
- **Backend** — `convex/auth.ts` `login` gains the attempt-check + record + reset logic. `convex/schema.ts` gets the new table definition. No other backend files change.
- **Client / src** — none. The lockout is surfaced via the same `{ ok: false, error }` discriminated union that `login` already returns; the client requires no changes to display it.
- **Tests** — new convex-tests in `tests/convex/auth.test.ts` for: N+1 rejected even with correct credentials; window expiry lifts the lockout; success resets the counter; identical lockout message for existent vs non-existent email.
- **Dependencies** — none added.
- **Data** — additive (no existing row is modified). Safe to deploy with zero downtime.
- **Out of scope for this phase** — PIN hashing (AUTH-4) and CSP headers (AUTH-5) are explicitly deferred to later phases of this change.
