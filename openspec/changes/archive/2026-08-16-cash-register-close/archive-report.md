# Archive Report: Cash Register Close

**Change**: `cash-register-close`  
**Archived**: 2026-08-16  
**Archive Location**: `openspec/changes/archive/2026-08-16-cash-register-close/`  
**Archive Mode**: hybrid (filesystem + Engram)

## Execution Summary

The `cash-register-close` SDD change has been archived after successful implementation, verification, and review cycles. Both capabilities (server and screen) have been delivered, tested, reviewed with approval, and committed to the codebase before archive.

**Status**: ✅ Complete and archived
- Slice 1 (server): committed at `9acf9f0` — 24 tests, 12 new
- Slice 2 (screen): committed at `0ab59f6` — 32 tests across 2 files, 43 total new
- Full test suite: 596 passing / 4 skipped across 73 files
- Linting: Clean (`pnpm eslint` exit 0)
- TypeScript: Clean (`npx tsc -b` exit 0)
- Styles: No diff in `src/styles/` or `designs/`

## Artifacts Archived

All SDD artifacts are present in the archive folder:

| Artifact | Status | Notes |
|----------|--------|-------|
| `proposal.md` | ✅ Archived | Intent, scope, capabilities, rollback plan |
| `design.md` | ✅ Archived | Technical approach, 8 architecture decisions (with D2, D3, D8 REVISED), data flow, interfaces |
| `tasks.md` | ✅ Archived | 28 implementation tasks — **all 28 completed and checked** |
| `specs/cash-register-close/spec.md` | ✅ Archived & Synced | Server capability: window, expected computation, blind count, immutability, permissions |
| `specs/cash-close-screen/spec.md` | ✅ Archived & Synced | Screen capability: count sheet, reveal, history, offline/permission gating |

## Specs Merged to Main Specs

Both specs are **NEW capabilities** (no pre-existing specs in `openspec/specs/` to merge into):

| Domain | Target Path | Status | Requirements |
|--------|------------|--------|--------------|
| `cash-register-close` | `openspec/specs/cash-register-close/spec.md` | ✅ Created | 9 requirements + Known Limitations (6 items) |
| `cash-close-screen` | `openspec/specs/cash-close-screen/spec.md` | ✅ Created | 3 requirements + Known Limitations (4 items) |

### Spec Preservation

Both specs contain critical design constraints and hazard records that are **preserved verbatim**:

**`cash-register-close` Known Limitations**:
- A partial close under-reports its own window, by design
- A close recorded against the wrong window cannot be corrected
- A sale with no `splits` array is counted as zero, not flagged

**`cash-close-screen` Known Limitations**:
- The unsynced-sale check only sees THIS device's pending-ops queue
- A permanently rejected sale's cash is genuinely uncounted, and nothing yet resolves it
- An interrupted sync is unrecoverable at the queue level, and nothing yet resolves it
- The cashier picker can only compare display names, never identities (AUTH-2 constraint, D5)
- Both count fields accept dot decimals only — a typed comma is silently stripped, and this is a real hazard

## Design Decisions Preserved

All architecture decisions are preserved in the archived `design.md`, including three **REVISED** decisions with full reasoning:

| Decision | Revision Status | Key Outcome |
|----------|-----------------|------------|
| D1: Expected stored vs recomputed | Baseline | Stored to prevent silent rewrite from refunds/deletes |
| D2: Per-cashier window read | **REVISED** | Two indexed paths (`by_cashier_soldAt`, `by_cashier_refundDate`) — original query-side filter consumed cashier's cap against shop-wide volume |
| D3: Read cap behaviour | **REVISED** | Refuse once, then close on explicit `confirmPartial` — original unconditional refusal left drawer permanently locked |
| D4: Blind-count shape | Baseline | Two calls only (list + create), no third query — `closes.list` proves prior close exists |
| D5: `list` scoping | Baseline | `scope: 'own' \| 'all'` — AUTH-2 strips `cashierId` from returns, so `scope` is the implementable spelling |
| D6: Field optionality | Baseline | All required — `closes` is new with zero rows, no backfill needed |
| D7: Screen styling | Baseline | Reuse existing classes; no `.seg` (specificity workaround), no new CSS |
| D8: Offline-refusal, which statuses block | **REVISED TWICE** | Block only on `pending`/`failed` (statuses `isDue()` genuinely retries); disclose `syncing` and `conflict` with distinct wording; always offer "Cerrar de todas formas" escape so no status can make close permanently unreachable (closed the class via partition via exhaustive `satisfies Record<PendingOpStatus, PendingCategory>`) |

D2 and D3 record why enumeration-based fixes kept failing and why structural constraints (indexed paths, escape hatch) actually close the defect classes.

D8 has full history: Revision 0 (original) blocked unconditionally; Revision 1 refined to `pending`/`syncing`/`failed` but `isDue()` returns false for `syncing` forever too (same defect one status later); Revision 2 (final, structural) built `PendingCategory` exhaustive mapping so a new status fails to **compile** until categorized, plus explicit escape with `unsyncedAcknowledged` flag to ensure blocking is never permanent.

## Deliberately Open Follow-Ups

The following gaps are intentionally left open and recorded in design and specs for future work:

### W3: Triplicated Error Strings (D2/R1, flagged as non-blocking)

The exact-match error strings `'El período es demasiado largo para cerrar. Cierra la caja con más frecuencia.'` and `'Indica desde cuándo cuenta este primer cierre.'` and the opening-date field placeholder are triplicated across:
- `convex/closes.ts` (server messages)
- `src/screens/CashClose.tsx` (screen copy and placeholders)
- `tests/convex/closes.test.ts` and `tests/components/cash-close.test.tsx` (test expectations)

