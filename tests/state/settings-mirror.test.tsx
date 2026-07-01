// @vitest-environment jsdom
// Phase 4 — Settings: useSettingsDoc now reads through the Dexie SINGLETON mirror,
// the same Convex-primary / Dexie-fallback pattern as the list hooks (Phases 1-3)
// adapted for the settings singleton (one row keyed by its Convex _id). The hook's
// signature is unchanged (Settings | null | undefined), and useBsRate — which just
// reads useSettingsDoc — becomes Dexie-backed for free everywhere. These tests pin
// the three contract points: Convex-primary online (the live doc is returned +
// mirrored into db.settings via clear + put), Dexie fallback offline (served from
// the singleton row so Scan/Sale/Payment math keeps working), and `'skip'` (no
// session) ⇒ null (no server call, no local read).
//
// IndexedDB does not exist under jsdom, so the Dexie store is mocked in-memory and
// dexie-react-hooks' useLiveQuery is stubbed to resolve the querier once (same
// approach as tests/state/clients-mirror.test.tsx). useSession is mocked so the
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
  // The singleton settings row carries the whole store config — the fields Scan /
  // Sale / Payment read offline (bsRate, ivaPct, scannerMode, taxName, currency…).
  const CACHED = {
    _id: 's_singleton',
    storeName: 'Bodega Central',
    bsRate: 36.5,
    ivaPct: 16,
    taxName: 'IVA',
    currency: 'USD',
    scannerMode: 'physical',
  };
  const first = vi.fn(async () => CACHED);
  const settings = {
    clear: vi.fn(async () => {}),
    put: vi.fn(async (_row: unknown) => {}),
    // Singleton read: toCollection().first() returns the one row.
    toCollection: vi.fn(() => ({ first })),
  };
  const transaction = vi.fn(
    async (_mode: unknown, _table: unknown, scope: () => unknown) => scope()
  );
  return { CACHED, first, settings, transaction };
});

vi.mock('@/state/db', () => ({
  db: { settings: store.settings, transaction: store.transaction },
}));

// useSettingsDoc pulls the token from the session; control it per test so the
// 'skip' (logged-out) branch is exercisable.
const session = vi.hoisted((): { token: string | null } => ({ token: 't' }));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ token: session.token }),
}));

import { useQuery } from 'convex/react';
import { useSettingsDoc, useBsRate } from '@/state/hooks';

const useQueryMock = vi.mocked(useQuery);

const LIVE = {
  _id: 's_singleton',
  storeName: 'Bodega Central',
  bsRate: 40,
  ivaPct: 12,
  taxName: 'IVA',
  currency: 'USD',
  scannerMode: 'camera',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  session.token = 't';
  store.first.mockImplementation(async () => store.CACHED);
});

describe('useSettingsDoc (Phase 4 — Dexie-backed singleton)', () => {
  test('Convex-primary: returns the live settings doc and mirrors it into db.settings (clear + put)', async () => {
    useQueryMock.mockReturnValue(LIVE);

    const { result } = renderHook(() => useSettingsDoc());

    // Convex is the source of truth: the live singleton is returned verbatim.
    expect(result.current).toBe(LIVE);

    // Background mirror: the row is written through to the singleton table.
    await waitFor(() => {
      expect(store.transaction).toHaveBeenCalled();
      expect(store.settings.clear).toHaveBeenCalled();
      expect(store.settings.put).toHaveBeenCalledWith(LIVE);
    });
  });

  test('offline fallback: while the live result is undefined, serves the settings mirror', async () => {
    useQueryMock.mockReturnValue(undefined); // offline / loading

    const { result } = renderHook(() => useSettingsDoc());

    // Config renders offline from the singleton row once useLiveQuery emits.
    await waitFor(() => {
      expect(result.current).toEqual(store.CACHED);
    });
    // bsRate/ivaPct survive offline → Scan/Sale/Payment math still works.
    expect(result.current?.bsRate).toBe(36.5);
    expect(result.current?.ivaPct).toBe(16);
    // Nothing is written back when there is no live result to mirror.
    expect(store.settings.put).not.toHaveBeenCalled();
  });

  test("'skip' (no session) yields no data: returns null and never reads the mirror", async () => {
    session.token = null; // logged out → useSettingsDoc passes 'skip'
    useQueryMock.mockReturnValue(undefined); // useQuery returns undefined for 'skip'

    const { result } = renderHook(() => useSettingsDoc());

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    // A logged-out device must not read the local settings mirror.
    expect(store.settings.toCollection).not.toHaveBeenCalled();
  });
});

describe('useBsRate (Phase 4 — derives from the Dexie-backed settings)', () => {
  test('online: returns the live bsRate', () => {
    useQueryMock.mockReturnValue(LIVE);
    const { result } = renderHook(() => useBsRate());
    expect(result.current).toBe(40);
  });

  test('offline: returns the cached bsRate from the mirror', async () => {
    useQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() => useBsRate());
    await waitFor(() => {
      expect(result.current).toBe(36.5);
    });
  });

  test("'skip' (no session): falls back to 0", async () => {
    session.token = null;
    useQueryMock.mockReturnValue(undefined);
    const { result } = renderHook(() => useBsRate());
    // null settings ⇒ bsRate falls back to 0.
    await waitFor(() => {
      expect(result.current).toBe(0);
    });
  });
});
