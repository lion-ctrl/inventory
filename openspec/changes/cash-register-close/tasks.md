# Tasks: Cash Register Close

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~852 (design) — Slice 1 ~480, Slice 2 ~375 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (server, ~480) → PR 2 (screen, ~375) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Owner decided, binding — not re-opened.** Mode `auto` + owner explicitly chose 2 slices, overriding the cached `single-pr` strategy: Slice 1 re-merges design's PR1+PR2 (`create`+`list`, ~365+115) into one ~480-line unit — ~80 over the 400 budget, accepted deliberately so Slice 1 proves expected-figure computation end to end before any UI tile exists, and each slice stays small enough to be read, not skimmed. "Reverted entirely on its own" implies each slice merges to main before the next starts → `stacked-to-main` (inferred from that wording, not a literal owner label — flagged in the return envelope's risks).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `closes` table + `create`/`list`; expected computation proven end to end | PR 1 | `pnpm test:run tests/convex/closes.test.ts` | N/A — no UI until Slice 2; `convexTest` is the full harness | Delete `convex/closes.ts` + `closes` schema block + `types.ts` `Close` alias; nothing else imports them yet |
| 2 | Count sheet + history wired to Slice 1; offline/permission gating | PR 2 | `pnpm test:run tests/components/cash-close.test.tsx` | `pnpm dev` → `/cierre-de-caja`, submit a count, confirm blind reveal + history row | Delete `src/screens/CashClose.tsx` + 3 `AppShell.tsx` lines + nav entry; Slice 1 stays intact |

## Slice 1 — Server (PR 1, ~480 lines)

### Phase 1: Foundation

- [x] 1.1 `convex/schema.ts`: add `closeFields` (all required, D6) + `closeDocValidator`/`publicCloseDocValidator` (`cashierId` stripped, AUTH-2 — matches `saleDocValidator` pattern) + `closes` table with `by_cashier_closedAt`, `by_closedAt`. No new `sales` index (D2).
- [x] 1.2 `src/types.ts`: `export type Close = Omit<Doc<'closes'>, 'cashierId'>;` (matches `Sale`/`Purchase`).

### Phase 2: RED — `tests/convex/closes.test.ts` (write, run, OBSERVE FAILING)

Harness: `convexTest(schema, modules)` + `seedBase`/`mintSession` (`tests/convex/fixtures.ts`); sales planted via `t.run(ctx.db.insert('sales', …))` per `tests/convex/reports.test.ts:32-62`.

