// Phase 6.4 — the client-side sync engine (OFFLINE_FIRST_PLAN §6.4 + §6.2.1).
//
// This is the piece that DRAINS the durable pending-ops queue (Phase 6.2) against
// Convex, and it is the ONLY place a `pendingOps` row is ever deleted — and only
// AFTER the backend confirms receipt (Phase 0.4 policy; the guarded logout depends
// on this). Convex owns every real `_id`; a client/sale created offline carries a
// `local:<uuid>` placeholder until this engine creates the real row and remaps
// `local → real` before the dependent op is sent (the §6.2.1 flow).
//
// DESIGN
//  • Ordering — ops are processed in `createdAt` order (== dependency order): a
//    CUSTOMER_CREATE is always enqueued before the SALE_CREATE that references it,
//    so it syncs first. Backstop (§6.2.1): if a SALE_CREATE still holds an
//    UNRESOLVED `local:` id (no map entry yet), it is SKIPPED this pass and retried
//    after its CUSTOMER_CREATE lands — a sale never reaches the server with a local id.
//  • Single-flight — a module-level `inFlight` flag guarantees two drain loops never
//    overlap; a trigger that fires mid-drain just requests one more pass (coalesced).
//  • local → real remap — on CUSTOMER_CREATE success the engine writes
//    `idmap:local:… → realId` into the `meta` table, rewrites every queued op that
//    referenced that local id (a SALE_CREATE's `clientId`), and swaps the `_local`
//    Dexie `clients` row for the real doc so the UI shows the real client.
//  • Deletion-after-confirm — an op is deleted ONLY on backend success. A structured
//    §15 conflict (ConvexError({ code })) marks it `conflict` (never deleted — the
//    owner resolves later). A transient/network error marks it `failed` and retries
//    with capped exponential backoff. `AUTH_EXPIRED` (§24) reverts the op to
//    `pending` and surfaces a re-login need (the token may have lapsed offline).
//
// The engine is framework-agnostic: a Convex mutation can only be obtained through
// the `useMutation` hook, so the React layer (`useSyncEngine`) injects the bound
// runners + a live token getter via `configureSyncEngine`. This keeps the core a
// plain module singleton — startable on app boot, the `online` event, or a new op
// enqueued — and trivially unit-testable with injected fakes.
import { db } from './db';
import type { PendingOp } from './db';
import { isLocalId } from './localId';
import type { CustomerCreatePayload } from './offlineClient';
import type { CleanSplit, Client } from '@/types';
import type { Id } from '@convex/_generated/dataModel';

// ---------------------------------------------------------------------------
// Op payload contracts. CUSTOMER_CREATE's payload is minted by `createOfflineClient`
// (Phase 6.2). SALE_CREATE's payload is defined HERE so the engine can drain it
// generically now; Phase 6.5 (offline checkout) only has to ENQUEUE this shape.
// ---------------------------------------------------------------------------

/** Queued offline sale. `clientId` is a `local:<uuid>` while offline and a real
 *  `Id<'clients'>` after the engine remaps it (§6.2.1). The op-level
 *  `idempotencyKey` + `deviceId` (set at enqueue) are what make replays safe. */
export interface SaleCreatePayload {
  clientId: string;
  items: Array<{ productId: Id<'products'>; qty: number }>;
  method: string;
  splits: CleanSplit[];
  tendered?: number;
  soldAt: number;
}

/** Args the engine hands to the injected `api.clients.create` runner. */
export interface CreateClientArgs {
  token: string;
  name: string;
  taxPrefix: Client['taxPrefix'];
  taxId: string;
  kind: Client['kind'];
  email?: string;
  phone?: string;
  address?: string;
}

/** Args the engine hands to the injected `api.sales.syncOffline` runner. */
export interface SyncSaleArgs {
  token: string;
  idempotencyKey: string;
  deviceId: string;
  clientId: Id<'clients'>;
  items: Array<{ productId: Id<'products'>; qty: number }>;
  method: string;
  splits: CleanSplit[];
  tendered?: number;
  soldAt: number;
}

