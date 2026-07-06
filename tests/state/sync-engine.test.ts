// Phase 6.4 — the client-side sync engine (OFFLINE_FIRST_PLAN §6.4 + §6.2.1).
//
// This is the MOST delicate piece of the offline-first effort — where offline
// sales are drained to the server WITHOUT duplicating or losing them. These tests
// pin the contract that keeps it safe:
//   • CUSTOMER_CREATE → real client created, local→real stored in `meta`, the
//     dependent SALE_CREATE's clientId rewritten, the `_local` mirror row swapped,
//     and BOTH ops deleted only after the backend confirmed.
//   • a §15 conflict marks the op `conflict` (NEVER deleted — the owner resolves it).
//   • single-flight: a second run while one is in flight never overlaps the loop.
//   • an op SURVIVES a failed attempt and is deleted only after a confirmed sync.
//   • the dependency backstop skips a SALE_CREATE whose `local:` client is unresolved.
//   • AUTH_EXPIRED reverts the op + surfaces re-login (recoverable), never deletes.
//
// IndexedDB does not exist under the test runtime (fake-indexeddb is not installed),
// so `@/state/db` is mocked with a faithful in-memory double — the same module-
// boundary approach as the other state tests. The engine's Convex mutation runners
// and token source are INJECTED (configureSyncEngine), so no Convex/React wiring is
// needed here. Runs under the default edge runtime (Web Crypto available).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConvexError } from 'convex/values';

interface Op {
  localId: number;
  idempotencyKey: string;
  type: string;
  payload: any;
  status: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  deviceId: string;
  lastError?: string;
}

const store = vi.hoisted(() => {
  let ops: Op[] = [];
  let counter = 0;
  const meta = new Map<string, { key: string; value: unknown }>();
  const clients = new Map<string, any>();

  const pendingOps = {
    orderBy: (index: string) => ({
      toArray: async () =>
        [...ops].sort((a, b) => (a as any)[index] - (b as any)[index]),
    }),
    update: async (key: number, changes: Record<string, unknown>) => {
      const row = ops.find((o) => o.localId === key);
      if (!row) return 0;
      Object.assign(row, changes);
      return 1;
    },
    delete: async (key: number) => {
      ops = ops.filter((o) => o.localId !== key);
    },
    add: async (op: Omit<Op, 'localId'>) => {
      const localId = ++counter;
      ops.push({ ...op, localId });
      return localId;
    },
  };
  const metaTable = {
    get: async (key: string) => meta.get(key),
    put: async (row: { key: string; value: unknown }) => {
      meta.set(row.key, row);
      return row.key;
    },
  };
  const clientsTable = {
    put: async (row: any) => {
      clients.set(row._id, row);
    },
    delete: async (key: string) => {
      clients.delete(key);
    },
  };
  const transaction = async (_mode: unknown, ...rest: unknown[]) => {
    const scope = rest[rest.length - 1] as () => unknown;
    return scope();
  };

  return {
    reset: () => {
      ops = [];
      counter = 0;
      meta.clear();
      clients.clear();
    },
    seed: (rows: Array<Partial<Op> & { type: string }>) => {
      for (const r of rows) {
        const localId = ++counter;
        ops.push({
          localId,
          idempotencyKey: r.idempotencyKey ?? `idem-${localId}`,
          type: r.type,
          payload: r.payload ?? {},
          status: r.status ?? 'pending',
          attempts: r.attempts ?? 0,
          createdAt: r.createdAt ?? localId,
          updatedAt: r.updatedAt ?? localId,
          deviceId: r.deviceId ?? 'dev-1',
          ...(r.lastError ? { lastError: r.lastError } : {}),
        });
      }
    },
    ops: () => ops,
    meta: () => meta,
    clients: () => clients,
    pendingOps,
    metaTable,
    clientsTable,
    transaction,
  };
});

vi.mock('@/state/db', () => ({
  db: {
    pendingOps: store.pendingOps,
    meta: store.metaTable,
    clients: store.clientsTable,
    transaction: store.transaction,
  },
}));

import {
  configureSyncEngine,
  runSync,
  __resetSyncEngineForTests,
} from '@/state/sync';

// A real Convex doc shape for `clients.create`'s return (only `_id` is load-bearing).
function realClientDoc(id: string) {
  return {
    _id: id,
    _creationTime: 1,
    name: 'Juan Pérez',
    taxPrefix: 'V',
    taxId: '9.999.999',
    kind: 'person',
    createdAt: 1,
  };
}

