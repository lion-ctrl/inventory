// @vitest-environment jsdom
// Phase 6.1 — persistent cart. The in-progress sale (cart + selected client +
// payment splits + next split id) is written through to the durable Dexie
// `cartDraft` singleton on every change and hydrated once on mount, so a reload
// restores it. `hydratedRef` guards the write-through so the initial empty state
// never clobbers a saved draft. The two reset points clear the draft: discardSale
// (CartContext) and the post-checkout reset (AppShell.tsx:249-253), so a finished
// or discarded sale never comes back.
//
// IndexedDB does not exist under jsdom (fake-indexeddb is not installed), so the
// Dexie store is mocked at the module boundary — the same approach as
// mirrored-query / logout-guard / contexts tests. The single `cartDraft` row is
// held in module scope so it SURVIVES a provider unmount/remount, which is what
// makes the "reload" real. useSession is mocked to a fixed token (CartProvider
// only reads `token`); convex/react and dexie-react-hooks are stubbed.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NEW_SPLIT_ROW } from '@/types';
import type { Client, Product } from '@/types';

vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));
// Dexie's liveQuery needs a real IndexedDB observable (absent under jsdom); the
// master-data mirror is irrelevant to cart persistence, so short-circuit it.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => undefined }));
// CartProvider (and the hooks it uses) only read `token` from the session.
vi.mock('@/state/SessionContext', () => ({
  // token + a CONFIRMED user: data reads (useProducts/useClients/heldCarts) gate
  // on a resolved session now, not mere token presence — so a truthy user is
  // required for the catalog/clients to flow (and selectedClient to resolve).
  useSession: () => ({ token: 't', user: { _id: 'e_owner' } }),
}));

// In-memory Dexie double. `draft` lives in module scope so it OUTLIVES a provider
// unmount/remount — the durable-storage contract a real reload depends on.
const store = vi.hoisted(() => {
  let draft: unknown = undefined;
  const cartDraft = {
    get: vi.fn(async (_key: string) => draft),
    put: vi.fn(async (row: unknown) => {
      draft = row;
    }),
    delete: vi.fn(async (_key: string) => {
      draft = undefined;
    }),
    clear: vi.fn(async () => {
      draft = undefined;
    }),
  };
  const mirror = () => ({
    clear: vi.fn(async () => {}),
    bulkPut: vi.fn(async () => {}),
    toArray: vi.fn(async () => []),
  });
  return {
    cartDraft,
    getDraft: () => draft as { cart?: unknown[]; [k: string]: unknown } | undefined,
    resetDraft: () => {
      draft = undefined;
    },
    products: mirror(),
    categories: mirror(),
    clients: mirror(),
    settings: mirror(),
    heldCarts: mirror(),
    transaction: vi.fn(async (_mode: unknown, ...rest: unknown[]) => {
      const scope = rest[rest.length - 1] as () => unknown;
      return scope();
    }),
  };
});

vi.mock('@/state/db', () => ({
  db: {
    products: store.products,
    categories: store.categories,
    clients: store.clients,
    settings: store.settings,
    heldCarts: store.heldCarts,
    cartDraft: store.cartDraft,
    transaction: store.transaction,
  },
}));

import { useMutation, useQuery } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { CartProvider, useCart } from '@/state/CartContext';

const useQueryMock = vi.mocked(useQuery);
const useMutationMock = vi.mocked(useMutation);

const cola = {
  _id: 'p_cola',
  _creationTime: 0,
  barcode: '1',
  sku: 'COCA',
  name: 'Coca-Cola 600ml',
  price: 1.5,
  stock: 24,
  minStock: 5,
  categoryId: 'cat1',
} as unknown as Product;

const maria = {
  _id: 'c_maria',
  _creationTime: 0,
  name: 'María González',
  taxPrefix: 'V',
  taxId: '5.123.456',
  kind: 'person',
  createdAt: 0,
} as unknown as Client;

interface Wiring {
  products?: Product[];
  clients?: Client[];
}
const wiring: Wiring = {};
function wireQueries(opts: Wiring) {
  Object.assign(wiring, { products: [], clients: [] }, opts);
  useQueryMock.mockImplementation(((query: any, args: any) => {
    if (args === 'skip') return undefined;
    switch (getFunctionName(query)) {
      case 'products:list':
        return wiring.products;
      case 'clients:list':
        return wiring.clients;
      case 'heldCarts:list':
        return [];
      default:
        return undefined;
    }
  }) as any);
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);
function renderCart(opts: Wiring = {}) {
  wireQueries(opts);
  return renderHook(() => useCart(), { wrapper });
}

