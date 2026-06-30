## Context

The app already ships a PWA shell: `vite-plugin-pwa` is configured, the service worker is registered (`src/main.tsx`, `vite.config.ts`), and the shell boots offline. What it lacks is offline **data** and offline **writes**. Reads go through `useCachedQuery` (`src/state/useCachedQuery.ts`), a localStorage mirror that (a) returns cached business data even with no session (`useCachedQuery.ts:22-31`) and (b) cannot serve the structured queries a real offline POS needs. Writes go through Convex mutations directly, and the sale path hard-blocks offline (`AppShell.handleSaleConfirm`, `src/AppShell.tsx:209-211`).

Four shared master-data read hooks (`src/state/hooks.ts`) feed nearly every screen: `useProducts`, `useCategories`, `useClients`, `useSettingsDoc` (and `useBsRate`, derived from settings). They are thin wrappers, so repointing one hook's body lights up every consumer at once. This is the lever the migration pulls.

The complete, file-grounded implementation plan lives in `guides/OFFLINE_FIRST_PLAN.md` (the HOW, screen by screen) against `guides/OFFLINE_FIRST_FEATURES.md` (the WHAT, 26 sections). This design summarizes the load-bearing decisions; it does not restate the plan.

## Goals / Non-Goals

**Goals:**
- Convex remains the single source of truth and live reactivity; Dexie is a disposable read mirror plus a durable pending-writes queue. Never a second authority.
- Every screen renders its cached data offline; reads are Convex-primary and fall back to Dexie only when the live result is `undefined`.
- A logged-out (or `'skip'`) read yields NO data — no business data leaks to a device without a session.
- Risky admin writes are blocked offline per screen (FEATURES §18); reads stay available.
- An offline sale is never lost: it persists locally, queues, and syncs exactly once when the connection returns.
- Logout never destroys unconfirmed durable writes.

**Non-Goals (deferred to later phases / future changes):**
- Conflict-resolution UI and supervisor overrides (FEATURES §16).
- Server/local audit-log tables (§20) and trusted-device registration (§19).
- Product-level offline policy fields `allowOfflineSales` / `offlineMaxQuantity` / `allowNegativeStock` (§10) — the sync mutation re-validates stock and emits a `conflict`; richer policy is later.
- Storage-quota monitoring and synced-op cleanup crons (§21).
- Mirroring `employees` — never (PIN material; §24). Employees/Profile/Login stay online-only.

## Decisions

**1. Dexie/IndexedDB, not a bespoke store — and the mirror is disposable.**
`src/state/db.ts` defines one typed `Dexie('intentory-pos')` instance. Mirror tables (`products`, `categories`, `clients`, `settings`) key on the Convex `_id` string so `bulkPut` upserts by Convex identity; only indexed fields are declared, mirroring `convex/schema.ts` (`by_barcode`, `by_category`, `by_taxId`). Mirror tables are **disposable**: a breaking shape change bumps `db.version(n)` and `.upgrade(tx => tx.table(...).clear())`, and the next sync refills from Convex. The durable tables (`cartDraft`, `pendingOps`) are **never** cleared on upgrade — they migrate in place. All seven tables are declared up front (even `pendingOps`, unused until Phase 6) so the guarded logout can reference `db.pendingOps` from day one.

**2. `useMirroredQuery` = Convex-primary, Dexie-fallback (`src/state/useMirroredQuery.ts`).**
Same `(query, args, table)` shape as `useCachedQuery`, so swapping a hook body is a one-line change. It runs `useQuery` live; a `useEffect` writes every non-`undefined` result into the mirror table (`clear()` + `bulkPut` — a full refresh is cheap for a single-store POS); and a `useLiveQuery` serves the mirror **only** when the live result is `undefined`. The return is `live !== undefined ? live : cached`. Crucially, `args === 'skip'` ⇒ `[]` (not the mirror), so a session-less read shows nothing — the behavioral fix over `useCachedQuery`, which leaked the cache to logged-out devices.

