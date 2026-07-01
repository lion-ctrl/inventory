> One phase per screen. After Phase 0, the master-data phases (1-4) migrate the
> SHARED read hooks first so the mirror tables fill; the consumer phases (5-10) are
> behavior-only. **Each screen phase ships BOTH the Dexie read-mirror AND the offline
> write-blocking (FEATURES §18).** `useCachedQuery` is deleted in the final phase.

## Phase 0 — Setup (the only non-screen phase) — DONE

- [x] 0.1 Install `dexie` + `dexie-react-hooks` (done outside this plan).
- [x] 0.2 `src/state/db.ts`: one typed `Dexie('intentory-pos')` with mirror tables (`products`, `categories`, `clients`, `settings`, PK `_id`) + durable local tables (`cartDraft` id `'active'`, `pendingOps` `++localId &idempotencyKey`, `meta`); indexes mirror `convex/schema.ts`; `populate` seeds a `deviceId`.
- [x] 0.3 `src/state/useMirroredQuery.ts`: Convex-primary / Dexie-fallback primitive — live `useQuery`, background `clear()`+`bulkPut` mirror, `useLiveQuery` fallback only when live is `undefined`, `args === 'skip'` ⇒ `[]`.
- [x] 0.4 Guarded logout in `src/state/SessionContext.tsx` `clearLocalSession` (`101-157`): clear disposable mirror + `cartDraft`, PRESERVE unsynced `pendingOps`; full `db.delete()` only when the unsynced count is 0; best-effort, never blocks logout. One-time boot cleanup of legacy `posCache.*` keys.
- [x] 0.5 Phase 0 tests: `db.products.count()` after a manual `bulkPut`; IndexedDB shows all 7 tables + seeded `meta.deviceId`; logout with 0 ops wipes the DB, logout with a hand-inserted `pending` op keeps that op while the mirror + `cartDraft` are cleared.

## Phase 1 — Products (`/productos`, `manage_products`) — DONE

- [x] 1.1 (read-mirror) Rewrite `useProducts` (`src/state/hooks.ts:39-48`) to `useMirroredQuery(api.products.list, token ? { token } : 'skip', 'products')`; signature unchanged → Dashboard/Scan/Sale/Stored/CartContext become product-offline in one move. **DELETE the old `useCachedQuery` body of `useProducts`.**
- [x] 1.2 (write-blocking §18) Disable `create`/`update`/`setSellable`/`adjustStock`/`remove` (`Products.tsx`) offline with a "requiere conexión" notice; cached catalog (price/stock/`sellable` snapshots) stays viewable.
- [x] 1.3 Tests: load online once → DevTools Offline → reload → catalog renders from the `products` mirror; create/edit/delete disabled with the offline notice; `db.products.count()` matches the server list.

## Phase 2 — Categories (the category section inside `Products.tsx`) — DONE

- [x] 2.1 (read-mirror) Rewrite `useCategories` (`src/state/hooks.ts:57-66`) to `useMirroredQuery(api.categories.list, …, 'categories')`; lights up category reads in Products/Scan/Sale/Dashboard. **DELETE the old `useCachedQuery` body of `useCategories`.**
- [x] 2.2 (write-blocking §18) Disable category `create`/`update`/`removeWithReassign` (`Products.tsx`) offline; chips/filters render from the mirror.
- [x] 2.3 Tests: category chips render offline in Products/Scan/Sale; CRUD modals disabled offline.

## Phase 3 — Clients (`/clientes`, `manage_clients`) — DONE

- [x] 3.1 (read-mirror) Rewrote `useClients` (`src/state/hooks.ts`) to `useMirroredQuery(api.clients.list, token ? { token } : 'skip', 'clients')`; signature unchanged (still `Client[]`) → Sale/Dashboard/CartContext become client-offline in one move (mirror keyed by `_id`, compound index `[taxPrefix+taxId]`). **DELETED the old `useCachedQuery` body of `useClients`** (`useSettingsDoc` stays on `useCachedQuery` until Phase 4).
- [x] 3.2 (write-blocking §18) Disabled `create`/`update`/`remove` offline in `Clients.tsx` (the "Nuevo cliente" button, the detail sheet's Editar/Eliminar, the client-form submit, the picker's "Crear nuevo cliente") AND `Sale.tsx`'s ClientGate "Crear cliente" — via an `online` prop + a "Sin conexión" banner. The list/search and selecting an EXISTING client stay offline-capable. Offline `create` as a queued `CUSTOMER_CREATE` draft is SPECCED here but ACTIVATED in Phase 6 (the queue is born in Venta); until then `create` is BLOCKED, not queued.
- [x] 3.3 Tests: `tests/state/clients-mirror.test.tsx` (Convex-primary mirror + Dexie offline fallback with the tax identity intact + `'skip'` ⇒ `[]`); `tests/components/clients-offline-blocking.test.tsx` (every client write trigger disabled offline with the "Sin conexión" banner; search/select stay enabled; same controls enabled online).

