# Offline-First Implementation Plan — Dexie.js (IndexedDB), **screen by screen**

> This is the **HOW**. The **WHAT** lives in [`OFFLINE_FIRST_FEATURES.md`](./OFFLINE_FIRST_FEATURES.md)
> (26 sections, the feature spec). This document maps those features onto THIS
> codebase, **one phase per screen**, citing real files, hooks, tables, and the
> real `CartContext` shape.

**Principle (non-negotiable):** **Convex is the source of truth + live reactivity.
Dexie is the offline mirror + a durable pending-writes queue.** We never invent a
second authority. Online, the app reads Convex live and mirrors results into Dexie
in the background. Offline, the app reads the Dexie mirror and queues writes; the
queue drains against Convex when the connection returns.

**How to read this document.** After a single setup phase (Phase 0), there is **one
phase per screen**. Each screen phase is independently shippable and testable: it
migrates that screen's reads to the Dexie mirror, says exactly what works offline
and what stays blocked, names the new hook that replaces the old one, and records
**which old hook dies in that phase**. **Offline write-blocking (FEATURES §18) is part
of EACH screen's phase — never deferred:** the same phase that migrates a screen's reads
ALSO disables that screen's admin writes while offline, with a visible "Sin conexión"
affordance. That is distinct from offline write *queueing* (the durable `pendingOps`
queue), a separate capability born in Phase 6 — **blocking a write ≠ queueing it**.
`useCachedQuery` is removed in the **final phase**, once no hook imports it anymore.

Stack already in place: `convex@^1.36.1`, `vite-plugin-pwa@^1.3.0`, PWA shell + service
worker registered (`src/main.tsx:28`, `vite.config.ts`). **Not yet installed:** `dexie`,
`dexie-react-hooks` (installed in Phase 0). IndexedDB is a same-origin browser API with
**no CSP directive** — the build CSP and Workbox precache need **no change**.

---

## 0. The shared-hook reality (read this before the phases)

The owner's mental model is "migrate a screen → delete its hook." That holds for
screen-LOCAL hooks, but **the four master-data read hooks in `src/state/hooks.ts` are
SHARED across many screens** — they are thin wrappers over `useCachedQuery`
(`hooks.ts:1-62`). You cannot half-migrate a shared hook: the moment you repoint its
body from `useCachedQuery` to the new Dexie primitive `useMirroredQuery`, **every
consumer screen becomes offline-capable at once**. So we assign each shared hook an
**owner master-data screen**; that screen's phase swaps the hook's body to Dexie (and
deletes the old `useCachedQuery`-based implementation). Later consumer-screen phases do
**not** re-migrate the hook — they consume the now-Dexie hook and layer their own
screen-specific offline behavior (search, cart, queue, pending views).

| Old hook (`hooks.ts`) | Wraps | Consumers (file:line) | Migrated & old body DELETED in |
|---|---|---|---|
| `useProducts` (`31-40`) | `useCachedQuery(api.products.list,'products')` | Dashboard `51`, Scan `147`, Sale `1304`, Stored `135`, Products `738`, **CartContext `58`** | **Phase 1 — Products** |
| `useCategories` (`42-51`) | `useCachedQuery(api.categories.list,'categories')` | Dashboard `53`, Scan `150`, Sale `1306`, Products `741` | **Phase 2 — Categories** |
| `useClients` (`53-62`) | `useCachedQuery(api.clients.list,'clients')` | Dashboard `52`, Sale `1305`, Clients `476`, **CartContext `59`** | **Phase 3 — Clients** |
| `useSettingsDoc` (`13-20`) | `useCachedQuery(api.settings.get,'settings')` | Scan `151`, Sale `1307`, Payment `381`, Settings `235` | **Phase 4 — Settings** |
| `useBsRate` (`22-25`) | derives from `useSettingsDoc` | AppShell `106`, Dashboard `48`, Scan `145`, Sale `1303`, Stored `134`, Products `744`, History `638` | becomes Dexie-backed automatically in **Phase 4** (it reads `useSettingsDoc`) |
| `useCachedQuery` (`useCachedQuery.ts`) | localStorage `posCache.*` | only the 4 hooks above | **Final phase** (zero importers after Phases 1-4) |

**Consequence for ordering:** migrate the master-data hooks **first** (Phases 1-4) so
the mirror tables fill and every consumer screen can read offline. Then the consumer
screens (Scan, Sale, Payment, Stored, Dashboard, History) are migrated as
behavior-only phases — none of them deletes a master-data hook; they were already
lit up. The final phase deletes `useCachedQuery`.

### Migration order & justification

```
Phase 0  Setup (db.ts schema, useMirroredQuery, guarded logout)   ← prerequisite
Phase 1  Products      ┐ master-data READS → Dexie. Fills the mirror tables that
Phase 2  Categories    │ every other screen depends on. Lowest risk. Reads migrate AND
Phase 3  Clients       │ each phase blocks its own admin writes offline in-phase (§18);
Phase 4  Settings      ┘ no offline write QUEUE yet (Phase 6). Each deletes one old hook.
Phase 5  Scan            lightest consumer of the mirror; PROVES offline scan/search
                         end-to-end before we tackle Venta's writes. No hook deleted.
Phase 6  Venta/Sale      the heavy one: persistent cart + pendingOps + sales.syncOffline
                         + sync engine + offline checkout. First screen that WRITES offline.
Phase 7  Payment         offline PENDING_SYNC receipt; ties into Venta's queue.
Phase 8  Stored          mirror heldCarts; offline view; park/resume/discard queued/blocked.
Phase 9  Dashboard       mirrored counters; sales.history offline handling.
Phase 10 History         local pending-sales view; refund blocked offline.
Phase 11 Employees       online-only (never cache PIN material).
Phase 12 Profile         online-only (+ optional public self snapshot).
Phase 13 Login           online-only auth; no Dexie work (PWA shell already boots offline).
Phase 14 Remove useCachedQuery  (final; grep proves zero references).
```

