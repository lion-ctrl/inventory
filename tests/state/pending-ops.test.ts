// Phase 6.2 — the durable pending-ops queue (FEATURES §6) enqueue helper, plus the
// local-id scheme for entities created offline. db is mocked at the module boundary
// (no IndexedDB under the test runtime); we assert the row shape appended to
// db.pendingOps and that the local-id helpers round-trip. Runs under the default
// edge runtime (Web Crypto — crypto.randomUUID — is available there).
import { afterEach, describe, expect, test, vi } from 'vitest';

const store = vi.hoisted(() => ({
  pendingOps: {
    add: vi.fn(async (_op: unknown): Promise<number> => 1),
  },
  meta: {
    get: vi.fn(
      async (_key: string): Promise<{ key: string; value: string } | undefined> => ({
        key: 'deviceId',
        value: 'device-seed',
      })
    ),
    put: vi.fn(async (_row: unknown) => 'deviceId'),
  },
}));

vi.mock('@/state/db', () => ({
  db: { pendingOps: store.pendingOps, meta: store.meta },
}));

import { enqueuePendingOp } from '@/state/pendingOps';
import { isLocalId, mintLocalId, LOCAL_ID_PREFIX } from '@/state/localId';

const lastOp = () => {
  const calls = store.pendingOps.add.mock.calls;
  return calls[calls.length - 1][0] as any;
};

afterEach(() => {
  vi.clearAllMocks();
  store.meta.get.mockImplementation(async () => ({
    key: 'deviceId',
    value: 'device-seed',
  }));
});

describe('enqueuePendingOp', () => {
  test('appends a pending op with the Phase 0.2 shape and returns its localId', async () => {
    const localId = await enqueuePendingOp('CUSTOMER_CREATE', { hello: 'world' });

    expect(localId).toBe(1);
    expect(store.pendingOps.add).toHaveBeenCalledTimes(1);

    const op = lastOp();
    expect(op.type).toBe('CUSTOMER_CREATE');
    expect(op.payload).toEqual({ hello: 'world' });
    expect(op.status).toBe('pending');
    expect(op.attempts).toBe(0);
    expect(op.deviceId).toBe('device-seed'); // read from the meta seed (FEATURES §19)
    expect(typeof op.idempotencyKey).toBe('string');
    expect(op.idempotencyKey.length).toBeGreaterThan(0);
    expect(typeof op.createdAt).toBe('number');
    expect(op.updatedAt).toBe(op.createdAt);
    // localId is auto-assigned by Dexie's `++localId`, never set at enqueue.
    expect(op).not.toHaveProperty('localId');
  });

  test('generates a fresh idempotencyKey per op (Risk 3 — persisted for safe replays)', async () => {
    await enqueuePendingOp('CUSTOMER_CREATE', {});
    await enqueuePendingOp('SALE_CREATE', {});

    const k1 = store.pendingOps.add.mock.calls[0][0] as any;
    const k2 = store.pendingOps.add.mock.calls[1][0] as any;
    expect(k1.idempotencyKey).not.toBe(k2.idempotencyKey);
  });

  test('self-heals a missing deviceId seed by minting and persisting one', async () => {
    store.meta.get.mockResolvedValueOnce(undefined);

    await enqueuePendingOp('CUSTOMER_CREATE', {});

    expect(store.meta.put).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'deviceId' })
    );
    const op = lastOp();
    expect(typeof op.deviceId).toBe('string');
    expect(op.deviceId.length).toBeGreaterThan(0);
  });
});

describe('local-id scheme', () => {
  test('mintLocalId produces a local:<uuid> id recognised by isLocalId', () => {
    const id = mintLocalId();
    expect(id.startsWith(LOCAL_ID_PREFIX)).toBe(true);
    expect(isLocalId(id)).toBe(true);
  });

  test('isLocalId is false for real Convex ids and nullish input', () => {
    expect(isLocalId('k17realconvexid00000')).toBe(false);
    expect(isLocalId('')).toBe(false);
    expect(isLocalId(null)).toBe(false);
    expect(isLocalId(undefined)).toBe(false);
  });
});
