## 1. Schema & session primitives

- [x] 1.1 Add the `sessions` table to `convex/schema.ts` (`{ employeeId, tokenHash, expiresAt, lastSeenAt }`) with indexes `by_tokenHash` and `by_employee`; export a `sessionDocValidator`.
- [x] 1.2 Add token helpers (`convex/auth.ts` or a new `convex/sessions.ts`): `generateToken()` via `crypto.getRandomValues(new Uint8Array(32))` → base64url, and `hashToken(token)` via `crypto.subtle.digest('SHA-256', …)`. Pure, unit-testable, no `"use node"`.
- [x] 1.3 (RED) convex-test for `requireSession`: valid token → returns the employee; unknown token → throws; expired session → throws; inactive employee → throws.
- [x] 1.4 Implement `requireSession(ctx, token)` in `convex/permissions.ts` (hash → `by_tokenHash` lookup → check `expiresAt` + `active` → bump `lastSeenAt` → return employee). Refactor `requirePerm` from `(ctx, actorId, perm)` to `(employee, perm)`. GREEN.

## 2. Login / logout / boot revalidation

- [x] 2.1 (RED) convex-test for `login`: correct creds → `{ ok:true, token, expiresAt }` and a `sessions` row exists holding `tokenHash` (never the raw token); wrong creds → `{ ok:false }`; inactive → error. Assert the response no longer contains the employee `_id` or `pin`.
- [x] 2.2 Rewrite `login` (`convex/auth.ts`) to create a session and return `{ ok, token, expiresAt }` (~12h expiry). GREEN.
- [x] 2.3 (RED→GREEN) Add a `logout` mutation taking `token` that deletes the matching `sessions` row; test that the token is rejected by a privileged call afterward.
- [x] 2.4 Change boot revalidation: `me` (or new `auth.current`) takes `token` and resolves the employee from the session; unknown/expired → `null` (never throws), mirroring the current stale-id tolerance.

## 3. Migrate privileged functions: `actorId` → `token` (table by table, tests green at each step)

- [x] 3.1 `convex/sales.ts` — `checkout`, `refund`: replace `actorId: v.id('employees')` with `token: v.string()`; authenticate via `requireSession` + `requirePerm`. Update their convex-tests.
- [x] 3.2 `convex/heldCarts.ts` — `park`, `resume`, `discard`: same.
- [x] 3.3 `convex/products.ts` — `create`, `update`, `setSellable`, `adjustStock`, `remove`: same.
- [x] 3.4 `convex/clients.ts` — `update`, `remove`, and **add token + permission guard to `create`** (AUTH-2): same.
- [x] 3.5 `convex/categories.ts` — `create`, `update`, `removeWithReassign`: same.
- [x] 3.6 `convex/employees.ts` — `list`, `create`, `update`, `updateSelf`, `remove`: same (`updateSelf` resolves the acting employee from the session, not a passed id).
- [x] 3.7 `convex/settings.ts` — `update`: same. Leave `settings.get` **public** (login-screen branding; documented decision).
- [x] 3.8 Confirm `tsc -b` flags any remaining `actorId` call site; resolve until none remain.

## 4. Stop leaking the employee id (AUTH-2)

- [x] 4.1 (RED) Test that `sales.history` results include `cashierName` but **not** `cashierId`, and that it requires a valid session.
- [x] 4.2 `sales.history` (`convex/sales.ts:217`): drop `cashierId` from the `returns` validator and the returned object; gate with `requireSession`. GREEN.
- [x] 4.3 `heldCarts.list` (`convex/heldCarts.ts:12`): drop `cashierId` from `returns`; gate with `requireSession`. Keep the stored `cashierId` on the tables (audit).

## 5. Client — DONE