- [x] 2.1 Mixed sale `splits:[{cash,10},{transfer,40}]` (stored `method:'cash'`) → `expectedUsd 10`, not 50 — proves `splits`, not `method`, is authoritative.
- [x] 2.2 Sale A `entered:3600@rate 36`, Sale B `entered:4000@rate 40`, rate bumped before closing → `expectedBs 7600` — proves sum of `entered`, never reconverted.
- [x] 2.3 Transfer-only sale + a purchase in-window → both currencies 0 — proves non-drawer splits and purchases never counted.
- [x] 2.4 Card-only $50 sold W1, refunded W2 → W1 unaffected, W2 `expectedUsd -50`; mixed refund (`cash_bs entered:1000`+`card 20`) → `expectedBs -1000`, `expectedUsd -20` — proves refund charged to `refund.date`'s window via `by_refundDate`.
- [x] 2.5 No query under `api.closes` (only `create`,`list`) exposes an open window's expected before `create` runs — proves blind-count ordering.
- [x] 2.6 Close twice → second row's `openedAt === first.closedAt`; `openedAt` passed with a prior close → `ConvexError('El cierre continúa desde tu cierre anterior; no puedes elegir la fecha de inicio.')` — proves the window is unnameable, not merely rejected.
- [x] 2.7 First close, no `openedAt` → `ConvexError('Indica desde cuándo cuenta este primer cierre.')`.
- [x] 2.8 Cashiers A and B both sell; A closes → figures reflect only A's `cashierId`.
- [x] 2.9 `Object.keys(api.closes)` is exactly `['create','list']` — proves immutability.
- [x] 2.10 `cajeroPlain` (no `view_reports`): `create` succeeds under own id; `list({scope:'all'})` → `ConvexError('Sin permisos para esta acción.')`; own `list()` returns; `ownerToken` `list({scope:'all'})` returns — proves permission denial (close-own vs read-another's).
- [x] 2.11 Expected 100/5000, counted 95/5000 → `differenceUsd -5`, `differenceBs 0`.
- [x] 2.12 Window sales probe exceeds `CLOSE_MAX_SALES` (1000) → `create` throws `ConvexError('El período es demasiado largo para cerrar. Cierra la caja con más frecuencia.')` — proves over-cap refuses (D3), not flags.

### Phase 3: GREEN — `convex/closes.ts`

- [x] 3.1 `create`: derive window from `by_cashier_closedAt` (`prev.closedAt`, or required finite `args.openedAt` when no prior close); `to = Date.now()`; reject `openedAt` when `prev` exists and reject its absence otherwise; guard non-finite/negative counted amounts (`'Los montos contados no son válidos.'`) and an invalid `openedAt` (`'La fecha de apertura no es válida.'`).
- [x] 3.2 `create`: probe `sold`/`refunded` via `by_soldAt`/`by_refundDate` with `.take(CLOSE_MAX_SALES + 1)`, throw over cap; accumulate `expectedUsd/Bs` from own-`cashierId` `splits ?? []`, subtract refund pass per split kind; `round2` (`convex/money.ts`) all four figures; insert; return `publicCloseDocValidator`.
- [x] 3.3 `list`: `scope:'own'` → `requireSession` only; `scope:'all'` → + `requirePerm(actor,'view_reports')` (`convex/permissions.ts`); `by_closedAt`, capped + `truncated`.
- [x] 3.4 Run `pnpm test:run tests/convex/closes.test.ts` — all 12 green; `pnpm lint` clean.

### Phase 4: Slice 1 close-out

- [x] 4.1 Run full `pnpm test:run` (516 + 12 = 528) green, `pnpm lint` clean.
- [x] 4.2 Confirm rollback boundary: reverting `convex/closes.ts` + the schema block + the `types.ts` alias leaves the pre-existing 516 green (nothing else depends on `closes` yet).

## Slice 2 — Screen (PR 2, ~375 lines, bases on Slice 1 merged)

### Phase 5: RED — `tests/components/cash-close.test.tsx` (jsdom; write, run, OBSERVE FAILING)

Harness follows `tests/components/dashboard-cash-flow.test.tsx`: `vi.mock('convex/react')` dispatching on `getFunctionName`, plus `@/state/SessionContext`, `@/state/useOnline`, `@/state/usePendingSales`.

- [x] 5.1 Initial render: two blank count inputs, no `Efectivo esperado`/`Diferencia` anywhere; after a resolved `closes.create` mock, `Diferencia` (USD, Bs) render as two separate figures — proves screen-side blind ordering.
- [x] 5.2 `online:false` → action disabled + connection-required message; `online:true` + `usePendingSales()` one pending op → still disabled — proves offline refusal lives on the screen (server cannot see the Dexie queue).
- [x] 5.3 `can('view_reports')` false → cashier-picker control absent (`queryBy…toBeNull`), own history still lists; true → control present — proves hidden, not disabled.

Also added (beyond this phase's 3 listed cases — `closes.create`'s contract gained two args/fields after this file was written, per apply instructions): a `confirmPartial` pair (over-cap error offers an explicit confirm button; only that click resends `confirmPartial:true`; a different rejection never offers it) and a `countedFrom` pair (partial-close disclosure renders beside the difference when present, and only then).
**This line no longer states a count.** It originally read "12 `test()` total," was later corrected to "39," and that correction was itself already stale by the time it was written — every course-correction below adds more, so any specific number here is presumptively wrong the moment a new round lands. For the CURRENT count, run `pnpm test:run tests/components/cash-close.test.tsx` (or count the `test(`/`test.each(` call sites in the file directly) rather than trusting a number on this line or any "Delivered" paragraph below it.

### Phase 6: GREEN — Screen + wiring

- [x] 6.1 `src/screens/CashClose.tsx`: count sheet (`.card`/`.card-padded`/`.sec-head`/`.client-field`); expected/difference in `useState(null)`, set only from `create`'s resolved value; reveal via `.prod-stats`/`.prod-stat` (+`.danger`/`.warn`, no `.ok`); history via `.lrow` (first child MUST be `.thumb` — same trap as `.cartrow`, `History.tsx:851-853` precedent); cashier picker (`view_reports` only) via `.catalog-filter`+`.input.cat-select` (no `.seg`, D7). No new CSS — reuse only design-verified classes.
- [x] 6.2 `src/AppShell.tsx`: add `ROUTE_IDS` entry (`/cierre-de-caja`), nav item (`close`, `Cierre de caja`, `coins`), `<Route>`; `<Guard>` with no `perm` (session-only close).
- [x] 6.3 Wire offline refusal: `disabled = !online || usePendingSales().length > 0 || !countsValid`, reason stated in Spanish beside the button; unsynced `closes.list` shows connection-required, same as `History`'s `salesUnavailable` (no Dexie mirror for `closes`).
  **Stale formula, corrected (the way `:86` already is)**: this was the pre-fix, pre-D8 shape — it blocked unconditionally on ANY pending-sale status, which is the exact defect the sdd-verify structural fix below closed. Current formula: `disabled = disabledBase || (blockingCount > 0 && !unsyncedAcknowledged)`, where `blockingCount` counts only `pending`/`failed` rows and `disabledBase` is `!online || !countsValid || (needsOpenedAt && !openedAtDate) || submitting`. See D8 in `design.md` for the full history and rationale.
- [x] 6.4 Run `pnpm test:run tests/components/cash-close.test.tsx` — all 3 green (12/12 including the two added pairs); `pnpm lint` clean.

### Phase 7: Slice 2 close-out

- [x] 7.1 Run full `pnpm test:run` (528 + 3 = 531) green, `pnpm lint` clean, `git diff --stat src/styles/` empty.
  **Stale count, corrected — twice since (see the two "Delivered post-sdd-verify" notes below for the current true numbers)**: the `528 + 3 = 531` figure predates Slice 1's own recount (case 2.4 is two `test()`s, so Slice 1 landed at 529, not 528) and every course-correction to this slice. Do not treat any single number on this line as current; the LAST "Delivered" paragraph below always carries the latest verified full-suite result.

**Delivered post-close-out (owner course-correction, launch-blocking, not deferred)**: `closes.create` also requires an explicit `openedAt` for a cashier's very first-ever close — undetected until now because no client-side signal distinguishes "this cashier has no previous close" from any other state (`scope:'all'` mixes every cashier's rows; AUTH-2 strips `cashierId`). Without it, every cashier's first-ever close was unreachable from the screen. Fixed error-driven, exactly like `confirmPartial`: the ordinary submit never sends `openedAt`; only after the server rejects with the exact `'Indica desde cuándo cuenta este primer cierre.'` does an opening-date field (`.client-field`, defaults to today, capped at today) appear, and only a resubmit — sending `openedAt` as epoch ms at 00:00 LOCAL of the chosen day — includes it. The field stays visible across a subsequent unrelated rejection (e.g. `'La fecha de apertura no es válida.'` for a future date) so the cashier can correct it rather than being stranded, and resets after a successful close so a later close in the same session does not wrongly resend `openedAt`. 4 new `test()` added (16 total in the file), each mutation-tested. See `sdd/cash-register-close/apply-progress` for full evidence.

