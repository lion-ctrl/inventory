## Why

A point-of-sale that stops selling the moment the network blinks is broken for its core job. Today this POS cannot ring up a single item offline: every write **hard-blocks** — `AppShell.handleSaleConfirm` (`src/AppShell.tsx:209-211`) sets an offline error instead of taking the sale — and reads survive only through a **leaky** localStorage cache (`src/state/useCachedQuery.ts`) that hands back the cached business data **even when there is no session** (`useCachedQuery.ts:22-31` returns `cached` whenever the live result is `undefined`, with no token check). On top of that, the original logout was a blunt wipe that would discard any unsynced work along with the disposable cache.

The next step after the AUTH work is to make the app **offline-first without inventing a second source of truth**. Convex stays the live authority and the only writer of official records; a Dexie/IndexedDB layer mirrors reads so screens render offline, and holds a durable queue of pending writes that drains against Convex when the connection returns. The full HOW is already written — screen by screen, against real files — in `guides/OFFLINE_FIRST_PLAN.md`; the WHAT (26 sections) in `guides/OFFLINE_FIRST_FEATURES.md`. This change captures that effort as specs. Phases 0-2 (Dexie setup, the `useMirroredQuery` primitive, the guarded logout, and the Products/Categories read-mirror) are **already implemented**; the remaining phases are specced here.

## What Changes

- **NEW Dexie store (`src/state/db.ts`)** — one typed IndexedDB database (`intentory-pos`) with disposable mirror tables (`products`, `categories`, `clients`, `settings`) keyed on the Convex `_id`, plus durable local-only tables (`cartDraft`, `pendingOps`, `meta`). A first-run `populate` seeds a stable `deviceId`.
- **NEW `useMirroredQuery` primitive (`src/state/useMirroredQuery.ts`)** — Convex-primary / Dexie-fallback, same 3-arg shape as `useCachedQuery`. Online it reads Convex live and mirrors each result into Dexie; offline it serves the mirror. `'skip'` (no session) ⇒ `[]`, so a logged-out device sees **no** data — closing the read half of the old cache leak.
- **Per-screen read migration (Phases 1-4)** — the four shared master-data hooks in `src/state/hooks.ts` (`useProducts`, `useCategories`, `useClients`, `useSettingsDoc`) swap their body from `useCachedQuery` to `useMirroredQuery`; each repoint lights up every consumer screen at once. `useProducts` and `useCategories` are **done**; `useClients` and `useSettingsDoc` remain.
- **Offline write-blocking, screen by screen (FEATURES §18)** — risky admin writes (price/stock edits, deletes, category/tax/settings changes, user/role management, refunds, official invoices) are disabled offline with a "requiere conexión" notice. Reads still work offline. Each screen phase ships BOTH its read-mirror AND its write-blocking.
- **Persistent cart (Phase 6)** — `CartContext` state (cart, selected client, splits) write-through to a `cartDraft` Dexie row and hydrates on mount, so an in-progress sale survives reload and browser restart. Logout discards the draft.
- **Guarded logout (Phase 0, done)** — `clearLocalSession` clears the disposable mirror + `cartDraft`, but **preserves unsynced `pendingOps`**; a pending op is removed only by the sync engine, only after the backend confirms receipt.
- **Offline sales queue (Phase 6+)** — offline checkout writes a local `PENDING_SYNC` sale and enqueues a `SALE_CREATE` op carrying an idempotency key; a new idempotent `sales.syncOffline` mutation replays it exactly once; a single-flight sync engine drains the queue and maps server conflict codes (FEATURES §15) to op state.
- **Remove `useCachedQuery` (Phase 14)** — once no hook imports it, delete the legacy localStorage cache.

## Capabilities

### New Capabilities

- `offline-data-mirror`: Convex reads are mirrored into Dexie and served when the live result is unavailable, screen by screen, while Convex stays the source of truth and live reactivity; `'skip'`/no-session reads yield no data.
- `offline-write-blocking`: risky admin write operations are disabled while offline, screen by screen (FEATURES §18), with a clear connection-required notice; reads remain available offline.
- `persistent-cart`: the in-progress cart (items, client, splits) survives reload and browser restart via the Dexie `cartDraft` row, and is discarded on logout.
- `guarded-logout`: logout clears the disposable mirror + `cartDraft` but preserves unsynced `pendingOps`; a pending op is deleted only after the backend confirms it.
- `offline-sales-queue`: offline sales become durable `pendingOps` (`SALE_CREATE`) drained by a single-flight sync engine against an idempotent `sales.syncOffline`, with conflict states surfaced and never auto-resolved (design-level; activated in later phases).

### Modified Capabilities

<!-- None. `guarded-logout` extends the client-side logout flow introduced by `session-auth` additively — the server still revokes the session via the `logout` mutation; the new behavior is local IndexedDB teardown only, so the `session-auth` contract is unchanged. -->

## Impact

- **Client / src** — new `src/state/db.ts` (Dexie schema) and `src/state/useMirroredQuery.ts` (done); `src/state/hooks.ts` migrates the four shared read hooks (`useProducts`/`useCategories` done; `useClients`/`useSettingsDoc` pending); `src/state/SessionContext.tsx` guarded logout (done); `src/state/CartContext.tsx` cart write-through/hydrate (Phase 6); `src/AppShell.tsx` offline checkout branch replacing the hard block (`209-211`, `219`); per-screen offline notices across `src/screens/*`; a `src/state/sync.ts` sync engine (Phase 6). `src/state/useCachedQuery.ts` deleted in the final phase.
- **Backend / convex** — additive only: a new idempotent `sales.syncOffline` mutation plus `idempotencyKey`/`deviceId` (optional) on `saleFields` and a `by_idempotencyKey` index (`convex/schema.ts`); structured `ConvexError({ code })` for the FEATURES §15 conflict codes. Existing `sales.checkout` is unchanged.
- **Dependencies** — `dexie` and `dexie-react-hooks` (installed in Phase 0). No CSP/Workbox change (IndexedDB is a same-origin API with no CSP directive).
- **Tests** — Dexie mirror fill/serve and the `'skip'` ⇒ `[]` behavior; per-screen offline read + write-blocking; cart persistence across reload; guarded-logout preservation of `pendingOps`; convex-test for `sales.syncOffline` idempotency and conflict codes.
- **Data** — additive (mirror tables are disposable and refill from Convex; the new sale fields are optional). No destructive migration. The one-time boot cleanup sheds legacy `posCache.*` localStorage keys.
- **Out of scope (this change)** — conflict-resolution UI (FEATURES §16), audit-log tables (§20), product-level offline policy fields `allowOfflineSales`/`offlineMaxQuantity`/`allowNegativeStock` (§10), and storage-quota monitoring (§21) are specced at design level for later phases but not implemented here.
