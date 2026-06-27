## Why

Authentication trusts a client-supplied employee document `_id` as the bearer credential. That `_id` is not a secret, never expires, cannot be revoked, and **leaks from public queries** (`sales.history` and `heldCarts.list` return `cashierId`). Anyone with the deployment URL (which ships in the client bundle) can harvest a valid `cashierId` and impersonate that employee — including the owner — with no login and no PIN. This is a critical, currently-exploitable hole, and it violates the project's own guideline (`convex/_generated/ai/guidelines.md:180`: *"NEVER accept a userId as a function argument for authorization"*). Fix it now, while the data is dummy and before more features adopt the `actorId` pattern.

## What Changes

- **NEW `sessions` table** — a hashed, expiring session token bound to an employee.
- **`login` issues a session token**: generates a random token, stores only its `sha256` hash, returns the raw token **once**, with a ~12h expiry. The token (not the `_id`) becomes the credential.
- **NEW `requireSession(ctx, token)`** server helper: validates the token (exists, not expired, employee `active`) and returns the employee. `requirePerm` is refactored to take the resolved `(employee, perm)`.
- **BREAKING — ~22 authenticated functions migrate** their auth argument from `actorId: v.id('employees')` to `token: v.string()` (across `sales`, `heldCarts`, `products`, `clients`, `categories`, `employees`, `settings`).
- **Stop leaking employee identity**: `sales.history` and `heldCarts.list` no longer return `cashierId` (the UI already has the `cashierName` snapshot), and both are gated behind a valid session.
- **Guard `clients.create`** (today it has no auth check at all).
- **NEW `logout` mutation** that deletes the session row — real server-side revocation.
- **Client**: `SessionContext` stores the **token** (not the `_id`) with its expiry, and clears it on expiry/logout; every `useMutation` call site passes `token`.
- **Migration**: dummy data → clear + re-seed (no widen→narrow needed). The stale `pos.employeeId` in `localStorage` is discarded; users re-login once.

## Capabilities

### New Capabilities
- `session-auth`: session-token authentication and authorization — `login` issues a hashed, expiring token; authenticated functions require a valid session (never a raw document id); sessions are revocable (`logout`) and expire; public functions never return an employee identity that doubles as a credential.

### Modified Capabilities
<!-- None. No specs exist under openspec/specs/ yet; this is the first capability. -->

## Impact

- **Schema** — new `sessions` table with indexes `by_tokenHash`, `by_employee`.
- **Backend** — `convex/auth.ts` (`login` returns a token, new `logout`), `convex/permissions.ts` (`requireSession` + new `requirePerm` signature), and ~22 functions across `convex/{sales,heldCarts,products,clients,categories,employees,settings}.ts` swap `actorId` → `token`. `sales.history` / `heldCarts.list` `returns` drop `cashierId`; `clients.create` gains a guard.
- **Client** — `src/state/SessionContext.tsx` (store token + expiry, real logout), every `useMutation` call site passes `token` instead of `user._id`, the `Login.tsx` flow.
- **Tests** — convex-test for the session lifecycle (valid / expired / revoked / bad token) and the migrated functions; component tests for `SessionContext`.
- **Data** — clear + re-seed the dummy deployment after the schema change.
- **Out of scope (follow-up change `login-hardening`)** — PIN hashing + stop returning the `pin` (AUTH-4), login rate-limit / lockout (AUTH-3), CSP (AUTH-5).