Why master-data first: a consumer screen (Scan/Sale/Dashboard/Stored) can only read
offline once the hook feeding it is Dexie-backed. Why Venta after Scan: Scan is the
simplest read-only consumer — proving it offline de-risks the much larger Venta phase.
Why offline write *queueing* starts at Venta (note: admin-write *blocking* already
happens in every screen's own phase, §18): Venta is the first screen that must persist
data (cart, sale) without the server, so `pendingOps` + the sync engine are born there
and then reused by later phases (`CUSTOMER_CREATE` from Clients/Sale, future
`PRODUCT_CREATE_DRAFT`).

---

## Phase 0 — Minimal setup (the only non-screen phase)

Everything the screen phases depend on, and nothing more.

### 0.1 Install (do NOT run as part of this plan)
```
pnpm add dexie dexie-react-hooks
```

### 0.2 `src/state/db.ts` — one typed Dexie instance

Mirror tables key on the **Convex `_id` string** as primary key, so `bulkPut` upserts
by Convex identity. The schema declares **all** local-only tables up front
(`cartDraft`, `pendingOps`, `meta`) even though `pendingOps` is not WRITTEN until
Phase 6 — declaring it now lets the **guarded logout** (0.4) reference
`db.pendingOps` from day one (its count is simply 0 until Venta).

```ts
import Dexie, { type EntityTable } from 'dexie';
import type { Product, Category, Client, Settings, CartItem, SplitRow } from '@/types';
import type { Id } from '@convex/_generated/dataModel';

// Local-only row shapes (not Convex docs)
export interface CartDraft {
  id: 'active';                            // singleton key
  cart: CartItem[];                        // CartContext.tsx:70
  selectedClientId: Id<'clients'> | null;  // CartContext.tsx:71-72
  splits: SplitRow[];                      // CartContext.tsx:73
  splitsNextId: number;                    // CartContext.tsx:74 (splitsIdRef.current)
  updatedAt: number;
}
export type PendingOpType =
  | 'SALE_CREATE' | 'CUSTOMER_CREATE' | 'STOCK_ADJUSTMENT' | 'PRODUCT_CREATE_DRAFT';
export type PendingOpStatus =
  | 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'cancelled';
export interface PendingOp {
  localId?: number;            // ++ auto PK
  idempotencyKey: string;      // crypto.randomUUID(), generated at ENQUEUE
  type: PendingOpType;
  payload: unknown;
  status: PendingOpStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  deviceId: string;            // FEATURES §19
}
export interface MetaRow { key: string; value: unknown }

const db = new Dexie('intentory-pos') as Dexie & {
  products:   EntityTable<Product, '_id'>;
  categories: EntityTable<Category, '_id'>;
  clients:    EntityTable<Client, '_id'>;
  settings:   EntityTable<Settings, '_id'>;
  cartDraft:  EntityTable<CartDraft, 'id'>;
  pendingOps: EntityTable<PendingOp, 'localId'>;
  meta:       EntityTable<MetaRow, 'key'>;
};

db.version(1).stores({
  // — Convex mirror (PK = Convex _id). Whole doc is stored; only INDEXED fields listed. —
  // Indexes mirror convex/schema.ts (by_barcode, by_category) + useful direct lookups.
  // NOTE: Scan/Sale search the in-memory array (see Phase 5), so these indexes are for
  // direct lookups / future index-backed search, not required for offline search to work.
  products:   '_id, barcode, sku, name, categoryId, sellable, _creationTime',
  categories: '_id, label',
  // clients: compound [taxPrefix+taxId] mirrors Convex index by_taxId (clients.byTaxId).
  clients:    '_id, name, [taxPrefix+taxId], createdAt',
  settings:   '_id',           // singleton; no secondary index needed
  // — Local-only durable —
  cartDraft:  'id',            // one row, id='active'
  pendingOps: '++localId, &idempotencyKey, type, status, createdAt, updatedAt',
  meta:       'key',           // deviceId, lastSyncAt.<table>, optional currentUser snapshot
});

// First-run seed: a stable device id (FEATURES §19).
db.on('populate', async () => {
  await db.meta.put({ key: 'deviceId', value: crypto.randomUUID() });
});

export { db };
```

**Field mapping `convex/schema.ts` → Dexie:** `products` (`schema.ts:81-93`, indexes
`308-310`) → barcode/sku/name/categoryId/sellable/_creationTime; `categories`
(`77-79`,`306`) → label; `clients` (`95-104`,`312`) → name + `[taxPrefix+taxId]` (mirrors
`by_taxId`) + createdAt; `settings` (`158-175`,`323`) → singleton. `sales`/`heldCarts`/
`employees` are **not** mirrored here — they arrive in their own screen phases (Stored,
History) or never (Employees — PIN material, §24).

**Versioning rule:** mirror tables are **disposable** — a breaking shape change bumps
`db.version(n)` and `.upgrade(tx => tx.table('products').clear())`; the next sync refills
from Convex. `pendingOps` and `cartDraft` are **durable** — migrate them in place with
`tx.table('pendingOps').toCollection().modify(...)`, **never** `clear()`. (Confirmed via
context7: `db.version(2).stores({…}).upgrade(tx => …)`, drop a table with `table: null`.)

### 0.3 `src/state/useMirroredQuery.ts` — the Convex-primary / Dexie-fallback primitive

Same 3-arg shape as the old `useCachedQuery(query, args, key)`, so swapping a hook's body
is a one-line change.

```ts
import { useEffect } from 'react';
import { useQuery } from 'convex/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

type MirrorTable = 'products' | 'categories' | 'clients';

export function useMirroredQuery<T extends { _id: string }>(
  query: any, args: any, table: MirrorTable
): T[] | undefined {
  const live = useQuery(query, args) as T[] | undefined;

  // Background mirror: every successful server result refreshes Dexie.
  useEffect(() => {
    if (live === undefined) return;                 // loading / offline → keep last mirror
    void db.transaction('rw', db[table], async () => {
      await db[table].clear();                       // full refresh (small single-store POS)
      await (db[table] as any).bulkPut(live);        // bulkPut upserts by _id
    });
  }, [live, table]);

  // Offline fallback only. 'skip' (no session) ⇒ [] so logged-out users see NO data.
  const skipped = args === 'skip';
  const cached = useLiveQuery(
    () => (skipped ? [] : (db[table] as any).toArray()),
    [skipped]
  ) as T[] | undefined;

  return live !== undefined ? live : cached;          // Convex-primary; Dexie fills the gap
}
```

`useSettingsDoc` (a singleton) uses the same pattern with `db.settings.put(live)` /
`db.settings.toCollection().first()`. **Behavioral fix over `useCachedQuery`:** when
`args === 'skip'` the new hook returns `[]` instead of the stale localStorage cache —
closing the read half of the logout-leak bug (`useCachedQuery.ts:22-31` returned cached
data even with no session).

### 0.4 The guarded logout — **DECIDED POLICY** (not an open question)

> **Owner ruling:** logout must **NOT** delete crucial unsynced data. Mirror tables
> (`products`, `categories`, `clients`, `settings`), `cartDraft`, and disposable `meta`
> MAY be cleared on logout. But `pendingOps` that the backend has **not yet confirmed**
> MUST survive logout. A pending op is deleted **only** by the sync engine, and only
> after: device online → op sent → **backend confirms receipt** → op removed.

This supersedes the earlier "open decision / decide before Phase 6" framing — it is now
settled. Wire it into `clearLocalSession` (`SessionContext.tsx:100-109`, called by
`logout` at `207-216`):

```ts
import { db } from './db';

const clearLocalSession = useCallback(async () => {
  try {
    localStorage.removeItem(TOKEN_KEY);     // pos.sessionToken (SessionContext.tsx:21)
    localStorage.removeItem(EXPIRES_KEY);   // pos.sessionExpiresAt (SessionContext.tsx:22)
  } catch { /* ignore */ }

  // GUARD: never destroy unconfirmed durable writes.
  const unsynced = await db.pendingOps
    .where('status').anyOf('pending', 'syncing', 'failed', 'conflict').count();

  if (unsynced > 0) {
    // Clear ONLY the disposable mirror + cartDraft. pendingOps (+ idempotency keys)
    // SURVIVE; the sync engine drains them after re-login and deletes each on
    // server confirmation. (Phases 0-5 never reach this branch — count is 0.)
    await db.transaction('rw',
      db.products, db.categories, db.clients, db.settings, db.cartDraft, () =>
      Promise.all([
        db.products.clear(), db.categories.clear(), db.clients.clear(),
        db.settings.clear(), db.cartDraft.clear(),
      ]));
  } else {
    // No durable writes at risk → safe full wipe (also self-heals a corrupted store).
    await db.delete();
  }
  setToken(null);
  setExpiresAt(null);
}, []);
```

- **`pendingOps` is never cleared here** — not even in the `else` branch's `db.delete()`,
  because that branch only runs when the unsynced count is 0.
- The existing logout dialog warns *"Las ventas en curso se perderán"* (`AppShell.tsx:388`).
  After Phase 6, when unsynced ops exist, extend that `ConfirmDialog` (`AppShell.tsx:385-398`)
  to name the count (*"Hay N ventas sin sincronizar; se conservarán hasta sincronizar"*) so
  the cashier understands the queue is preserved, not lost.
- **One-time legacy cleanup** (boot effect, `SessionContext.tsx:117-129`, next to
  `removeItem('pos.employeeId')`): shed the old localStorage mirror —
  `Object.keys(localStorage).filter(k => k.startsWith('posCache.')).forEach(k => localStorage.removeItem(k))`.

### Phase 0 tests
- `db.products.count()` works after a manual `bulkPut`.
- DevTools → Application → IndexedDB shows `intentory-pos` with all 7 tables and a seeded
  `meta.deviceId`.
- Logout with **0** pending ops → entire DB gone. Logout with a hand-inserted `pending` op
  → mirror + cartDraft cleared, **the op still present**.

---

## Phase 1 — Products (`/productos`, `manage_products`)

**Consumes today:** `useProducts()` (`Products.tsx:738`), `useCategories()` (`741`),
`useBsRate()` (`744`), `useCart().reserved` (`740`). Writes via mutations
`api.products.create/update/setSellable/adjustStock/remove` (`751-755`).

**Dexie table / fill:** `products` mirror, filled by `useMirroredQuery(api.products.list,
…, 'products')` — `bulkPut` by `_id` on every live result (Phase 0.3). PK `_id`; indexes
`barcode`, `sku`, `categoryId`, `sellable`.

**Offline (works):** view the cached catalog (FEATURES §18 "viewing cached products"),
including price/stock **snapshots** and `sellable` status. The products-driven cart
reconciliation in `CartContext.tsx:100-126` keeps reading from this hook, so it self-heals
from the mirror too.

**Offline (blocked, §18) — DONE in this phase:** `create` / `update` / `setSellable` /
`adjustStock` / `remove` (`Products.tsx`) — price changes, stock adjustments and deletes
are risky-admin, so **every trigger is disabled offline** with a visible "Sin conexión"
banner (the app's standard offline-banner affordance, `tone="warn" icon="wifi-off"`).
Threaded via an `online` prop (from `useOnline`) into each control: the **"Nuevo
producto"** button, the detail sheet's **Editar / Ajustar stock / Eliminar**, and the
product form's **submit** (defense-in-depth if the editor is open at disconnect). A
screen-level banner states the catalog is read-only offline; each sheet repeats the
notice in context so the disabled buttons are explained. Reads (catalog view) stay fully
available. (Offline write *queueing* — e.g. a `PRODUCT_CREATE_DRAFT` op — is NOT built
here; that capability is Phase 6. Blocking ≠ queueing.)

**New hook / old hook deleted:** rewrite `useProducts` (`hooks.ts:31-40`) to call
`useMirroredQuery(api.products.list, token ? { token } : 'skip', 'products')`. Signature
unchanged → Products, **and every other consumer (Dashboard, Scan, Sale, Stored,
CartContext)** become product-offline in one move. **DELETE the old
`useCachedQuery`-based body of `useProducts`** in this phase.

**Tests (offline):** load Products online once → DevTools Offline → reload → catalog still
renders from `products` mirror; create/edit/delete are disabled with the offline notice;
`db.products.count()` matches the server list. Automated:
`tests/components/products-offline-blocking.test.tsx` asserts every product write trigger
is disabled offline + the "Sin conexión" banner shows, and that the same controls are
enabled online with no banner.

---

## Phase 2 — Categories (the category section inside `Products.tsx`)

**Note:** there is **no `Categories.tsx` route** — category management is a section within
`Products.tsx` (chips + CRUD modals). This phase migrates the `useCategories` read and
governs that section.

**Consumes today:** `useCategories()` (`Products.tsx:741`, also `Sale.tsx:313,837,1306`,
`Scan.tsx:150`, `Dashboard.tsx:53`). Writes via `api.categories.create/update/removeWithReassign`
(`Products.tsx:503-505`).

**Dexie table / fill:** `categories` mirror via `useMirroredQuery(api.categories.list, …,
'categories')`. PK `_id`; index `label`.

**Offline (works):** render category chips / filters from the mirror (Scan and Sale filter
products by `categoryId` against this list).

**Offline (blocked, §18) — DONE in this phase:** category `create` / `update` /
`removeWithReassign` (`Products.tsx`, the `CategoriesSheet`). The Categorías sheet still
**OPENS offline** (reading the list + counts is allowed), but **Crear / Renombrar /
Eliminar** (and the reassign-delete confirm) are **disabled offline** with a visible "Sin
conexión" banner inside the sheet. Same `online`-prop threading as Phase 1.

**New hook / old hook deleted:** rewrite `useCategories` (`hooks.ts:42-51`) to
`useMirroredQuery(api.categories.list, …, 'categories')`. **DELETE the old
`useCachedQuery`-based body of `useCategories`.** Lights up category reads in Dashboard,
Scan, Sale simultaneously.

**Tests (offline):** category chips render offline in Products/Scan/Sale; CRUD modals
disabled offline. Automated: `tests/components/products-offline-blocking.test.tsx`
asserts the Categorías sheet still opens offline (read) while Crear/Renombrar/Eliminar are
disabled + the "Sin conexión" banner shows, and that they are enabled online.

---

## Phase 3 — Clients (`/clientes`, `manage_clients`)

**Consumes today:** `useClients()` (`Clients.tsx:476`; also `Sale.tsx:1305`,
`Dashboard.tsx:52`, `CartContext.tsx:59`). Writes via `api.clients.create` (`479`),
`update` (`480`), `remove` (`481`).

**Dexie table / fill:** `clients` mirror via `useMirroredQuery(api.clients.list, …,
'clients')`. PK `_id`; compound index `[taxPrefix+taxId]` (mirrors Convex `by_taxId`),
`name`, `createdAt`.

**Offline (works):** view the cached client list; the Sale client picker filters this
array (including the tax-id match at `Sale.tsx:1180`), so client selection works offline.

**Offline (blocked, §18) — DONE in this phase:** `create` / `update` / `remove`
(`Clients.tsx`) AND the in-sale create flow (`Sale.tsx`'s `ClientGate` + client picker)
are admin/risky-admin writes, so **every trigger is disabled offline** with a visible
"Sin conexión" banner (the app's standard offline-banner affordance, `tone="warn"
icon="wifi-off"`). Threaded via an `online` prop (from `useOnline`) into each control:
the **"Nuevo cliente"** button, the detail sheet's **Editar / Eliminar**, the client
form's **submit** (defense-in-depth if the editor is open at disconnect), the
ClientGate's **"Crear cliente"**, and the picker's **"Crear nuevo cliente"**. A
screen-level banner states the list is read-only offline; each sheet repeats the notice
in context. Reads (the client list, search, and the Sale picker's tax-id match at
`Sale.tsx`) stay fully available — selecting an EXISTING client offline still works.
**Offline create as a queued draft (`CUSTOMER_CREATE`)** is *specced here* but
**activated in Phase 6**, because the durable queue (`pendingOps`) is born in Venta and
create-client is primarily reached from Venta's ClientGate (`Sale.tsx`
`api.clients.create`). Until then create is **BLOCKED, not queued** (blocking ≠ queueing).

**New hook / old hook deleted:** rewrite `useClients` (`hooks.ts:53-62`) to
`useMirroredQuery(api.clients.list, …, 'clients')`. **DELETE the old `useCachedQuery`-based
body of `useClients`.** Lights up client reads in Sale, Dashboard, CartContext.

**Tests (offline):** client list renders offline in Clients and the Sale picker;
update/remove disabled; tax-id filter still matches against the mirror. Automated:
`tests/state/clients-mirror.test.tsx` (Convex-primary mirror, Dexie offline fallback with
the tax identity intact, `'skip'` ⇒ `[]`) + `tests/components/clients-offline-blocking.test.tsx`
(every client write trigger — Nuevo cliente, detail Editar/Eliminar, the ClientGate's
"Crear cliente" — disabled offline with the "Sin conexión" banner, while search/select
stay enabled; the same controls enabled online with no banner).

---

## Phase 4 — Settings (`/ajustes`, `manage_settings`) — DONE

**Consumes today:** `useSettingsDoc()` (`Settings.tsx:235`; also `Scan.tsx:151`,
`Sale.tsx:1307`, `Payment.tsx:381`, and indirectly **every** `useBsRate()` caller). Writes
via `api.settings.update` (`Settings.tsx:236`).

**Dexie table / fill:** `settings` singleton mirror. `useSettingsDoc` background-writes
`db.settings.put(live)` and falls back to `db.settings.toCollection().first()`.

**Offline (works):** read store config — `storeName`, `bsRate`, `ivaPct`, `scannerMode`,
`taxName`, `currency` (`schema.ts:158-175`) — from the mirror. This is what makes Scan's
camera/physical mode, Sale's IVA math, and Payment's Bs conversion work offline.

**Offline (blocked, §18) — DONE in this phase:** every `settings.update` write is
disabled offline via an `online` prop (from `useOnline`) + the standard "Sin conexión"
`Banner` (`tone="warn" icon="wifi-off"`) — same affordance as Phases 1-3. Blocked: the
four preference **toggles** (`printAuto`/`emailReceipt`/`lowStockAlerts`/`soundScan`,
which call `settings.update` on tap) and the **Guardar** button of every editor sheet
(store / billing-taxes / bs-rate / currency / scanner). A screen-level banner states the
config is read-only offline; each editor sheet repeats the notice in context and its
Guardar is disabled. The `save` helper also no-ops offline (defense-in-depth). Editor
sheets still **OPEN offline** to VIEW current values (read) — only the write is blocked.

**New hook / old hook deleted:** rewrite `useSettingsDoc` (`hooks.ts:13-20`) to the Dexie
singleton pattern. `useBsRate` (`hooks.ts:22-25`) needs **no change** — it reads
`useSettingsDoc`, so it becomes Dexie-backed for free (AppShell, Dashboard, Scan, Sale,
Stored, Products, History all get the offline `bsRate`). **DELETE the old
`useCachedQuery`-based body of `useSettingsDoc`.**

> **After Phase 4 (now done), all four** `useCachedQuery` consumers are gone —
> `useSettingsDoc` was the LAST one. `useCachedQuery.ts` now has **zero importers**
> (`rg -n "useCachedQuery" src` shows only its own definition + a one-line orphan
> notice), but it is left in place and deleted in Phase 14 (keep the diff focused per
> phase). `useSettingsDoc` follows the Dexie singleton adaptation of `useMirroredQuery`
> (`db.settings.put(live)` / `db.settings.toCollection().first()`), so `useBsRate` — and
> every screen through it — is Dexie-backed automatically.

**Tests (offline):** Settings renders config offline; edits disabled; `useBsRate()`
returns the cached rate offline (verify the Payment Bs total and Sale IVA compute offline).

---

## Phase 5 — Scan (`/escanear`, any role) — offline search proof

**Consumes today:** `useBsRate()` (`Scan.tsx:145`), `useProducts()` (`147`),
`useCart().reserved` (`149`), `useCategories()` (`150`), `useSettingsDoc()` (`151`). Plus
`src/screens/CameraScanner.tsx` when `settings.scannerMode === 'camera'`.

**No hook migration** — products/categories/settings are already Dexie-backed (Phases 1,
2, 4). This phase is **behavior-only**: prove and polish offline scan/search.

**Key finding — offline search is already in-memory.** Scan does **not** call any
`api.products.byBarcode` query. It filters the in-memory `catalog` array (from
`useProducts()`):
- HID keyboard-wedge lookup: `catalog.find((p) => p.barcode === code)` (`Scan.tsx:217`).
- Search box: `catalog.filter(...)` by `name` / `sku` / `barcode` (`Scan.tsx:173-181`).

So **once `useProducts` is Dexie-backed (Phase 1), barcode/SKU/name search works offline
with zero changes to Scan** (FEATURES §4). `zxing-wasm` is already precached by Workbox, so
the camera scanner boots offline too.

**Offline (works):** full barcode/SKU/name lookup and category browse from the mirror —
read-only.

**Offline (blocked):** nothing — Scan is read-only. **Add** a banner: "Sin conexión —
precios y stock pueden estar desactualizados" (FEATURES §4) driven by `useOnline`.

**Tests (offline):** Offline → scan a known barcode (HID + camera) → product resolves from
the mirror; search by name/SKU returns cached matches; the "datos desactualizados" banner
shows offline and hides online.

---

## Phase 6 — Venta / Sale (`/venta`, any role) — the heavy phase (offline WRITES start here)

**Consumes today:** all four master-data hooks — `useBsRate` (`Sale.tsx:1303`),
`useProducts` (`1304`), `useClients` (`1305`), `useCategories` (`1306`), `useSettingsDoc`
(`1307`) — plus `useCart()` (`1320`) and `api.clients.create` inline (`1322`). Checkout is
driven by the `onConfirm` prop → `AppShell.handleSaleConfirm` (`AppShell.tsx:209-217`),
which **hard-blocks offline today**.

Reads are already mirrored (Phases 1-4). This phase adds the three things that make a sale
survive without the server: **persistent cart**, the **pending-ops queue + idempotent sync
mutation + sync engine**, and **offline checkout**.

### 6.1 Persistent cart (`CartContext` → `cartDraft`)

Cart, client, and splits live in React state and die on reload (`CartContext.tsx:70-83`).
Write-through every mutation to the `cartDraft` row and hydrate on mount.

| State (`CartContext.tsx`) | Line | Persist? |
|---|---|---|
| `cart: CartItem[]` | `70` | ✅ |
| `selectedClientId` | `71-72` | ✅ |
| `splits: SplitRow[]` | `73` | ✅ |
| `splitsIdRef.current` | `74` | ✅ |
| `completedSale` | `75-77` | optional (survive reload on `/venta/exito`) |
| `pausedRemovals` | `83` | ❌ transient |
| `heldCarts` (`60-68`) | — | ❌ server-owned (Phase 8) |

```ts
// inside CartProvider
const hydratedRef = useRef(false);
useEffect(() => {                                   // 1) hydrate once, BEFORE write-through
  void (async () => {
    const draft = await db.cartDraft.get('active');
    if (draft) {
      setCart(draft.cart);
      setSelectedClientId(draft.selectedClientId);
      setSplits(draft.splits);
      splitsIdRef.current = draft.splitsNextId;
    }
    hydratedRef.current = true;
  })();
}, []);
useEffect(() => {                                   // 2) write-through (guarded)
  if (!hydratedRef.current) return;                 // don't clobber the saved draft with []
  void db.cartDraft.put({
    id: 'active', cart, selectedClientId, splits,
    splitsNextId: splitsIdRef.current, updatedAt: Date.now(),
  });
}, [cart, selectedClientId, splits]);
```

Reconciliation already exists: `CartContext.tsx:100-126` refreshes lines from live products
and drops paused/deleted items, and `resumeSale` (`191-229`) does the same — a restored
draft self-heals. `discardSale` (`151-155`) and the checkout reset (`AppShell.tsx:249-251`)
clear the draft (`db.cartDraft.delete('active')`). `hydratedRef` + idempotent `put`
keep StrictMode's double-effects (`main.tsx:33`) safe.

### 6.2 Pending-ops queue (`pendingOps`, FEATURES §6) — born here

Each offline write becomes a row (Phase 0.2 shape). The CUSTOMER_CREATE draft specced in
Phase 3 activates now: when offline, `Sale`'s inline create (`Sale.tsx:1322`) enqueues a
`CUSTOMER_CREATE` op and inserts a local client row so the cart can proceed; it syncs later.

### 6.3 Idempotent sync mutation — new `sales.syncOffline` (FEATURES §8-9)

`sales.checkout` (`convex/sales.ts`, called at `AppShell.tsx:229`) is **NOT idempotent** —
it consumes the invoice counter, decrements stock, inserts. A retried offline sale would
double-charge. Add an idempotent sibling that replays safely:

```ts
export const syncOffline = mutation({
  args: { token: v.string(), idempotencyKey: v.string(), deviceId: v.string(),
          clientId: v.id('clients'),
          items: v.array(v.object({ productId: v.id('products'), qty: v.number() })),
          method: v.string(), splits: v.array(splitItemValidator),
          tendered: v.optional(v.number()), soldAt: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireSession(ctx, args.token);
    const existing = await ctx.db.query('sales')
      .withIndex('by_idempotencyKey', q => q.eq('idempotencyKey', args.idempotencyKey))
      .unique();
    if (existing) return existing;                  // §8/§9 replay → never a duplicate
    // re-validate stock on the SERVER (§10); insufficient → typed ConvexError (§15);
    // then consume invoice #, decrement stock, insert sale + { idempotencyKey, deviceId }.
  },
});
```

**Schema migration (widen-migrate-narrow, see `convex-migration-helper`):** add
`idempotencyKey: v.optional(v.string())` + `deviceId: v.optional(v.string())` to
`saleFields` (`schema.ts:121-138`) and a new `.index('by_idempotencyKey', ['idempotencyKey'])`
(`schema.ts:316-318`). Additive — no existing row breaks. Throw **structured**
`ConvexError({ code })` for the §15 conflict codes (`STOCK_INSUFFICIENT`, `PRODUCT_DELETED`,
`PRODUCT_DISABLED`, `PRICE_CHANGED`, `TAX_CHANGED`, `CUSTOMER_NOT_FOUND`,
`DUPLICATE_OPERATION`, `AUTH_EXPIRED`, `PERMISSION_DENIED`) so the client maps codes →
`conflict` status. Share `snapshotLines` + the reserved backstop with `checkout` to avoid drift.

### 6.4 Sync engine (FEATURES §12) — born here, owns op deletion

Module singleton (`src/state/sync.ts`) holding `useMutation(api.sales.syncOffline)`.
Triggers: app start, `online` event (extend `src/state/useOnline.ts`), Convex reconnect,
"Sync now", new op enqueued. Processes `pendingOps` in `createdAt` order
(`pending → syncing → synced | failed | conflict`), capped exponential backoff, and a
**single-flight lock** so loops never overlap. **It is the ONLY place a `pendingOps` row is
deleted — and only after the backend confirms receipt** (the success path, per the Phase 0.4
policy). `AUTH_EXPIRED` (§24) marks the op and forces re-login (the token may lapse offline).

### 6.5 Offline checkout (replace the hard block)

Rewrite `AppShell.handleSaleConfirm` (`AppShell.tsx:209-217`): when `!online`, instead of
`setOfflineError(true)`, write a local `PENDING_SYNC` sale (local receipt #), enqueue a
`SALE_CREATE` op, and route to a pending receipt. `handlePaymentConfirm` (`219-260`) gets
the same offline branch (enqueue instead of calling `checkout`). Online path is unchanged.

**Offline (works):** build cart, pick/create client (queued `CUSTOMER_CREATE`), compute
subtotal/IVA from cached `settings.ivaPct`, **cart survives reload**, checkout enqueues a
`SALE_CREATE`. **Offline (blocked):** nothing in the cashier flow — but the sale is
PENDING_SYNC until the server confirms (§10 re-validation may produce a conflict).

**Tests (offline):** add items → reload (F5) → cart/client/splits restored; checkout
offline → `SALE_CREATE` enqueued + local receipt; reconnect → engine syncs, op deleted only
after confirm; **duplicate sync** (same idempotencyKey) returns the same sale; stock
conflict marks the op `conflict` (not deleted); logout with the op pending → op survives
(Phase 0.4).

---

## Phase 7 — Payment (overlay of Sale, no route)

**Consumes today:** `useSettingsDoc()` in `SuccessScreen` (`Payment.tsx:381`); confirm →
`AppShell.handlePaymentConfirm` → `api.sales.checkout` (`AppShell.tsx:229`).

**No hook migration** — settings already mirrored (Phase 4). Behavior-only.

**Offline (works):** compute totals and the Bs conversion from cached `bsRate`/`ivaPct`;
render a local **PENDING_SYNC** receipt (FEATURES §17) for the offline sale enqueued in
Phase 6. `SuccessScreen` already receives an `online` prop (`AppShell.tsx:88,306`) — use it
to stamp the receipt "PENDIENTE DE SINCRONIZACIÓN".

**Offline (blocked):** the official receipt/invoice number — only minted by `syncOffline`
on the server after confirm; the local receipt links to it post-sync.

**Tests (offline):** offline checkout shows a PENDING_SYNC receipt with correct Bs/IVA
totals; after reconnect-sync the official invoice number replaces/links the local one.

---

## Phase 8 — Stored / Ventas en espera (`/ventas-en-espera`, any role)

**Consumes today:** `useBsRate()` (`Stored.tsx:134`), `useProducts()` (`135`), `useCart()`
(`144`) → `heldCarts` + `pauseSale`/`resumeSale`/`discardStored`, all backed by
`api.heldCarts.list/park/resume/discard` (`CartContext.tsx:60-68,85-87,180-233`).

**Dexie table / fill:** add a `heldCarts` mirror table (new `db.version(2)` —
`'_id, code, createdAt'`, mirroring `heldCartFields`, `schema.ts:140-150`). `heldCarts.list`
is uncached today (`CartContext.tsx:60`) — mirror it with the same `useMirroredQuery`
pattern so the held list renders offline.

**Offline (works after mirroring):** view the held-carts list and the reserved-stock
overlay (`CartContext.tsx:128-136`).

**Offline (blocked / queued):** `park` / `resume` / `discard` are server mutations
(`CartContext.tsx:180-233`) — online-only initially; optionally queue `park` as a pending op
later. Resume of a held cart while offline reads from the mirror but cannot mutate server state.

**Tests (offline):** held list renders offline from the `heldCarts` mirror; park/resume/discard
disabled (or queued) offline; reserved-stock math still reduces Venta availability offline.

---

## Phase 9 — Dashboard (`/`, any role)

**Consumes today:** `useBsRate` (`Dashboard.tsx:48`), `useProducts` (`51`), `useClients`
(`52`), `useCategories` (`53`), `useCart().heldCarts` (`54`), and
`useQuery(api.sales.history, …)` (`50`).

**No master-data hook migration** — all four are Dexie-backed (Phases 1-4). Behavior-only.

**Offline (works):** catalog counts, low-stock tiles, client counts, and the Bs rate all
compute from the mirror. Tiles are already `can()`-gated.

**Offline (blocked / degraded):** live "today's sales" totals need `api.sales.history`
(`Dashboard.tsx:50`) — offline, show the last cached figure plus locally-queued
`SALE_CREATE` pending sales (from Phase 6) labeled "pendiente", never as official totals.

**Tests (offline):** Dashboard counters render offline from mirrors; sales tiles show
cached + pending (clearly marked) without throwing when `sales.history` is unavailable.

---

## Phase 10 — History (`/historial`, `view_reports`)

**Consumes today:** `useBsRate()` (`History.tsx:638`), `useQuery(api.sales.history, token ?
{ token } : 'skip')` (`636`), refund via `api.sales.refund` (`640`).

**Dexie table / fill:** add a local **`pendingSales`** view sourced from `pendingOps` of
type `SALE_CREATE` (Phase 6) — these are the local PENDING_SYNC sales (FEATURES §7).
Official history stays server-only (not mirrored — admin-gated, large, and authoritative).

**Offline (works):** show locally-queued pending sales as **PENDING_SYNC** (§7, §17),
clearly separated from official sales and never counted as final.

**Offline (blocked, §18):** official history list (server) and **refund** (`History.tsx:640`,
needs `void_sales` + server re-validation) — blocked offline.

**Tests (offline):** offline → History shows pending sales section only, marked
PENDING_SYNC; refund disabled offline; reconnect → pending sale becomes official and moves
out of the pending section.

---

## Phase 11 — Employees (`/empleados`, `manage_employees`) — online-only

**Consumes today:** `useQuery(api.employees.list, …)` (`Employees.tsx:551`); writes
`create`/`update`/`remove` (`552-554`).

**Dexie:** **none — never mirror employees.** Rows carry `pinHash`/`pinSalt`
(`schema.ts:114-115`); even the public projection (`schema.ts:247-251`) is users/roles
material that §18 + §24 keep off the device.

**Offline:** the entire screen is blocked (§18 "creating users / changing roles"). Show a
clear "Empleados requiere conexión" state offline.

**Tests (offline):** Employees shows the online-required state; no employee data is ever
written to IndexedDB (verify the DB has no employees table/rows).

---

## Phase 12 — Profile (`/perfil`, any role) — online-only

**Consumes today:** `useSession().user` (from `api.auth.me`, `SessionContext.tsx:81`) at
`Profile.tsx:134`; save via `api.employees.updateSelf` (`135,153-159`).

**Dexie (optional):** cache a **public** self snapshot (name/email/phone only — never PIN)
in `meta` so the profile renders read-only offline. Optional; skip if not needed.

**Offline (works, optional):** view own name/email/phone from the `meta` snapshot.
**Offline (blocked):** save (PIN/email change → `updateSelf`, server-only).

**Tests (offline):** profile renders read-only offline from the snapshot (if implemented);
save disabled offline; no PIN material in IndexedDB.

---

## Phase 13 — Login (`/login`, public) — online-only

**Consumes today:** `useOnline()` (`Login.tsx:12`), `useSession().login` → `api.auth.login`
(`Login.tsx:13,27`). No business data — **never cache PINs** (§24).

**No Dexie work.** The PWA shell already boots offline (Workbox precache); Login already
shows a "sin conexión" notice and blocks submit offline (`Login.tsx:22-25,64`). Nothing to
migrate — listed for completeness so the screen-by-screen pass is exhaustive.

**Tests (offline):** offline → the login shell renders with the "sin conexión" message and
the submit is blocked; online → login works and the session token is the only persisted
credential.

---

## Phase 14 — Remove `useCachedQuery` (final)

After Phases 1-4, no hook imports `useCachedQuery` anymore. **Prove it, then delete.**

```
rg -n "useCachedQuery" src convex     # MUST return zero matches before deletion
```

- [ ] Confirm `rg` shows zero references.
- [ ] Delete `src/state/useCachedQuery.ts`.
- [ ] Confirm no leftover `posCache.*` localStorage keys (the one-time cleanup in Phase 0.4
      handles old installs).

**Tests:** typecheck/build is clean after deletion; a full offline pass of every migrated
screen still reads from Dexie.

---

## Cross-cutting reference

- **Connection state (§13):** don't trust `navigator.onLine` alone (`useOnline.ts`); combine
  with the Convex WebSocket connection status to drive `online | offline | reconnecting |
  syncing | sync_failed` + the pending-op count in `NavLayout` (already gets `online`,
  `AppShell.tsx:271`). Wired in Phase 6 (sync engine) and surfaced through Phases 7-10.
- **Device identity (§19) & audit (§20):** `deviceId` seeded once in `meta` (Phase 0.2),
  attached to every op and synced sale.
- **Security (§24):** no secrets in IndexedDB — the session token stays in `localStorage`
  (`SessionContext.tsx:21-22`); `pinHash`/`pinSalt` never reach the client
  (`src/types.ts`, `Employee = Omit<…,'pinHash'|'pinSalt'>`).
- **Service-worker update (§23):** don't apply an SW update mid-sale or mid-sync — gate the
  `vite-plugin-pwa` update prompt on an empty cart draft + zero `syncing` ops.

## Risks

1. **Shared hooks light up many screens at once** (Phase 0 table). A bug in
   `useMirroredQuery` affects every consumer — test each master-data phase in isolation
   before moving on.
2. **Double source of truth.** Mitigated by Convex-primary reads (Dexie renders only when
   Convex is dark). A one-frame stale flash on reconnect is acceptable; the live value
   supersedes immediately.
3. **Idempotency.** The key MUST be generated at **enqueue** (Phase 6.2) and persisted with
   the op so retries reuse it; `by_idempotencyKey` makes replays return the existing sale.
4. **Local stock is a snapshot (§10).** Two cashiers selling the last unit offline both
   queue; the server re-validates and the loser gets `STOCK_INSUFFICIENT → conflict`. Never
   auto-resolve.
5. **Dashboard reads `api.sales.history` for any role** (`Dashboard.tsx:50`) while History
   gates it behind `view_reports` (`AppShell.tsx:321`). Confirm server behavior for a cashier
   before relying on cached sales tiles.