beforeEach(() => {
  store.resetDraft();
  useMutationMock.mockImplementation(
    ((_ref: any) => vi.fn(async () => null)) as any
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CartContext — persistent cart (Phase 6.1)', () => {
  test('write-through then reload restores cart, client, splits and next split id', async () => {
    const first = renderCart({ products: [cola], clients: [maria] });
    // Hydration settles (no saved draft yet) before we start mutating.
    await waitFor(() =>
      expect(store.cartDraft.get).toHaveBeenCalledWith('active')
    );

    act(() => {
      first.result.current.setCart([{ ...cola, qty: 2 }]);
      first.result.current.setSelectedClientId(maria._id);
      first.result.current.splitsIdRef.current = 4;
      first.result.current.setSplits([
        { id: 1, method: 'cash', amount: '10' },
        { id: 2, method: 'card', amount: '5' },
      ]);
    });

    // Every mutation is written through to the durable draft.
    await waitFor(() => expect(store.getDraft()?.cart).toHaveLength(1));
    expect(store.getDraft()).toMatchObject({
      id: 'active',
      selectedClientId: 'c_maria',
      splitsNextId: 4,
    });

    // Simulate a reload: tear down the provider, mount a fresh one. The durable
    // draft survives in the mocked store, so hydration restores the sale.
    first.unmount();
    const reopened = renderCart({ products: [cola], clients: [maria] });

    await waitFor(() => expect(reopened.result.current.cart).toHaveLength(1));
    expect(reopened.result.current.cart[0]._id).toBe('p_cola');
    expect(reopened.result.current.cart[0].qty).toBe(2);
    expect(reopened.result.current.selectedClient?._id).toBe('c_maria');
    expect(reopened.result.current.splits).toEqual([
      { id: 1, method: 'cash', amount: '10' },
      { id: 2, method: 'card', amount: '5' },
    ]);
    expect(reopened.result.current.splitsIdRef.current).toBe(4);
  });

  test('the initial empty state never clobbers a saved draft (hydratedRef guard)', async () => {
    // A draft saved by a previous session, pre-seeded directly into the store.
    await store.cartDraft.put({
      id: 'active',
      cart: [{ ...cola, qty: 3 }],
      selectedClientId: maria._id,
      splits: NEW_SPLIT_ROW(),
      splitsNextId: 2,
      updatedAt: 1,
    });
    store.cartDraft.put.mockClear();

    const view = renderCart({ products: [cola], clients: [maria] });

    // Hydration wins over the initial [] — the saved sale is restored…
    await waitFor(() => expect(view.result.current.cart).toHaveLength(1));
    expect(view.result.current.cart[0].qty).toBe(3);
    // …and the write-through never persisted an empty cart before hydration ran.
    const emptyPut = (store.cartDraft.put.mock.calls as any[]).find(
      (call) => Array.isArray(call[0]?.cart) && call[0].cart.length === 0
    );
    expect(emptyPut).toBeUndefined();
  });

  test('discardSale deletes the draft so the discarded sale does not come back', async () => {
    const view = renderCart({ products: [cola], clients: [maria] });
    await waitFor(() => expect(store.cartDraft.get).toHaveBeenCalled());

    act(() => {
      view.result.current.setCart([{ ...cola, qty: 2 }]);
      view.result.current.setSelectedClientId(maria._id);
    });
    await waitFor(() => expect(store.getDraft()?.cart).toHaveLength(1));

    act(() => {
      view.result.current.discardSale();
    });
    expect(store.cartDraft.delete).toHaveBeenCalledWith('active');

    // Reload → the discarded sale is gone (empty cart, no client).
    view.unmount();
    const reopened = renderCart({ products: [cola], clients: [maria] });
    await waitFor(() => expect(reopened.result.current.cart).toHaveLength(0));
    expect(reopened.result.current.selectedClient).toBeNull();
  });

  test('the post-checkout reset (AppShell) deletes the draft', async () => {
    // Reproduces AppShell.handlePaymentConfirm's reset (AppShell.tsx:249-253):
    // empty cart + detach client + reset payment + delete the durable draft.
    const view = renderCart({ products: [cola], clients: [maria] });
    await waitFor(() => expect(store.cartDraft.get).toHaveBeenCalled());

    act(() => {
      view.result.current.setCart([{ ...cola, qty: 2 }]);
      view.result.current.setSelectedClientId(maria._id);
    });
    await waitFor(() => expect(store.getDraft()?.cart).toHaveLength(1));

    act(() => {
      view.result.current.setCart([]);
      view.result.current.setSelectedClientId(null);
      view.result.current.resetPayment();
      // Mirrors AppShell's `void db.cartDraft.delete('active')` (db === store here).
      void store.cartDraft.delete('active');
    });
    expect(store.cartDraft.delete).toHaveBeenCalledWith('active');

    // Reload → the completed sale is gone.
    view.unmount();
    const reopened = renderCart({ products: [cola], clients: [maria] });
    await waitFor(() => expect(reopened.result.current.cart).toHaveLength(0));
    expect(reopened.result.current.selectedClient).toBeNull();
  });
});
