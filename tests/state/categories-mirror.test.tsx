// @vitest-environment jsdom
// Phase 2 — Categories: useCategories now reads through useMirroredQuery, so the
// `categories` master-data list is Dexie-backed exactly like products (Phase 1).
// The hook's signature is unchanged — it still returns CategoryWithCount[], with
// the per-category `count` carried inside the mirrored doc so it survives offline
// as a snapshot. These tests pin the three contract points: Convex-primary online
// (live result returned + mirrored into db.categories), Dexie fallback offline
// (served from the mirror, count intact), and `'skip'` (no session) ⇒ [].
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
  // Mirror rows carry the live product `count` — the CategoryWithCount shape that
  // every consumer expects, preserved offline as a snapshot.
  const CACHED = [
    { _id: 'cat_drinks', label: 'Bebidas', count: 7 },
    { _id: 'cat_food', label: 'Comida', count: 3 },
  ];
  const categories = {
    clear: vi.fn(async () => {}),
    bulkPut: vi.fn(async (_rows: unknown) => {}),
    toArray: vi.fn(async () => CACHED),
  };
  const transaction = vi.fn(
    async (_mode: unknown, _table: unknown, scope: () => unknown) => scope()
  );
  return { CACHED, categories, transaction };
});

vi.mock('@/state/db', () => ({
  db: { categories: store.categories, transaction: store.transaction },
}));

// useCategories pulls the token from the session; control it per test so the
// 'skip' (logged-out) branch is exercisable.
const session = vi.hoisted((): { token: string | null } => ({ token: 't' }));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ token: session.token }),
}));

import { useQuery } from 'convex/react';
import { useCategories } from '@/state/hooks';

const useQueryMock = vi.mocked(useQuery);

const LIVE = [
  { _id: 'cat_live_drinks', label: 'Bebidas', count: 12 },
  { _id: 'cat_live_cleaning', label: 'Limpieza', count: 4 },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  session.token = 't';
  store.categories.toArray.mockImplementation(async () => store.CACHED);
});

describe('useCategories (Phase 2 — Dexie-backed)', () => {
  test('Convex-primary: returns the live CategoryWithCount[] and mirrors it into db.categories (clear + bulkPut, count included)', async () => {
    useQueryMock.mockReturnValue(LIVE);

    const { result } = renderHook(() => useCategories());

    // Convex is the source of truth: the live list is returned verbatim.
    expect(result.current).toBe(LIVE);
    // Signature unchanged — the per-category count survives the round-trip.
    expect(result.current[0].count).toBe(12);

    // Background mirror: the full live list is written through to the table.
    await waitFor(() => {
      expect(store.transaction).toHaveBeenCalled();
      expect(store.categories.clear).toHaveBeenCalled();
      expect(store.categories.bulkPut).toHaveBeenCalledWith(LIVE);
    });
  });

  test('offline fallback: while the live result is undefined, serves the categories mirror (count intact)', async () => {
    useQueryMock.mockReturnValue(undefined); // offline / loading

    const { result } = renderHook(() => useCategories());

    // Category chips render offline from the mirror once useLiveQuery emits.
    await waitFor(() => {
      expect(result.current).toEqual(store.CACHED);
    });
    expect(result.current[0].count).toBe(7); // snapshot count preserved offline
    // Nothing is written back when there is no live result to mirror.
    expect(store.categories.bulkPut).not.toHaveBeenCalled();
  });

  test("'skip' (no session) yields no data: returns [] and never reads the mirror", async () => {
    session.token = null; // logged out → useCategories passes 'skip'
    useQueryMock.mockReturnValue(undefined); // useQuery returns undefined for 'skip'

    const { result } = renderHook(() => useCategories());

    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
    // A logged-out device must not read the local category mirror.
    expect(store.categories.toArray).not.toHaveBeenCalled();
  });
});