## Phase 4 — Settings (`/ajustes`, `manage_settings`) — DONE

- [x] 4.1 (read-mirror) Rewrote `useSettingsDoc` (`src/state/hooks.ts`) to the Dexie singleton adaptation of the `useMirroredQuery` pattern (live `useQuery` → background `db.settings.clear()` + `db.settings.put(live)`; offline fallback `db.settings.toCollection().first()`; `'skip'` ⇒ `null`). `useBsRate` needed no change — it reads `useSettingsDoc`, so it is Dexie-backed for free everywhere. **DELETED the old `useCachedQuery` body of `useSettingsDoc`.**
- [x] 4.2 (write-blocking §18) Disabled every `settings.update` write offline in `Settings.tsx` (the four preference toggles + each editor sheet's Guardar) via an `online` prop + a screen-level and per-sheet "Sin conexión" `Banner`; `save` also no-ops offline. `storeName`/`bsRate`/`ivaPct`/`scannerMode`/`taxName`/`currency` read from the mirror so Scan/Sale/Payment math works offline; editor sheets still open to VIEW values offline.
- [x] 4.3 After Phase 4 all four `useCachedQuery` consumers are gone — `useSettingsDoc` was the last. `useCachedQuery.ts` now has zero importers (`rg -n "useCachedQuery" src` → only its own definition + orphan notice); left in place, deleted in Phase 14.
- [x] 4.4 Tests: `tests/state/settings-mirror.test.tsx` (Convex-primary singleton mirror + Dexie offline fallback + `'skip'` ⇒ `null`; `useBsRate` online/offline/skip); `tests/components/settings-offline-blocking.test.tsx` (toggles + editor Guardar disabled offline with the "Sin conexión" banner; enabled online; editor still opens offline to read).

## Phase 5 — Scan (`/escanear`, any role) — offline search proof

- [ ] 5.1 (read-mirror) No hook migration — products/categories/settings already Dexie-backed. Confirm in-memory barcode/SKU/name/category search resolves from the mirror (`Scan.tsx` filters `useProducts()`'s array; no `byBarcode` query).
- [ ] 5.2 (write-blocking) None — Scan is read-only. Add a `useOnline`-driven "sin conexión — precios y stock pueden estar desactualizados" banner (§4).
- [ ] 5.3 Tests: offline → HID + camera scan a known barcode resolves from the mirror; name/SKU search returns cached matches; the stale-data banner shows offline, hides online.

## Phase 6 — Venta / Sale (`/venta`, any role) — offline WRITES start here

- [ ] 6.1 (persistent cart) Hydrate `CartContext` once from `db.cartDraft.get('active')` behind a `hydratedRef`, then write-through cart/`selectedClientId`/`splits`/`splitsNextId` to the `cartDraft` row on every change (`src/state/CartContext.tsx:70-74`). `discardSale` (`151`) and the checkout reset delete the draft.
- [ ] 6.2 (pending-ops queue, §6) Activate the Phase 3 `CUSTOMER_CREATE` draft: offline, `Sale`'s inline create enqueues a `CUSTOMER_CREATE` op and inserts a local client row so the cart proceeds.
- [ ] 6.3 (idempotent sync mutation, §8-9) Add `sales.syncOffline` (`convex/sales.ts`): `requireSession`, `by_idempotencyKey` replay-guard returns the existing sale, else server-side stock re-validation → consume invoice # → decrement stock → insert with `{ idempotencyKey, deviceId }`. Widen `saleFields` (`convex/schema.ts`) with optional `idempotencyKey`/`deviceId` + `by_idempotencyKey` index.
- [ ] 6.4 (conflict codes, §15) Throw structured `ConvexError({ code })` for `STOCK_INSUFFICIENT`/`PRODUCT_DELETED`/`PRODUCT_DISABLED`/`PRICE_CHANGED`/`TAX_CHANGED`/`CUSTOMER_NOT_FOUND`/`DUPLICATE_OPERATION`/`AUTH_EXPIRED`/`PERMISSION_DENIED`.
- [ ] 6.5 (sync engine, §12) `src/state/sync.ts` module singleton: drains `pendingOps` in `createdAt` order, single-flight lock, capped backoff; triggers app-start/`online`/reconnect/"Sync now"/new-op; the ONLY deleter of a `pendingOps` row, only after backend confirm; `AUTH_EXPIRED` forces re-login.
- [ ] 6.6 (offline checkout, write-blocking) Replace the hard block in `AppShell.handleSaleConfirm`/`handlePaymentConfirm` (`src/AppShell.tsx:209-211,219`): offline → write a local `PENDING_SYNC` sale + enqueue a `SALE_CREATE` op + route to a pending receipt. Online path unchanged.
- [ ] 6.7 Tests: add items → reload → cart/client/splits restored; offline checkout enqueues `SALE_CREATE` + local receipt; reconnect → engine syncs, op deleted only after confirm; duplicate sync (same key) returns the same sale; stock conflict marks the op `conflict` (not deleted); logout with the op pending → op survives.

## Phase 7 — Payment (overlay of Sale, no route)

- [ ] 7.1 (read-mirror) No hook migration — settings already mirrored. Compute totals + Bs conversion from cached `bsRate`/`ivaPct`.
- [ ] 7.2 (write-blocking §18) The official receipt/invoice number is minted only by `syncOffline` after confirm; offline render a local `PENDING_SYNC` receipt stamped "PENDIENTE DE SINCRONIZACIÓN" (`SuccessScreen` already receives `online`).
- [ ] 7.3 Tests: offline checkout shows a `PENDING_SYNC` receipt with correct Bs/IVA totals; after reconnect-sync the official invoice number replaces/links the local one.

## Phase 8 — Stored / Ventas en espera (`/ventas-en-espera`, any role)

- [ ] 8.1 (read-mirror) Add a `heldCarts` mirror table (`db.version(2)`, mirroring `heldCartFields`); mirror `heldCarts.list` (uncached today) via `useMirroredQuery` so the held list renders offline.
- [ ] 8.2 (write-blocking §18) `park`/`resume`/`discard` are server mutations — online-only initially (optionally queue `park` later); reserved-stock overlay still reduces Venta availability offline.
- [ ] 8.3 Tests: held list renders offline from the mirror; park/resume/discard disabled (or queued) offline; reserved-stock math holds offline.

## Phase 9 — Dashboard (`/`, any role)

- [ ] 9.1 (read-mirror) No master-data migration — all four hooks already Dexie-backed. Catalog counts, low-stock tiles, client counts, Bs rate compute from the mirror (tiles already `can()`-gated).
- [ ] 9.2 (write-blocking / degraded) Live "today's sales" needs `api.sales.history`; offline show the last cached figure plus locally-queued `SALE_CREATE` pending sales labeled "pendiente", never as official totals.
- [ ] 9.3 Tests: counters render offline from mirrors; sales tiles show cached + pending (clearly marked) without throwing when `sales.history` is unavailable.

## Phase 10 — History (`/historial`, `view_reports`)

- [ ] 10.1 (read-mirror) Add a local `pendingSales` view sourced from `pendingOps` of type `SALE_CREATE` (the local `PENDING_SYNC` sales). Official history stays server-only (admin-gated, large, authoritative — not mirrored).
- [ ] 10.2 (write-blocking §18) Official history list (server) and `refund` (`History.tsx`, needs `void_sales` + server re-validation) blocked offline; show queued pending sales as `PENDING_SYNC`, clearly separated and never final.
- [ ] 10.3 Tests: offline → History shows the pending section only (marked `PENDING_SYNC`); refund disabled offline; reconnect → a pending sale becomes official and leaves the pending section.

## Phase 11 — Employees (`/empleados`, `manage_employees`) — online-only

- [ ] 11.1 (no mirror — never) Never write employees to IndexedDB; rows carry `pinHash`/`pinSalt` and even the public projection is users/roles material (§18, §24).
- [ ] 11.2 (write-blocking §18) The entire screen blocks offline with a clear "Empleados requiere conexión" state.
- [ ] 11.3 Tests: Employees shows the online-required state; the DB has no employees table/rows offline.

## Phase 12 — Profile (`/perfil`, any role) — online-only

- [ ] 12.1 (optional snapshot) Optionally cache a PUBLIC self snapshot (name/email/phone only — never PIN) in `meta` for read-only offline render.
- [ ] 12.2 (write-blocking §18) Save (`employees.updateSelf`, PIN/email change) blocked offline.
- [ ] 12.3 Tests: profile renders read-only offline from the snapshot if implemented; save disabled offline; no PIN material in IndexedDB.

## Phase 13 — Login (`/login`, public) — online-only

- [ ] 13.1 (no Dexie work) PWA shell already boots offline; Login already shows a "sin conexión" notice and blocks submit offline (`Login.tsx`). Never cache PINs (§24). Listed for an exhaustive screen pass.
- [ ] 13.2 Tests: offline → the login shell renders the "sin conexión" message and submit is blocked; online → login works and the session token is the only persisted credential.

## Phase 14 — Remove `useCachedQuery` (final)

- [ ] 14.1 Confirm `rg -n "useCachedQuery" src convex` returns zero matches.
- [ ] 14.2 Delete `src/state/useCachedQuery.ts`.
- [ ] 14.3 Confirm no leftover `posCache.*` localStorage keys (the Phase 0.4 boot cleanup handles old installs).
- [ ] 14.4 Tests: typecheck/build clean after deletion; a full offline pass of every migrated screen still reads from Dexie.
