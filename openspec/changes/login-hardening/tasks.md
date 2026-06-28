## 1 — AUTH-3: Login rate-limiting (this phase)

- [x] 1.1 Add `loginAttempts` table to `convex/schema.ts`:
  ```ts
  loginAttempts: defineTable({
    email: v.string(),       // normalized: trim() + toLowerCase()
    windowStart: v.number(), // Date.now() when this window began
    count: v.number(),       // failed attempts in this window
  }).index('by_email', ['email'])
  ```
  Export `loginAttemptFields` and `loginAttemptDocValidator` following the pattern of the existing field-map + full-doc-validator exports in `schema.ts`.

- [x] 1.2 (RED) Write failing tests in `tests/convex/auth.test.ts`, alongside the existing suite. Use the same `setup()` pattern: `convexTest(schema, modules)` + `t.run(seedBase)` from `tests/convex/fixtures.ts`. New test cases:
  - **N failures do not trigger lockout** — run `MAX_ATTEMPTS - 1` wrong-PIN calls for `owner`'s email; each returns the wrong-credentials error, none returns the lockout error.
  - **(MAX+1)th attempt rejected even with correct credentials** — after 5 wrong-PIN calls, a 6th call with `pin: '482106'` (the correct PIN from `fixtures.ts`) returns `{ ok: false, error: '<LOCKOUT_MSG>' }` and creates no session row.
  - **Lockout lifts after window expires** — plant a `loginAttempts` row via `t.run(ctx => ctx.db.insert('loginAttempts', { email: 'carlos@mitienda.com', windowStart: Date.now() - WINDOW_MS - 1, count: MAX_ATTEMPTS }))` then call `login` with the correct PIN; it succeeds and mints a session.
  - **Success resets the counter** — call `login` with the wrong PIN 3 times (counter at 3), then call with the correct PIN (succeeds, counter cleared); immediately call with wrong PIN again and confirm the wrong-credentials error (not lockout), proving the counter restarted at 1.
  - **Identical lockout message for existent and non-existent emails** — drive `carlos@mitienda.com` (real) and `ghost@nowhere.com` (non-existent) each to lockout via 5 failed attempts; assert `error` is strictly equal in both results and is not the wrong-credentials string.
  - _(optional)_ **Global cap** — if a `__global__` sentinel is implemented, verify that exceeding `GLOBAL_MAX` across distinct emails triggers the lockout response for the offending email.

- [x] 1.3 Implement the lockout check + record + reset inside `convex/auth.ts` `login`, following design.md Decision 4 step-by-step. Define at the top of the file (or in `convex/sessions.ts`):
  ```ts
  const MAX_ATTEMPTS = 5;
  const WINDOW_MS    = 15 * 60 * 1000;
  const LOCKOUT_MSG  = 'Demasiados intentos. Intenta de nuevo en 15 minutos.';
  ```
  The sentinel lookup uses `withIndex('by_email', ...)` — never `.filter()`. All existing `login` logic (session minting, `generateToken`/`hashToken` from `convex/sessions.ts`, `IDLE_TTL_MS`/`ABSOLUTE_TTL_MS`) remains intact.

- [x] 1.4 Run `pnpm test:run` — all tests green (existing ~213 + the new rate-limit tests). No pre-existing test may regress. If `pnpm test:run` is unavailable use `pnpm vitest run`.

## 2 — AUTH-4: PIN hashing (LATER phase — not implemented now)

- [ ] 2.1 _(later phase)_ Add `pinHash: v.optional(v.string())` and `pinSalt: v.optional(v.string())` to `employees` (widen); backfill all rows via PBKDF2 + `crypto.subtle` (or re-seed with dummy data); remove `pin: v.string()` (narrow).
- [ ] 2.2 _(later phase)_ Update `login` to hash the input PIN and compare against `pinHash`; remove `pin` from any response or seed file; update tests.

## 3 — AUTH-5: CSP headers (LATER phase — not implemented now)

- [ ] 3.1 _(later phase)_ Add a Content-Security-Policy header to the Vite build configuration (e.g. via `vite-plugin-csp` or a custom `transformIndexHtml` hook).
- [ ] 3.2 _(later phase)_ Review the `logout` client-side flow for XSS hardening in tandem with the CSP policy.
