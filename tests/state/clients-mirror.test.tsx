// @vitest-environment jsdom
// Phase 3 — Clients: useClients now reads through useMirroredQuery, so the
// `clients` master-data list is Dexie-backed exactly like products (Phase 1) and
// categories (Phase 2). The hook's signature is unchanged — it still returns
// Client[], with each client's tax identity (taxPrefix/taxId) carried inside the
// mirrored doc so the Sale picker's tax-id match keeps working offline. These
// tests pin the three contract points: Convex-primary online (live result
// returned + mirrored into db.clients), Dexie fallback offline (served from the
// mirror, tax identity intact), and `'skip'` (no session) ⇒ [].
//
// IndexedDB does not exist under jsdom, so the Dexie store is mocked in-memory and
// dexie-react-hooks' useLiveQuery is stubbed to resolve the querier once (same
// approach as tests/state/mirrored-query.test.tsx). useSession is mocked so the
// token — and therefore the 'skip' (logged-out) branch — is controllable per test.
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('convex/react', () => ({ useQuery: vi.fn() }));

// Dexie's liveQuery needs a real IndexedDB-backed observable, absent under jsdom.
// Stub useLiveQuery to run the hook's querier once and resolve its result through
// React state — mirroring the real "undefined until first emission" contract.
vi.mock('dexie-react-hooks', async () => {
  const React = await import('react');
  return {
    useLiveQuery: (querier: () => unknown) => {
      const [value, setValue] = React.useState<unknown>(undefined);
      React.useEffect(() => {
        let active = true;
        void Promise.resolve(querier()).then((r) => {
          if (active) setValue(r);
        });
        return () => {
          active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return value;
    },
  };
});

const store = vi.hoisted(() => {
  // Mirror rows carry the tax identity (taxPrefix/taxId) — the Client shape the
  // Sale client gate matches against, preserved offline as a snapshot.
  const CACHED = [
    {
      _id: 'c_maria',
      name: 'María González',
      taxPrefix: 'V',
      taxId: '5.123.456',
      kind: 'person',
      createdAt: 10,
    },
    {
      _id: 'c_acme',
      name: 'Acme C.A.',
      taxPrefix: 'J',
      taxId: '40123456-7',
      kind: 'business',
      createdAt: 20,
    },
  ];
  const clients = {
    clear: vi.fn(async () => {}),
    bulkPut: vi.fn(async (_rows: unknown) => {}),
    toArray: vi.fn(async () => CACHED),
  };
  const transaction = vi.fn(
    async (_mode: unknown, _table: unknown, scope: () => unknown) => scope()
  );
  return { CACHED, clients, transaction };
});

vi.mock('@/state/db', () => ({
  db: { clients: store.clients, transaction: store.transaction },
}));

// useClients pulls the token from the session; control it per test so the
// 'skip' (logged-out) branch is exercisable.
const session = vi.hoisted((): { token: string | null } => ({ token: 't' }));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ token: session.token }),
}));

import { useQuery } from 'convex/react';
import { useClients } from '@/state/hooks';

const useQueryMock = vi.mocked(useQuery);

const LIVE = [
  {
    _id: 'c_live_pedro',
    name: 'Pedro Pérez',
    taxPrefix: 'V',
    taxId: '9.999.999',
    kind: 'person',
    createdAt: 30,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  session.token = 't';
  store.clients.toArray.mockImplementation(async () => store.CACHED);
});

describe('useClients (Phase 3 — Dexie-backed)', () => {
  test('Convex-primary: returns the live Client[] and mirrors it into db.clients (clear + bulkPut)', async () => {
    useQueryMock.mockReturnValue(LIVE);

    const { result } = renderHook(() => useClients());

    // Convex is the source of truth: the live list is returned verbatim.
    expect(result.current).toBe(LIVE);

    // Background mirror: the full live list is written through to the table.
    await waitFor(() => {
      expect(store.transaction).toHaveBeenCalled();
      expect(store.clients.clear).toHaveBeenCalled();
      expect(store.clients.bulkPut).toHaveBeenCalledWith(LIVE);
    });
  });

  test('offline fallback: while the live result is undefined, serves the clients mirror (tax identity intact)', async () => {
    useQueryMock.mockReturnValue(undefined); // offline / loading

    const { result } = renderHook(() => useClients());

    // The client list renders offline from the mirror once useLiveQuery emits.
    await waitFor(() => {
      expect(result.current).toEqual(store.CACHED);
    });
    // taxPrefix/taxId survive offline → the Sale picker's tax-id match still works.
    expect(result.current[0].taxPrefix).toBe('V');
    expect(result.current[0].taxId).toBe('5.123.456');
    // Nothing is written back when there is no live result to mirror.
    expect(store.clients.bulkPut).not.toHaveBeenCalled();
  });

  test("'skip' (no session) yields no data: returns [] and never reads the mirror", async () => {
    session.token = null; // logged out → useClients passes 'skip'
    useQueryMock.mockReturnValue(undefined); // useQuery returns undefined for 'skip'

    const { result } = renderHook(() => useClients());

    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
    // A logged-out device must not read the local client mirror.
    expect(store.clients.toArray).not.toHaveBeenCalled();
  });

  // Phase 6.2 — an offline-created client (minted with a `local:` id and tagged
  // `_local`) lives in the same `clients` mirror. The background refresh does
  // clear() + bulkPut(live), and the reconnected server result does NOT yet include
  // the draft — so without preservation it would be WIPED. useMirroredQuery reads
  // the `_local` rows first and re-puts them after the live refresh.
  test('a queued local client survives the mirror refresh (clear + bulkPut does not wipe it)', async () => {
    const localClient = {
      _id: 'local:abc',
      name: 'Juan Pérez (offline)',
      taxPrefix: 'V',
      taxId: '9.999.999',
      kind: 'person',
      createdAt: 99,
      _local: true,
    };
    // The mirror state read just before the refresh holds the queued draft.
    store.clients.toArray.mockImplementation(async () => [localClient]);
    useQueryMock.mockReturnValue(LIVE); // server reconnects; result excludes the draft

    renderHook(() => useClients());

    await waitFor(() => {
      // The fresh live rows are written…
      expect(store.clients.bulkPut).toHaveBeenCalledWith(LIVE);
      // …and the `_local` draft is re-put, so it is NOT wiped by the refresh.
      expect(store.clients.bulkPut).toHaveBeenCalledWith([localClient]);
    });
  });
});