// Loosely-typed overrides: the injected runners are fakes, so `any` keeps the test
// readable — the engine's real branded types are still exercised by tsc at the
// production call sites (useSyncEngine).
interface Overrides {
  createClient?: any;
  syncSale?: any;
  getToken?: () => string | null;
  onAuthExpired?: () => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

function configure(over: Overrides = {}): { createClient: any; syncSale: any } {
  const createClient =
    over.createClient ??
    vi.fn((_args: any) => Promise.resolve(realClientDoc('k_real')));
  const syncSale =
    over.syncSale ?? vi.fn((_args: any) => Promise.resolve({ _id: 'sale_1' }));
  configureSyncEngine({
    createClient,
    syncSale,
    getToken: over.getToken ?? (() => 't'),
    onAuthExpired: over.onAuthExpired,
    baseDelayMs: over.baseDelayMs ?? 0,
    maxDelayMs: over.maxDelayMs ?? 0,
  });
  return { createClient, syncSale };
}

const SALE_PAYLOAD = (clientId: string) => ({
  clientId,
  items: [{ productId: 'p1', qty: 1 }],
  method: 'cash',
  splits: [{ method: 'cash', amount: 1.5 }],
  ivaPct: 13, // captured at sale time (§6.5) — the engine forwards it verbatim
  exchangeRate: 36,
  soldAt: 123,
});

beforeEach(() => {
  store.reset();
});
afterEach(() => {
  __resetSyncEngineForTests();
  vi.clearAllMocks();
});

describe('sync engine — CUSTOMER_CREATE end-to-end (§6.2.1)', () => {
  test('creates the client, remaps local→real in meta + the dependent op, swaps the mirror row, and deletes both ops', async () => {
    // A new client + its sale, both created offline. CUSTOMER_CREATE first (smaller
    // createdAt) so it drains before the SALE_CREATE that references its local id.
    store.seed([
      {
        type: 'CUSTOMER_CREATE',
        createdAt: 1,
        payload: {
          localId: 'local:abc',
          name: 'Juan Pérez',
          taxPrefix: 'V',
          taxId: '9.999.999',
          kind: 'person',
        },
      },
      {
        type: 'SALE_CREATE',
        createdAt: 2,
        idempotencyKey: 'idem-sale',
        deviceId: 'dev-1',
        payload: SALE_PAYLOAD('local:abc'),
      },
    ]);
    // The offline `_local` client row the cart selected (createOfflineClient wrote it).
    store.clients().set('local:abc', {
      _id: 'local:abc',
      _local: true,
      name: 'Juan Pérez',
    });

    const createClient = vi.fn((_args: any) =>
      Promise.resolve(realClientDoc('k_real'))
    );
    const syncSale = vi.fn((_args: any) => Promise.resolve({ _id: 'sale_1' }));
    configure({ createClient, syncSale });

    await runSync();

    // clients.create was called with the op payload (token added, local id stripped).
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith({
      token: 't',
      name: 'Juan Pérez',
      taxPrefix: 'V',
      taxId: '9.999.999',
      kind: 'person',
    });

    // local:abc → k_real is stored in the meta id-map.
    expect(store.meta().get('idmap:local:abc')?.value).toBe('k_real');

    // The dependent SALE_CREATE was sent to syncOffline with the REAL client id.
    expect(syncSale).toHaveBeenCalledTimes(1);
    expect(syncSale.mock.calls[0][0]).toMatchObject({
      clientId: 'k_real',
      idempotencyKey: 'idem-sale',
      deviceId: 'dev-1',
      ivaPct: 13, // the captured rate/IVA rides through to syncOffline
      exchangeRate: 36,
      soldAt: 123,
    });

    // The `_local` mirror row was swapped for the real client doc (UI shows the real one).
    expect(store.clients().has('local:abc')).toBe(false);
    expect(store.clients().get('k_real')?._id).toBe('k_real');

    // Deletion-after-confirm: BOTH ops are gone only after their backend confirmations.
    expect(store.ops()).toHaveLength(0);
  });
});

describe('sync engine — conflict handling (§15)', () => {
  test('a structured ConvexError({ code }) marks the op `conflict` and NEVER deletes it', async () => {
    store.seed([
      {
        type: 'SALE_CREATE',
        createdAt: 1,
        payload: SALE_PAYLOAD('k_existing'),
      },
    ]);
    const syncSale = vi.fn(async () => {
      throw new ConvexError({ code: 'STOCK_INSUFFICIENT', productId: 'p1' });
    });
    configure({ syncSale });

    await runSync();

    expect(syncSale).toHaveBeenCalledTimes(1);
    const op = store.ops()[0];
    expect(op).toBeDefined(); // NOT deleted — the owner resolves it later
    expect(op.status).toBe('conflict');
    expect(op.lastError).toBe('STOCK_INSUFFICIENT');
  });
});

describe('sync engine — single-flight lock', () => {
  test('a run started while another is in flight never overlaps the loop', async () => {
    store.seed([
      {
        type: 'CUSTOMER_CREATE',
        createdAt: 1,
        payload: {
          localId: 'local:x',
          name: 'Ana',
          taxPrefix: 'V',
          taxId: '1',
          kind: 'person',
        },
      },
    ]);

    // Hold the create open so the first drain is provably in flight.
    let resolveCreate!: (v: unknown) => void;
    const createClient = vi.fn(
      () => new Promise((res) => (resolveCreate = res))
    );
    configure({ createClient });

    const first = runSync();
    // Wait until the first loop has actually reached (and is blocked on) the create.
    await vi.waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));

    // A second run while the first is in flight must bail out — not start a 2nd loop.
    const second = await runSync();
    expect(second.reason).toBe('busy');
    expect(createClient).toHaveBeenCalledTimes(1);

    // Let the first finish; its coalesced rerun finds an empty queue → no re-create.
    resolveCreate(realClientDoc('k_real'));
    await first;
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(store.ops()).toHaveLength(0);
  });
});