**Delivered post-sdd-verify, round 1 (CRITICAL fix + 3 warnings, see `design.md` D8 and `specs/cash-close-screen/spec.md` Requirement 2)**: a `conflict`-status pending sale (e.g. an offline stock conflict) never resolves on its own and was blocking the close forever, exactly like the already-fixed unconditional over-cap and first-close refusals. Fixed by partitioning `usePendingSales()` in the screen: only `pending`/`syncing`/`failed` rows still block; a `conflict` row is disclosed via a warning banner (singular/plural Spanish wording) and never blocks. Also fixed: the partial-confirm button now shares the main button's `disabled` (previously gated only on `submitting`, so it stayed clickable offline or with a cleared date); the opening-date field's default-to-today value is now explicitly asserted (not just its presence); and a test now pins the opening-date field surviving an unrelated rejection (e.g. an invalid future date), not just the exact first-close message. 6 new `test()` added (22 total in the file), each mutation-tested. `W3` (triplicated exact-match error strings across `convex/`↔`src/`) and `W4` (D4's stale "closes.list tells the screen" claim) are recorded as deliberate non-blocking follow-ups in `design.md`'s Open Questions, not fixed here.

**Delivered post-sdd-verify, round 2 — STRUCTURAL (closes the class, not one more instance; see `design.md` D8 "REVISED TWICE" and `specs/cash-close-screen/spec.md` Requirement 2)**: round 1's own `SYNCABLE_STATUSES` set wrongly included `'syncing'` — `isDue()` (`src/state/sync.ts:198-205`) refuses it forever too (written BEFORE the network await, so a crash/reload/PWA-kill mid-sync leaves it permanently stuck), the identical defect one status later. Rebuilt as an exhaustive `satisfies Record<PendingOpStatus, PendingCategory>` mapping (a future status now fails to COMPILE until categorized, verified by actually removing a key and observing `tsc` fail): `pending`/`failed` block (the two `isDue()` genuinely retries); `syncing` and `conflict` are DISCLOSED with distinct, never-merged wording (an interrupted sync's outcome is unknown; a rejection is certain); `synced`/`cancelled` are settled, neither blocks nor discloses. Even the legitimate `pending`/`failed` block is no longer permanent-by-omission: an explicit "Cerrar de todas formas" escape (mirroring `confirmPartial`'s deliberate-act discipline) is always offered, reset after every successful close. Also fixed: W9 (the conflict banner no longer names an unrendered figure), W10 (`needsOpenedAt` now resets on the window-continuation rejection, which proves a previous close now exists — the invalid-date survival behavior from round 1 stays intact), S2 (the invalid-date test now pins the retained value, not just presence). 17 new `test()` added (39 total in the file) — including one parameterized case per `PendingOpStatus` member (W6) and one mutation per status-partition member, all confirmed dead. Full-suite result: 579 passed, 4 skipped, across 72 files (562 prior + 17 new = 579, exact match). `convex/` and `src/state/sync.ts` were never touched — the sync engine's behavior is correct for what it is; only the screen's assumptions about it were wrong, twice.

**Delivered post-sdd-verify, round 3 — test-only, zero production change** (four surviving mutations, all coverage gaps in `tests/components/cash-close.test.tsx`, none needed a code fix): W1 (the escape's `unsyncedAcknowledged` flag was write-only in tests — added a failure-path test proving it keeps the ordinary/partial-confirm buttons unlocked after the escape's OWN submit is rejected, not just after a success), W2 (three `queryBy*` + `.toBeDefined()` assertions that could never fail — `null !== undefined` — fixed to `.not.toBeNull()`, audited the whole file for the same pattern), W3 (`submitting` was unpinned — added a deferred-Promise test proving the button is disabled while a request is in flight), W4 (`diffLabel` and the two disclosure-banner titles had zero assertions — both scoped to their own DOM container via `closest()`, since presence alone cannot catch a swap). 4 new `test()` (43 total). No doc update this round — not requested, and D8/R2's rule itself did not change.

**Delivered post-adversarial-RDD-review (0 CRITICAL, 4 WARNING, 1 SUGGESTION, lineage approved; see `design.md`'s "Reveal lifetime" + "cashier picker" + "`truncated`" paragraphs and `spec.md`'s Requirement 1 revision + two new Known Limitations)**: the reviewer hunted specifically for a sixth instance of the lockout class and found none — the structural fix (D8) held under adversarial enumeration, including the compound first-close-plus-over-cap case and an unknown future status (which fails OPEN via the exhaustive partition, not blocking). One finding was a REAL behavioural defect, not a coverage gap: a successful close reset every other in-flight flag but left `reveal` and both count inputs untouched, breaking blindness on every close after the first and leaving the close action re-clickable against stale counts. Fixed with two different timings — count inputs clear on success (keeping `reveal`, which the cashier just asked for); `reveal` clears separately, inside both count `onChange` handlers, the moment a NEW count starts. Four coverage gaps were also closed: the four money tiles (`Efectivo esperado`/`Contado`, both currencies) had zero assertions — a swap at the success handler would have let the cashier read their own count back as "expected"; the cashier picker (D5) had zero behavioural coverage — added a test that seeds two distinct cashiers and actually operates the `<select>`, plus a new Known Limitation recording that AUTH-2 forces a display-name-only comparison; the AppShell route/nav additions were unproved (every test mounted `CashCloseScreen` directly) — added `tests/components/appshell-cash-close-route.test.tsx`, following `appshell-offline-checkout.test.tsx`'s precedent, proving a session without `view_reports` still reaches `/cierre-de-caja` and sees its nav entry; and `closes.list`'s `truncated` flag was silently dropped — adopted `History.tsx`'s own disclosure idiom. 9 new `test()` this round. `convex/` and `src/state/sync.ts` were never touched.

**Delivered post-final-adversarial-review (a real MONEY bug, plus one more coverage gap in the class this whole review sequence has been closing, plus a SUGGESTION; lineage validated the structural fix itself — no sixth lockout instance found)**: the Bs count field's placeholder instructed `"0,00"` (the Venezuelan comma decimal) while every keystroke is piped through the shared `sanitizeAmount` (`src/screens/Payment.tsx`), whose body keeps only digits and a dot and DELETES a comma outright rather than converting it. A cashier following the screen's own instruction and typing `1234,50` submitted `123450` (100× too much); `1.234,50` submitted `1.23` (roughly 1000× too little). Because a close is immutable, that fabricated `Sobrante`/`Faltante` would have been permanent, under that cashier's name. Fixed by changing ONLY the placeholder to `"0.00"` (matching the USD field, `fmtBs`'s own dot output, and Payment's own Bs field feeding the same sanitiser) — `sanitizeAmount` itself is untouched, shared with the already-shipped Payment screen, out of this slice's scope. Recorded honestly in `spec.md`'s Known Limitations: both count fields still accept dot decimals only, and a typed comma is still silently stripped — the placeholder fix prevents the screen from instructing the dangerous format, it does not make the sanitiser locale-aware. Also fixed: the partial-confirm button's blocking-queue gate (it deliberately checks the FULL `disabled`, not `disabledBase`, but no prior test had a blocking sale appear AFTER an over-cap rejection to prove it — recurrence risk in the same class five rounds already closed for the two main buttons). Also closed a SUGGESTION: the history row's two money columns had zero assertions — the only surface where a `view_reports` supervisor reads another cashier's outcome. New tests this round: 2 for the money-format fix (one pins the current stripping behaviour so a future change to the shared sanitiser cannot silently alter it unnoticed; one pins both placeholders to the dot form), 1 for the partial-confirm gate, 1 for the history row columns.

Every "N new `test()`" figure above is a fixed historical fact about that specific round and will always stay true. Any "(M total)" figure that used to sit beside one is NOT — every subsequent round adds more, so treat every such total as presumptively stale on sight; get the CURRENT count by running `pnpm test:run tests/components/cash-close.test.tsx` (or `pnpm test:run` for the whole suite), never by reading a number left on this page.

## Notes (carried, non-normative — per design's Recorded Limitations)

- `splits ?? []` in 3.2 means a legacy sale with no `splits` contributes zero, silently — expected, not a defect to fix.
- The unsynced check (6.3) is per-device only; a second device's pending queue stays invisible.
- A first close's `openedAt` is unbounded backwards; hitting `CLOSE_MAX_SALES` there is an intended honest refusal — case 2.12's Spanish message must read as an actionable remedy, not a dead end.
