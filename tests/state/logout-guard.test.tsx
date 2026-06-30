// @vitest-environment jsdom
// Phase 0.4 — the guarded logout (DECIDED POLICY). Logout must never destroy
// unconfirmed durable writes: when unsynced pendingOps exist, only the disposable
// mirror + cartDraft are cleared and the pending queue SURVIVES; when none exist,
// the whole local DB is wiped. IndexedDB does not exist under jsdom, so the Dexie
// store is mocked and we assert which teardown path the guard takes.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));
// SessionContext is the only db consumer here; isolate it from Dexie reactivity.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => undefined }));

const dbm = vi.hoisted(() => {
  const mirror = () => ({ clear: vi.fn(async () => {}) });
  return {
    count: vi.fn(async () => 0),
    products: mirror(),
    categories: mirror(),
    clients: mirror(),
    settings: mirror(),
    cartDraft: mirror(),
    pendingOpsClear: vi.fn(async () => {}),
    transaction: vi.fn(async (_mode: unknown, ...rest: unknown[]) => {
      const scope = rest[rest.length - 1] as () => unknown;
      return scope();
    }),
    deleteDb: vi.fn(async () => {}),
  };
});

vi.mock('@/state/db', () => ({
  db: {
    products: dbm.products,
    categories: dbm.categories,
    clients: dbm.clients,
    settings: dbm.settings,
    cartDraft: dbm.cartDraft,
    pendingOps: {
      clear: dbm.pendingOpsClear,
      where: () => ({ anyOf: () => ({ count: dbm.count }) }),
    },
    transaction: dbm.transaction,
    delete: dbm.deleteDb,
  },
}));

import { useMutation, useQuery } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { SessionProvider, useSession } from '@/state/SessionContext';

const useQueryMock = vi.mocked(useQuery);
const useMutationMock = vi.mocked(useMutation);

const owner = {
  _id: 'e_owner',
  _creationTime: 0,
  name: 'Carlos Méndez',
  email: 'carlos@mitienda.com',
  phone: '0',
  role: 'owner',
  permissions: 'all',
  active: true,
  createdAt: 0,
};
const OWNER_TOKEN = 'tok_owner';
const futureExpiry = () => Date.now() + 30 * 60 * 1000;

const wrapper = ({ children }: { children: ReactNode }) => (
  <SessionProvider>{children}</SessionProvider>
);

beforeEach(() => {
  localStorage.clear();
  // Boot with a valid persisted session resolving to the owner (so the
  // stale-token effect does NOT fire — logout is triggered explicitly).
  localStorage.setItem('pos.sessionToken', OWNER_TOKEN);
  localStorage.setItem('pos.sessionExpiresAt', String(futureExpiry()));
  dbm.count.mockResolvedValue(0);
  useQueryMock.mockImplementation(((query: any, args: any) => {
    if (args === 'skip') return undefined;
    return getFunctionName(query) === 'auth:me' ? owner : undefined;
  }) as any);
  useMutationMock.mockImplementation(((_ref: any) => vi.fn(async () => null)) as any);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('guarded logout (Phase 0.4)', () => {
  test('with ZERO unsynced ops → the entire local DB is deleted', async () => {
    dbm.count.mockResolvedValue(0);
    const { result } = renderHook(() => useSession(), { wrapper });

    act(() => result.current.logout());

    // Instant UI logout: the session credential is dropped synchronously.
    expect(localStorage.getItem('pos.sessionToken')).toBeNull();
    expect(result.current.token).toBeNull();

    await waitFor(() => expect(dbm.deleteDb).toHaveBeenCalledTimes(1));
    // A full wipe takes the db.delete() path — not the per-table clear path.
    expect(dbm.products.clear).not.toHaveBeenCalled();
    expect(dbm.transaction).not.toHaveBeenCalled();
  });

  test('with unsynced ops → mirror + cartDraft cleared, pendingOps SURVIVE (no db.delete)', async () => {
    dbm.count.mockResolvedValue(1); // a hand-inserted pending op
    const { result } = renderHook(() => useSession(), { wrapper });

    act(() => result.current.logout());

    expect(localStorage.getItem('pos.sessionToken')).toBeNull();

    await waitFor(() => {
      expect(dbm.products.clear).toHaveBeenCalledTimes(1);
    });
    // The whole disposable mirror + cartDraft are cleared inside one transaction.
    expect(dbm.categories.clear).toHaveBeenCalledTimes(1);
    expect(dbm.clients.clear).toHaveBeenCalledTimes(1);
    expect(dbm.settings.clear).toHaveBeenCalledTimes(1);
    expect(dbm.cartDraft.clear).toHaveBeenCalledTimes(1);
    expect(dbm.transaction).toHaveBeenCalledTimes(1);
    // The durable queue is NEVER destroyed by logout.
    expect(dbm.pendingOpsClear).not.toHaveBeenCalled();
    expect(dbm.deleteDb).not.toHaveBeenCalled();
  });
});