describe('sync engine — deletion-after-confirm', () => {
  test('a failed attempt keeps the op (failed, attempts++); a later confirm deletes it', async () => {
    store.seed([
      {
        type: 'SALE_CREATE',
        createdAt: 1,
        payload: SALE_PAYLOAD('k_real'),
      },
    ]);
    const syncSale = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down')) // transient
      .mockResolvedValueOnce({ _id: 'sale_1' }); // confirmed
    configure({ syncSale });

    await runSync(); // attempt 1 fails
    expect(store.ops()).toHaveLength(1); // survives — never deleted without confirm
    expect(store.ops()[0].status).toBe('failed');
    expect(store.ops()[0].attempts).toBe(1);

    await runSync(); // attempt 2 confirmed (baseDelayMs 0 → immediately due)
    expect(syncSale).toHaveBeenCalledTimes(2);
    expect(store.ops()).toHaveLength(0); // deleted ONLY after the backend confirmed
  });
});

describe('sync engine — dependency backstop (§6.2.1)', () => {
  test('a SALE_CREATE with an UNRESOLVED local client is skipped this pass (not sent, not failed)', async () => {
    store.seed([
      {
        type: 'SALE_CREATE',
        createdAt: 1,
        payload: SALE_PAYLOAD('local:unmapped'),
      },
    ]);
    const syncSale = vi.fn(async () => ({ _id: 'sale_1' }));
    configure({ syncSale });

    await runSync();

    expect(syncSale).not.toHaveBeenCalled(); // never sent with a local id
    const op = store.ops()[0];
    expect(op).toBeDefined();
    expect(op.status).toBe('pending'); // untouched — retried after the client resolves
  });
});

describe('sync engine — AUTH_EXPIRED (§24)', () => {
  test('reverts the op to pending, surfaces re-login, and never deletes it', async () => {
    store.seed([
      {
        type: 'SALE_CREATE',
        createdAt: 1,
        payload: SALE_PAYLOAD('k_real'),
      },
    ]);
    const onAuthExpired = vi.fn();
    const syncSale = vi.fn(async () => {
      throw new ConvexError({ code: 'AUTH_EXPIRED' });
    });
    configure({ syncSale, onAuthExpired });

    await runSync();

    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(store.ops()).toHaveLength(1); // survives — recoverable via re-login
    expect(store.ops()[0].status).toBe('pending'); // retried once re-authenticated
  });
});

describe('sync engine — logged out', () => {
  test('no token → no drain; ops persist untouched (Phase 0.4)', async () => {
    store.seed([{ type: 'SALE_CREATE', createdAt: 1, payload: SALE_PAYLOAD('k_real') }]);
    const syncSale = vi.fn(async () => ({ _id: 'sale_1' }));
    configure({ syncSale, getToken: () => null });

    const res = await runSync();

    expect(res.reason).toBe('no-token');
    expect(syncSale).not.toHaveBeenCalled();
    expect(store.ops()).toHaveLength(1);
  });
});
