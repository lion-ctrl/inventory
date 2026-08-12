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

## 2 — AUTH-4: PIN hashing at rest + stop returning the credential

- [x] 2.1 **Schema** (`convex/schema.ts`): remove `pin: v.string()` from `employeeFields`; add `pinHash: v.string()` (PBKDF2 output, hex-encoded, 64 chars / 256 bits) and `pinSalt: v.string()` (16-byte CSPRNG salt, hex-encoded, 32 chars). Also add `publicEmployeeValidator` = full employee doc minus `pinHash`/`pinSalt` — following the existing `publicSaleDocValidator` pattern — and export it for use as a `returns` validator.

- [x] 2.2 **Crypto helpers** (`convex/sessions.ts`): add `hashPin(pin, salt?)` and `verifyPin(pin, pinSalt, pinHash)` using `crypto.subtle` PBKDF2 (SHA-256, 100 000 iterations, 256-bit output, hex encoding). No `"use node"`, default Convex runtime only. Helper `fromHex` added for salt round-trip. Known vector frozen in unit tests: PIN `'123456'`, salt `0102030405060708090a0b0c0d0e0f10` → hash `817d1b4df96a0a34a0a6ce16443088d71b6393f87deae91a51fa6797f8aef906`.

- [x] 2.3 **`login`** (`convex/auth.ts`): replace plaintext `employee.pin !== args.pin` with `await verifyPin(args.pin, employee.pinSalt, employee.pinHash)`. All AUTH-3 rate-limit logic (attempt counting, lockout, reset-on-success), session minting, and `lastActive` bump are preserved. Response shape `{ ok, token, expiresAt }` is unchanged.

- [x] 2.4 **`me`** (`convex/auth.ts`): change `returns` from `employeeDocValidator` to `v.union(publicEmployeeValidator, v.null())`; handler destructures `{ pinHash, pinSalt, ...pub }` and returns `pub` so hashing material never leaves the server.

- [x] 2.5 **`employees.list`** (`convex/employees.ts`): change `returns` to `v.array(publicEmployeeValidator)`; handler maps each row through `{ pinHash: _h, pinSalt: _s, ...pub }` before returning.

- [x] 2.6 **`employees.create`** (`convex/employees.ts`): accept `pin: v.string()` from client (unchanged), call `assertPin(pin)` + `hashPin(pin)`, store `pinHash`/`pinSalt` (never `pin`).

- [x] 2.7 **`employees.update`** (`convex/employees.ts`): when patch includes `pin`, call `assertPin` + `hashPin` and patch `{ ...rest, pinHash, pinSalt }` (destructuring `pin` out of the patch before it reaches `ctx.db.patch`).

- [x] 2.8 **`employees.updateSelf`** (`convex/employees.ts`): same pattern as 2.7 for own-profile PIN change.

- [x] 2.9 **`seed.run`** (`convex/seed.ts`): import `hashPin`; for each employee, call `await hashPin(e.pin)` and insert `pinHash`/`pinSalt` (keep `EMPLOYEES` array with plaintext as source data; never persist plaintext). Update `seed.verify` to use `verifyPin('482106', ...)` instead of `owner.pin === '482106'`.

- [x] 2.10 **Fixtures** (`tests/convex/fixtures.ts`): import `hashPin`; for each of the 4 fixture employees, call `await hashPin('pin')` and insert `pinHash`/`pinSalt` (no `pin` field). Existing PIN values preserved so login tests continue using the same PINs.

- [x] 2.11 **`permissions.test.ts`** (`tests/convex/permissions.test.ts`): update `emp()` helper (`pin: '000000'` → `pinHash: 'a'.repeat(64), pinSalt: 'b'.repeat(32)`); update `ana.pin` assertion → `not.toHaveProperty('pin')` + `verifyPin('111222', ...)`.

- [x] 2.12 **Unit tests** (`tests/unit/pin-hash.test.ts`): new file; RED → GREEN tests: round-trip, wrong PIN, random salt, deterministic same-salt, salt round-trip, frozen known vector.

- [x] 2.13 **Integration tests** (`tests/convex/employees.test.ts`): new file; RED → GREEN tests: `employees.list` no pin/pinHash/pinSalt; `employees.create` stores hash+salt + verifyPin true; `employees.update` fresh salt + verifyPin; `employees.updateSelf` re-hashes; `auth.me` no pin/pinHash/pinSalt; `auth.login` verifies against hash + rate-limit preserved; `seed.run` end-to-end.

- [x] 2.14 **Full suite green**: 235 passed / 4 skipped / 0 failed (baseline was 219/4/0; +16 net new tests).

## 3 — AUTH-5: CSP (build-side DONE; hosting headers still open)

- [x] 3.1 Add a Content-Security-Policy to the Vite build configuration. Implemented as `cspMetaPlugin` (`vite.config.ts`), a custom `transformIndexHtml` hook with `apply: 'build'` that injects a `<meta http-equiv="Content-Security-Policy">` into the production `index.html` only — dev is left untouched so HMR's inline scripts and `ws://` socket keep working. Every directive is justified against what the app actually loads; the only relaxations are `'wasm-unsafe-eval'` (required by `zxing-wasm`) and `style-src 'unsafe-inline'` (React style attributes cannot be hashed or nonced).
- [ ] 3.2 Review the `logout` client-side flow for XSS hardening in tandem with the CSP policy. **Partially done, deliberately left open.** The analysis exists in writing (`vite.config.ts:7-14`: Convex authenticates over a WebSocket, so the token MUST be JS-readable — CSP, not an HttpOnly cookie, is the real mitigation), the legacy `pos.employeeId` key is wiped on boot, and logout revokes the server session. What remains is **not a code change but a hosting one**: `frame-ancestors 'none'` and `report-to`/`report-uri` cannot travel in a `<meta>` tag and must be sent as real HTTP response headers by the static host (the recommended header block is written out at `vite.config.ts:53-65`). Until that lands, CSP is partial and the AUTH-5 "Cerrado y verificado" box stays empty.