**3. One phase per screen; migrate the SHARED hooks first.**
Because the four read hooks are shared, the order is master-data first (Phases 1-4: Products, Categories, Clients, Settings) so the mirror tables fill, then the consumer screens (Phases 5-10: Scan, Sale, Payment, Stored, Dashboard, History) as behavior-only phases that layer screen-specific offline logic without re-migrating a hook. A migrated shared hook keeps the same signature, so Products's migration also makes Dashboard/Scan/Sale/Stored/CartContext product-offline in the same move. Online-only screens (Employees, Profile, Login — Phases 11-13) mirror nothing. `useCachedQuery` is deleted last (Phase 14), once `rg` proves zero importers.

**4. Each screen phase ships BOTH the read-mirror AND the offline write-blocking (FEATURES §18).**
A phase is not "read caching now, blocking later." When a screen becomes offline-readable, its risky writes are simultaneously disabled offline with a "requiere conexión" notice: Products (`create`/`update`/`setSellable`/`adjustStock`/`remove`), Categories (`create`/`update`/`removeWithReassign`), Clients (`update`/`remove`; offline `create` deferred to the Phase 6 queue), Settings (all edits), Employees (whole screen), History (`refund`), and official invoice generation. The allow-list offline (FEATURES §18) is: view cached catalog/inventory/clients/settings, create customer drafts, create pending sales. `useOnline` (`src/state/useOnline.ts`) drives the gating.

**5. Persistent cart via a singleton `cartDraft` row (Phase 6).**
`CartContext` holds the cart, selected client, and splits in React state that dies on reload (`src/state/CartContext.tsx:70-74`). The fix: hydrate once on mount from `db.cartDraft.get('active')` before any write-through (a `hydratedRef` guards against clobbering the saved draft with `[]`), then write-through every mutation to the `cartDraft` row. The existing reconciliation (`CartContext.tsx`) refreshes restored lines against live products and drops deleted/paused items, so a restored draft self-heals. `discardSale` (`CartContext.tsx:151`) and the post-checkout reset delete the draft. Idempotent `put` + `hydratedRef` keep React StrictMode's double-effects safe.

**6. Guarded logout — DECIDED POLICY, already implemented (`SessionContext.tsx:101-157`).**
`clearLocalSession` drops the React/localStorage session immediately, then in the background counts unsynced ops: `db.pendingOps.where('status').anyOf('pending','syncing','failed','conflict').count()`. If `> 0`, it clears ONLY the disposable mirror + `cartDraft` (a transaction over `products`/`categories`/`clients`/`settings`/`cartDraft`) and leaves `pendingOps` intact. If `0`, it is safe to `db.delete()` the whole store (which also self-heals corruption) — and even then `pendingOps` is not at risk because the branch only runs when the count is 0. A pending op is therefore deleted ONLY by the sync engine, ONLY after the backend confirms receipt. The teardown is best-effort and never blocks logout. A one-time boot effect sheds legacy `posCache.*` keys (`SessionContext.tsx`).

**7. Offline sale = local `PENDING_SYNC` record + a queued `SALE_CREATE` op (FEATURES §5-7).**
The offline branch of `AppShell.handleSaleConfirm` / `handlePaymentConfirm` (replacing `setOfflineError(true)`, `src/AppShell.tsx:209-211,219`) writes a local sale with a local receipt number marked `PENDING_SYNC` and enqueues a `pendingOps` row. The op shape (`src/state/db.ts`): `idempotencyKey` (a `crypto.randomUUID()` generated AT ENQUEUE and persisted with the op so retries reuse it), `type`, `payload`, `status` (`pending`/`syncing`/`synced`/`failed`/`conflict`/`cancelled`), `attempts`, `createdAt`/`updatedAt`, `lastError`, `deviceId`. Pending sales appear in History clearly separated from official sales and never counted as final.

**8. Idempotent server sync — new `sales.syncOffline`, never a second `checkout`.**
`sales.checkout` (called at `src/AppShell.tsx:109`) is NOT idempotent — it consumes the invoice counter, decrements stock, inserts — so a retried offline sale would double-charge. A sibling `sales.syncOffline` mutation takes `{ token, idempotencyKey, deviceId, ... soldAt }`, authenticates via `requireSession`, and FIRST looks up `by_idempotencyKey`: if a sale exists, it returns that sale (replay → never a duplicate, FEATURES §8-9); otherwise it re-validates stock on the SERVER (§10), consumes the invoice number, decrements stock, and inserts the sale stamped with `{ idempotencyKey, deviceId }`. It shares `snapshotLines` and the reserved-stock backstop with `checkout` to avoid drift. Schema change is widen-only: `idempotencyKey`/`deviceId` added as `v.optional` to `saleFields` plus a `by_idempotencyKey` index — no existing row breaks.

