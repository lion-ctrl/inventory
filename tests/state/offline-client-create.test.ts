// Phase 6.2 — offline CUSTOMER_CREATE (OFFLINE_FIRST_PLAN §6.2 / §6.2.1).
// createOfflineClient mints a local id, mirrors a `_local`-tagged client row into
// db.clients (so the offline client list can show + SELECT it), and enqueues a
// CUSTOMER_CREATE op carrying the local id + form payload for the sync engine to
// remap later. db and the enqueue helper are mocked at the module boundary.
import { afterEach, describe, expect, test, vi } from 'vitest';

const store = vi.hoisted(() => ({
  clients: { put: vi.fn(async (_row: unknown) => 'local:x') },
  enqueue: vi.fn(async (_type: unknown, _payload: unknown): Promise<number> => 1),
}));

vi.mock('@/state/db', () => ({ db: { clients: store.clients } }));
vi.mock('@/state/pendingOps', () => ({ enqueuePendingOp: store.enqueue }));

import { createOfflineClient } from '@/state/offlineClient';
import { isLocalId } from '@/state/localId';

const putRow = () => {
  const calls = store.clients.put.mock.calls;
  return calls[calls.length - 1][0] as any;
};
const enqueueCall = () => {
  const calls = store.enqueue.mock.calls;
  return calls[calls.length - 1] as [string, any];
};

const INPUT = {
  name: 'Juan Pérez',
  taxPrefix: 'V' as const,
  taxId: '9.999.999',
  kind: 'person' as const,
  phone: '04140000000',
  address: 'Caracas',
};

afterEach(() => vi.clearAllMocks());

describe('createOfflineClient', () => {
  test('mints a local id and mirrors a _local client row the cart can select', async () => {
    const id = await createOfflineClient(INPUT);

    // Returns the local placeholder id — what the Sale handler sets as the cart's
    // selectedClientId so the sale can proceed offline.
    expect(isLocalId(id)).toBe(true);

    // A `_local`-tagged row keyed by that id lands in the mirror, so the offline
    // client list includes it and `clients.find(c => c._id === id)` resolves.
    expect(store.clients.put).toHaveBeenCalledTimes(1);
    const row = putRow();
    expect(row._id).toBe(id);
    expect(row._local).toBe(true);
    expect(row.name).toBe('Juan Pérez');
    expect(row.taxPrefix).toBe('V');
    expect(row.taxId).toBe('9.999.999');
    expect(row.kind).toBe('person');
    expect(typeof row._creationTime).toBe('number');
  });

  test('enqueues a CUSTOMER_CREATE op carrying the local id + form payload', async () => {
    const id = await createOfflineClient(INPUT);

    expect(store.enqueue).toHaveBeenCalledTimes(1);
    const [type, payload] = enqueueCall();
    expect(type).toBe('CUSTOMER_CREATE');
    expect(payload.localId).toBe(id); // remap key for the sync engine (§6.2.1)
    expect(payload.name).toBe('Juan Pérez');
    expect(payload.taxPrefix).toBe('V');
    expect(payload.taxId).toBe('9.999.999');
    expect(payload.kind).toBe('person');
    expect(payload.phone).toBe('04140000000');
    expect(payload.address).toBe('Caracas');
  });

  test('omits empty-string contact fields, mirroring convex/clients.ts create', async () => {
    await createOfflineClient({ ...INPUT, email: '' });

    const row = putRow();
    expect(row).not.toHaveProperty('email');
    const [, payload] = enqueueCall();
    expect(payload).not.toHaveProperty('email');
  });
});
