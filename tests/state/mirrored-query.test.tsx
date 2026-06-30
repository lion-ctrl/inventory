// @vitest-environment jsdom
// Phase 0.3 + Phase 1 — useMirroredQuery: Convex is primary and live; every
// successful server result mirrors into the Dexie table in the background; the
// mirror is served ONLY while the live result is undefined (offline); and
// `'skip'` (no session) yields NO data. IndexedDB does not exist under jsdom, so
// the Dexie store is mocked in-memory. dexie-react-hooks' useLiveQuery runs the
// real hook against that mock — its querier is a plain callback (per the Dexie
// docs), so it emits the mocked table contents without a live IndexedDB.
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
  const CACHED = [
    { _id: 'p_cached', barcode: '999', name: 'Mirrored cola', categoryId: 'c1' },
  ];
  const products = {
    clear: vi.fn(async () => {}),
    bulkPut: vi.fn(async (_rows: unknown) => {}),
    toArray: vi.fn(async () => CACHED),
  };
  const transaction = vi.fn(
    async (_mode: unknown, _table: unknown, scope: () => unknown) => scope()
  );
  return { CACHED, products, transaction };
});

vi.mock('@/state/db', () => ({
  db: { products: store.products, transaction: store.transaction },
}));

import { useQuery } from 'convex/react';
import { useMirroredQuery } from '@/state/useMirroredQuery';

const useQueryMock = vi.mocked(useQuery);
const PRODUCTS_REF = {} as never; // useQuery is mocked → the query ref is ignored

const LIVE = [
  { _id: 'p_live', barcode: '111', name: 'Live cola', categoryId: 'c1' },
  { _id: 'p_live2', barcode: '222', name: 'Live agua', categoryId: 'c1' },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  store.products.toArray.mockImplementation(async () => store.CACHED);
});

describe('useMirroredQuery', () => {
  test('Convex-primary: returns the live result and mirrors it into Dexie (clear + bulkPut)', async () => {
    useQueryMock.mockReturnValue(LIVE);

    const { result } = renderHook(() =>
      useMirroredQuery(PRODUCTS_REF, { token: 't' }, 'products')
    );

    // Convex is the source of truth: the live array is returned verbatim.
    expect(result.current).toBe(LIVE);

    // Background mirror: the full live list is written through to the table.
    await waitFor(() => {
      expect(store.transaction).toHaveBeenCalled();
      expect(store.products.clear).toHaveBeenCalled();
      expect(store.products.bulkPut).toHaveBeenCalledWith(LIVE);
    });
  });

  test('offline fallback: while the live result is undefined, serves the Dexie mirror', async () => {
    useQueryMock.mockReturnValue(undefined); // offline / loading

    const { result } = renderHook(() =>
      useMirroredQuery(PRODUCTS_REF, { token: 't' }, 'products')
    );

    // The cached catalog renders from the mirror once useLiveQuery emits.
    await waitFor(() => {
      expect(result.current).toEqual(store.CACHED);
    });
    // Nothing is written back when there is no live result to mirror.
    expect(store.products.bulkPut).not.toHaveBeenCalled();
  });

  test("'skip' (no session) yields no data: returns [] and never reads the mirror", async () => {
    useQueryMock.mockReturnValue(undefined); // useQuery returns undefined for 'skip'

    const { result } = renderHook(() =>
      useMirroredQuery(PRODUCTS_REF, 'skip', 'products')
    );

    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
    // A logged-out device must not read the local catalog.
    expect(store.products.toArray).not.toHaveBeenCalled();
  });
});