/** Everything the engine needs from the outside world, injected once at wiring. */
export interface SyncEngineDeps {
  /** Bound `api.clients.create` runner. Returns the stored client doc (real `_id`). */
  createClient: (args: CreateClientArgs) => Promise<Client>;
  /** Bound `api.sales.syncOffline` runner (idempotent, §6.3). Returns the sale doc. */
  syncSale: (args: SyncSaleArgs) => Promise<{ _id: string }>;
  /** The live session token, or null when logged out. Read per drain, not captured. */
  getToken: () => string | null;
  /** Called when the backend reports AUTH_EXPIRED so the UI can force a re-login. */
  onAuthExpired?: () => void;
  /** Backoff base for a failed op (ms). Defaults to 5 s. */
  baseDelayMs?: number;
  /** Backoff cap for a failed op (ms). Defaults to 5 min. */
  maxDelayMs?: number;
}

export interface SyncRunResult {
  /** false when the run was skipped (no deps / already in flight). */
  ran: boolean;
  processed: number;
  deleted: number;
  conflicts: number;
  failed: number;
  skipped: number;
  reason?: 'no-deps' | 'busy' | 'no-token' | 'auth-expired';
}

// Structured §15 conflict codes that are NON-retryable → mark the op `conflict`
// (never delete; the owner resolves later). `AUTH_EXPIRED` is handled separately
// because it IS recoverable (re-login), so it must NOT become a terminal conflict.
const CONFLICT_CODES: ReadonlySet<string> = new Set([
  'STOCK_INSUFFICIENT',
  'PRODUCT_DELETED',
  'PRODUCT_DISABLED',
  'PRICE_CHANGED',
  'TAX_CHANGED',
  'CUSTOMER_NOT_FOUND',
  'DUPLICATE_OPERATION',
  'PERMISSION_DENIED',
]);
const AUTH_EXPIRED = 'AUTH_EXPIRED';

const DEFAULT_BASE_DELAY_MS = 5_000;
const DEFAULT_MAX_DELAY_MS = 5 * 60_000;

/** meta-table key prefix for the local → real id map (§6.2.1). */
const ID_MAP_PREFIX = 'idmap:';
const idMapKey = (localId: string): string => ID_MAP_PREFIX + localId;

// A stored op always has its auto-increment PK; narrow the optional away once loaded.
type StoredOp = PendingOp & { localId: number };

// ---------------------------------------------------------------------------
// Module-singleton state.
// ---------------------------------------------------------------------------
let deps: SyncEngineDeps | null = null;
let inFlight = false;
let rerunRequested = false;

/** Wire the engine's backend runners + token source (called once by `useSyncEngine`). */
export function configureSyncEngine(next: SyncEngineDeps): void {
  deps = next;
}

/** True once `configureSyncEngine` has run. */
export function isSyncEngineConfigured(): boolean {
  return deps !== null;
}

/** Fire-and-forget trigger (app start, `online` event, a new op enqueued). No-ops
 *  until the engine is configured, so it is safe to call from anywhere. */
export function requestSync(): void {
  if (!deps) return;
  void runSync();
}

/** Test-only: drop all singleton state between cases. */
export function __resetSyncEngineForTests(): void {
  deps = null;
  inFlight = false;
  rerunRequested = false;
}

// ---------------------------------------------------------------------------
// Error classification. A Convex client surfaces a server `ConvexError(data)` with
// the thrown value on `error.data`; `sales.syncOffline` throws `{ code }` (§15).
// ---------------------------------------------------------------------------
function structuredCode(err: unknown): string | null {
  const data = (err as { data?: unknown } | null | undefined)?.data;
  if (data && typeof data === 'object' && 'code' in data) {
    const code = (data as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const data = (err as { data?: unknown } | null | undefined)?.data;
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data ?? err);
  } catch {
    return 'Error desconocido durante la sincronización.';
  }
}

/** An op is due when it is `pending`, or `failed` and its backoff window elapsed.
 *  `syncing` (a crash leftover), `conflict`, `synced` and `cancelled` are skipped. */