Changing `CLOSE_MAX_SALES` or the first-close message requires coordinated updates across three places. Fixing this properly requires a shared constants module crossing the `convex/`↔`src/` boundary, which is out of scope for this change.

### W4: D4's Stale Claim (D4, flagged as non-blocking)

Design D4 currently states: "`closes.list` already tells the screen whether a previous close exists (non-empty ⇒ `openedAt` not required)."

This was accurate during design but was disproven during first-close work: `closes.list({scope:'all'})` mixes every cashier's rows (a `view_reports` session), so AUTH-2 strips `cashierId` from returns, making client-side detection unreliable. The screen discovers "first close needed" only after the server rejects a normal submission with `'Indica desde cuándo…'`. This is correct behaviour (client has no reliable signal for "this cashier has no prior close"); the claim in D4 is stale and should be corrected to reflect how the feature actually works.

## Task Completion

- **Total implementation tasks**: 28
- **Completed**: 28 (100%)
- **Unchecked**: 0

All tasks were completed across two slices:

**Slice 1 — Server** (7 phases × tasks):
- Phase 1: Foundation (2 tasks) — schema + types
- Phase 2: RED tests (12 scenarios × 1 task) — negative path coverage
- Phase 3: GREEN implementation (4 tasks) — `create`/`list` logic
- Phase 4: Close-out (2 tasks) — full suite verification + rollback proof

**Slice 2 — Screen** (6 phases × tasks):
- Phase 5: RED tests (3 base scenarios, +4 edge cases) — count sheet, permissions, offline
- Phase 6: GREEN implementation (3 tasks) — screen + wiring + verification
- Phase 7: Close-out — full suite verification

Plus post-delivery course corrections (6 rounds documented in `tasks.md`):
1. First-close `openedAt` field (error-driven fix)
2. Partial close with `confirmPartial` (error-driven fix)
3. `conflict` status disclosure distinct from rejection (sdd-verify CRITICAL)
4. `syncing` status escape hatch + structural partition (sdd-verify CRITICAL, D8 REVISED TWICE)
5. Placeholder and sanitisation hazard (adversarial review, actual money bug)
6. History row + app-shell route coverage (adversarial review)

Each correction added tests; see `tasks.md` section 7.1–7.2 for the full course-correction history and current verified test counts.

## Review & Verification Status

**Native Review Receipt**: Both slices passed `pre-commit` gate with `result: allow`.  
- Slice 1: Approved, no blocking findings
- Slice 2: Approved after 8 rounds of review; final pass (round 8) returned **zero findings** (lineage validated the structural fix against adversarial enumeration)

**sdd-verify**: Completed with `pass_with_warnings`:
- Round 1: 1 CRITICAL (D8 Revision 1 failure), 3 WARNINGs → fixed
- Round 2: Structural partition (D8 Revision 2) validated closed the class
- Round 3: Test-only coverage gaps, zero production change

**Current state at archive**:
- 596 tests passing / 4 skipped across 73 files
- All prior findings closed
- Linting clean
- TypeScript clean
- Styles unchanged

## Mechanical Verification

**Archive Copy Contract**:
- Source artifacts copied to archive: ✅ verified
- Delta specs copied to main specs: ✅ verified  
- Source change directory deleted: ✅ verified
- All artifacts identical (byte-level, post-normalized line endings): ✅ verified

**diff -r outputs** (see execution logs for full readback):
- proposal.md: ✅ match
- design.md: ✅ match
- tasks.md: ✅ match (line-ending differences only, expected on Windows)
- specs/cash-register-close/spec.md: ✅ match
- specs/cash-close-screen/spec.md: ✅ match

No truncation, alteration, or loss detected.

## Authority Ranking & Final State

Per the Final-State Authority hierarchy:

1. **Native review authority** (highest): Both slices have approved `reviewGate: allow` with terminal receipt. Archive proceeds.
2. **Persisted tasks artifact**: All 28 tasks checked; no unchecked implementation tasks remain. Task Completion Gate passes.
3. **Explicit final-state facts in launch prompt**: Both slices implemented, reviewed, approved, and committed before archive. Final test counts provided.
4. **Intermediate snapshots** (lowest): `verify-report` and `apply-progress` are historical; all findings they raised have been closed.

**Sources consulted**:
- `pre-commit` gate context for both slices
- `sdd-verify` report (observations stored in Engram during verify phase)
- Task completion marker in persisted `tasks.md`
- Git commit history (slices committed at `9acf9f0`, `0ab59f6`)
- Current test suite run in working tree at archive time

## Rollback Boundary

The change is fully additive and revertible in one commit:
- Delete `convex/closes.ts`, its schema block (`closes` table, indexes), and `src/types.ts` Close alias
- Delete `src/screens/CashClose.tsx`, remove 3 lines from `src/AppShell.tsx` (route, nav item, import)
- Delete `tests/convex/closes.test.ts`, `tests/components/cash-close.test.tsx`
- Do NOT delete `sales` indexes if added (additive, droppable, but safely left in place)
- Do NOT revert `openspec/specs/` — leave the archived specs there for future reference

Result: 516 tests green (pre-change state), zero money data lost, zero file alteration.

## SDD Cycle Complete

This change has been fully planned (proposal), designed (design decisions), implemented (two slices, two PRs), verified (sdd-verify with findings closed), reviewed (RDD with approved lineage), and archived.

Ready for the next change.