**9. Conflicts are typed codes, surfaced, never auto-resolved (FEATURES §15).**
`syncOffline` throws structured `ConvexError({ code })` for the §15 set: `STOCK_INSUFFICIENT`, `PRODUCT_DELETED`, `PRODUCT_DISABLED`, `PRICE_CHANGED`, `TAX_CHANGED`, `CUSTOMER_NOT_FOUND`, `DUPLICATE_OPERATION`, `AUTH_EXPIRED`, `PERMISSION_DENIED`. The client maps a code to the op's `conflict` status, stores the detail, and shows the cashier a clear message. Conflicted ops are NEVER deleted automatically — local stock is a snapshot, so two cashiers selling the last unit both queue and the loser gets `STOCK_INSUFFICIENT → conflict` for manual handling.

**10. Single-flight sync engine owns op deletion (FEATURES §12).**
A module singleton (`src/state/sync.ts`) holds `useMutation(api.sales.syncOffline)` and drains `pendingOps` in `createdAt` order (`pending → syncing → synced | failed | conflict`) with capped exponential backoff and a single-flight lock so loops never overlap. Triggers: app start, the `online` event (extending `src/state/useOnline.ts`), Convex reconnect, "Sync now", and a newly enqueued op. It is the ONLY place a `pendingOps` row is deleted, and only on the success path after the backend confirms (Decision 6). `AUTH_EXPIRED` marks the op and forces re-login (the token may lapse offline; §24).

## Risks / Trade-offs

- **A shared hook lights up many screens at once.** A bug in `useMirroredQuery` hits every consumer. → Each master-data phase (1-4) is tested in isolation before the next; the primitive itself has focused tests.
- **Double source of truth.** → Mitigated by Convex-primary reads: Dexie renders only when the live result is `undefined`. A one-frame stale flash on reconnect is acceptable — the live value supersedes immediately.
- **Local stock is a snapshot (§10).** → The server re-validates on sync; the losing offline sale becomes a `conflict`, never an auto-forced negative stock. Never auto-resolve.
- **Idempotency depends on key timing.** → The key MUST be generated at enqueue and persisted with the op; `by_idempotencyKey` makes replays return the existing sale instead of inserting.
- **`Dashboard` reads `api.sales.history` for any role while History gates it behind `view_reports`.** → Confirm server behavior for a cashier before relying on cached sales tiles; offline, show the last cached figure plus locally-queued pending sales clearly marked, never as official totals.
- **Service-worker update mid-sale/mid-sync.** → Gate the `vite-plugin-pwa` update prompt on an empty cart draft + zero `syncing` ops (§23).

## Migration Plan

Almost entirely additive, so low-risk:
1. Adding the Dexie store and `useMirroredQuery` is client-only and additive (Phase 0, done). The mirror tables are disposable and refill from Convex.
2. Each read-hook migration (Phases 1-4) is a one-line body swap with an unchanged signature; consumers are untouched. `useProducts`/`useCategories` are done; `useClients`/`useSettingsDoc` follow.
3. The `sales.syncOffline` schema change is **widen-only**: `idempotencyKey`/`deviceId` are `v.optional` additions to `saleFields` and a new index — the push succeeds against live data, no backfill.
4. `useCachedQuery` is deleted only after `rg -n "useCachedQuery" src convex` returns zero matches (Phase 14). A one-time boot cleanup removes legacy `posCache.*` localStorage keys for old installs.

Rollback: revert per phase. A reverted hook returns to `useCachedQuery`; the disposable mirror is simply ignored; durable `pendingOps` rows are inert until a sync engine exists.

## Open Questions

_Resolved._ The guarded-logout policy (Decision 6) is settled per owner ruling — it supersedes the earlier "decide before Phase 6" framing. The deferred items (conflict-resolution UI §16, audit logs §20, product-level offline policy §10, quota monitoring §21) are explicitly out of scope for this change and will be their own later phases. No open questions block the remaining read-migration and write-blocking phases.