function isDue(op: StoredOp, now: number, base: number, max: number): boolean {
  if (op.status === 'pending') return true;
  if (op.status === 'failed') {
    const delay = Math.min(base * 2 ** Math.max(0, op.attempts - 1), max);
    return now - op.updatedAt >= delay;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-op handlers.
// ---------------------------------------------------------------------------

/**
 * CUSTOMER_CREATE (§6.2.1): create the real client, persist the local → real map,
 * rewrite every queued op that referenced the local id, swap the `_local` mirror
 * row for the real doc, and delete the op — all only after the create succeeded.
 * `passMap` is the in-memory map of ids resolved during THIS drain so a later
 * SALE_CREATE in the same pass sees the mapping without re-reading `meta`.
 */
async function processCustomerCreate(
  op: StoredOp,
  token: string,
  active: SyncEngineDeps,
  ops: StoredOp[],
  passMap: Map<string, string>
): Promise<void> {
  const payload = op.payload as CustomerCreatePayload;
  const { localId, ...fields } = payload;

  await db.pendingOps.update(op.localId, {
    status: 'syncing',
    updatedAt: Date.now(),
  });

  // The create is the ONLY non-idempotent backend call in the engine, so it runs
  // OUTSIDE the local commit: on failure the catch in `drainOnce` reverts the op,
  // and the map/rewrite/swap/delete below happen atomically only once we hold a
  // confirmed real id.
  const realClient = await active.createClient({ token, ...fields });
  const realId: string = realClient._id;

  await db.transaction('rw', db.meta, db.pendingOps, db.clients, async () => {
    // 1. Persist the mapping for dependent ops + the backstop across reloads.
    await db.meta.put({ key: idMapKey(localId), value: realId });

    // 2. Rewrite every queued op that referenced this local id (a SALE_CREATE's
    //    clientId). Keeps the persisted payload correct even if the pass is
    //    interrupted; the in-memory copy is updated too so this same pass sees it.
    for (const other of ops) {
      if (other.localId === op.localId || other.type !== 'SALE_CREATE') continue;
      const p = other.payload as SaleCreatePayload;
      if (p && p.clientId === localId) {
        const rewritten: SaleCreatePayload = { ...p, clientId: realId };
        await db.pendingOps.update(other.localId, {
          payload: rewritten,
          updatedAt: Date.now(),
        });
        other.payload = rewritten;
      }
    }

    // 3. Swap the `_local` draft row for the real client doc so the UI shows the
    //    real client (otherwise the mirror refresh would leave a stale duplicate).
    await db.clients.delete(localId as Id<'clients'>);
    await db.clients.put(realClient);

    // 4. Deletion-after-confirm (Phase 0.4): the create is committed — drop the op.
    await db.pendingOps.delete(op.localId);
  });

  passMap.set(localId, realId);
}

type SaleOutcome = 'sent' | 'skipped';

/**
 * SALE_CREATE (§6.3): remap `clientId` local → real, then replay the idempotent
 * `sales.syncOffline`. A replay of the same `idempotencyKey` returns the same sale,
 * so deleting on success can never lose or duplicate a sale. An unresolved local id
 * triggers the dependency backstop (skip this pass).
 */
async function processSaleCreate(
  op: StoredOp,
  token: string,
  active: SyncEngineDeps,
  passMap: Map<string, string>
): Promise<SaleOutcome> {
  const payload = op.payload as SaleCreatePayload;

  let clientId = payload.clientId;
  if (isLocalId(clientId)) {
    const resolved = passMap.get(clientId) ?? (await readIdMap(clientId));
    if (!resolved) return 'skipped'; // backstop — retry after its CUSTOMER_CREATE lands
    clientId = resolved;
  }

  await db.pendingOps.update(op.localId, {
    status: 'syncing',
    updatedAt: Date.now(),
  });

  await active.syncSale({
    token,
    idempotencyKey: op.idempotencyKey,
    deviceId: op.deviceId,
    clientId: clientId as Id<'clients'>,
    items: payload.items,
    method: payload.method,
    splits: payload.splits,
    ...(payload.tendered !== undefined ? { tendered: payload.tendered } : {}),
    soldAt: payload.soldAt,
  });

  await db.pendingOps.delete(op.localId);
  return 'sent';
}

async function readIdMap(localId: string): Promise<string | null> {
  const row = await db.meta.get(idMapKey(localId));
  return row && typeof row.value === 'string' ? row.value : null;
}

// ---------------------------------------------------------------------------
// Drain loop.
// ---------------------------------------------------------------------------
type Aggregate = Pick<
  SyncRunResult,
  'processed' | 'deleted' | 'conflicts' | 'failed' | 'skipped'
>;
type DrainOutcome = 'done' | 'no-token' | 'auth-expired';

async function drainOnce(
  active: SyncEngineDeps,
  agg: Aggregate
): Promise<DrainOutcome> {
  const token = active.getToken();
  if (!token) return 'no-token'; // logged out → ops persist (Phase 0.4), drain later

  const base = active.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = active.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const now = Date.now();

  const ops = (await db.pendingOps
    .orderBy('createdAt')
    .toArray()) as StoredOp[];
  const passMap = new Map<string, string>();

  for (const op of ops) {
    if (!isDue(op, now, base, max)) continue;

    try {
      if (op.type === 'CUSTOMER_CREATE') {
        await processCustomerCreate(op, token, active, ops, passMap);
        agg.processed++;
        agg.deleted++;
      } else if (op.type === 'SALE_CREATE') {
        const outcome = await processSaleCreate(op, token, active, passMap);
        if (outcome === 'skipped') {
          agg.skipped++;
          continue;
        }
        agg.processed++;
        agg.deleted++;
      } else {
        // Op types not drained in this phase (STOCK_ADJUSTMENT, PRODUCT_CREATE_DRAFT)
        // are left untouched — never deleted without a backend confirm.
        agg.skipped++;
      }
    } catch (err) {
      const code = structuredCode(err);

      if (code === AUTH_EXPIRED) {
        // §24: the session lapsed. Revert to pending (recoverable via re-login),
        // surface the re-login need, and abort the pass — every remaining op would
        // fail auth too.
        await db.pendingOps.update(op.localId, {
          status: 'pending',
          updatedAt: Date.now(),
          lastError: AUTH_EXPIRED,
        });
        active.onAuthExpired?.();
        return 'auth-expired';
      }

      if (code && CONFLICT_CODES.has(code)) {
        // §15: non-retryable business conflict — mark, never delete. The owner
        // resolves it later; retrying would only reproduce the same conflict.
        await db.pendingOps.update(op.localId, {
          status: 'conflict',
          updatedAt: Date.now(),
          lastError: code,
        });
        agg.conflicts++;
        continue;
      }

      // Transient / network error — retry with capped exponential backoff.
      await db.pendingOps.update(op.localId, {
        status: 'failed',
        attempts: op.attempts + 1,
        updatedAt: Date.now(),
        lastError: errorMessage(err),
      });
      agg.failed++;
    }
  }

  return 'done';
}

/**
 * Drain the queue once, end to end. Single-flight: a call made while a drain is in
 * flight requests one extra pass (coalescing bursts of triggers) instead of
 * overlapping. Never rejects — trigger callers can `void runSync()` safely; every
 * expected error is handled per-op inside `drainOnce`, and an op is never deleted
 * without a backend confirmation.
 */
export async function runSync(): Promise<SyncRunResult> {
  const active = deps;
  if (!active) {
    return zeroResult(false, 'no-deps');
  }
  if (inFlight) {
    rerunRequested = true;
    return zeroResult(false, 'busy');
  }

  inFlight = true;
  const agg: Aggregate = {
    processed: 0,
    deleted: 0,
    conflicts: 0,
    failed: 0,
    skipped: 0,
  };
  let reason: SyncRunResult['reason'];
  try {
    do {
      rerunRequested = false;
      const outcome = await drainOnce(active, agg);
      if (outcome === 'no-token') {
        reason = 'no-token';
        break;
      }
      if (outcome === 'auth-expired') {
        reason = 'auth-expired';
        break;
      }
    } while (rerunRequested);
  } catch {
    // Infrastructure-level failure (e.g. IndexedDB unavailable). Swallow so the
    // fire-and-forget triggers never see a rejected promise; nothing was deleted.
  } finally {
    inFlight = false;
  }

  return { ran: true, ...agg, ...(reason ? { reason } : {}) };
}

function zeroResult(
  ran: boolean,
  reason: SyncRunResult['reason']
): SyncRunResult {
  return {
    ran,
    processed: 0,
    deleted: 0,
    conflicts: 0,
    failed: 0,
    skipped: 0,
    reason,
  };
}