- [x] 5.1 `src/state/SessionContext.tsx`: store the **token** (`pos.sessionToken`) + `pos.sessionExpiresAt`; the legacy `pos.employeeId` is wiped by a one-time boot cleanup; cleared on expiry/logout; the employee is resolved from the token via `api.auth.me`.
- [x] 5.2 `src/screens/Login.tsx`: consume `{ token, expiresAt }` from `login` and persist it. **Landed one layer up:** Login calls `useSession().login(email, pin)` and the token/expiry are persisted by `persistSession` inside `SessionContext`, so the screen never touches storage. Same outcome, single owner of the credential.
- [x] 5.3 Update every `useMutation(...)` call site to pass `token` instead of `user._id`. Verified: `actorId` appears nowhere in `src/` or `convex/`.
- [x] 5.4 Wire a real `logout`: `logoutMut({ token })` (`SessionContext.tsx:278`) revokes the server session, then local state is cleared.
- [x] 5.5 Update component tests / mocks that referenced `employeeId` / `actorId`.

## 6. Wrap up

- [x] 6.1 Review `convex/seed.ts` / `tests/convex/fixtures.ts` for any auth-shaped data that changed (no `sessions` seed needed — empty is fine).
- [x] 6.2 `pnpm lint` (tsc -b + eslint --max-warnings 0) green; `pnpm test:run` green — 361 passed / 4 skipped. _Caveat: `pnpm test:run` can still exit 1 on Windows when the vitest fork pool times out starting a worker; the assertions themselves pass._
- [ ] 6.3 Deploy (additive schema — no data wipe needed); verify the end-to-end token flow and that users re-login once. **NOT DONE for production.** The dev deployment carries the schema and functions; `origin/main` is still at `5574917` and `develop` holds 27 unpushed commits, so no production deploy of this work has happened.
- [ ] 6.4 Tick **AUTH-1** and **AUTH-2** in `SECURITY_AUTH.md`. **NOT DONE.** Every per-item checklist in `SECURITY_AUTH.md` is ticked, but the top-level "**Cerrado y verificado**" box of each AUTH item is still empty — that box means owner-verified in a browser, which has not happened.

## 7. Sliding/idle expiration + absolute cap (resolves the design's "fixed 12h" open question)

- [x] 7.1 `convex/sessions.ts`: replace `SESSION_TTL_MS` with tunable `IDLE_TTL_MS = 30 * 60 * 1000` and `ABSOLUTE_TTL_MS = 24 * 60 * 60 * 1000`; migrate every caller (`auth.login`, `tests/convex/fixtures.ts` `mintSession`, `tests/unit/session-token.test.ts`).
- [x] 7.2 `convex/schema.ts`: add `absoluteExpiresAt: v.number()` to the `sessions` table and reinterpret `expiresAt` as the IDLE deadline (keep `lastSeenAt`); update `sessionFields`/`sessionDocValidator` and the `mintSession` fixture so existing tests still build.
- [x] 7.3 `convex/auth.ts` `login`: set `expiresAt = now + IDLE_TTL_MS` and `absoluteExpiresAt = now + ABSOLUTE_TTL_MS` (return shape unchanged — the returned `expiresAt` is the idle deadline).
- [x] 7.4 `convex/permissions.ts` `resolveSession`: treat the session as invalid once `now >= expiresAt` (idle) OR `now >= absoluteExpiresAt` (cap); keep the employee-active check.
- [x] 7.5 `convex/permissions.ts` `requireSession`: in a mutation ctx, slide `expiresAt = min(now + IDLE_TTL_MS, absoluteExpiresAt)` and bump `lastSeenAt`; query contexts validate only (no write).
- [x] 7.6 (RED→GREEN) `convex/auth.ts` new `renewSession(token)` mutation: extend a valid session (clamped to the cap) and return the new `expiresAt`; reject (`{ ok: false }`) once past idle or the cap so the client re-logs in.
- [x] 7.7 convex-tests (RED→GREEN): slides on activity; idle death; absolute cap enforced despite activity; query ctx does not slide; `renewSession` pushes `expiresAt`; `renewSession` after the cap rejected; slide/renew clamp never exceeds the cap. Unit test asserts the two new TTL constants and their ordering.
