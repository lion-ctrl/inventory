// @vitest-environment jsdom
// Session + Cart context logic via renderHook, with convex/react mocked at the
// hook boundary.
// NOTE: the generated `api` is a Proxy that mints a NEW reference per property
// access — identity comparisons never match. Mocks key on getFunctionName().
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

// Phase 0/1: useProducts (consumed by CartContext) now reads through
// useMirroredQuery → Dexie, and the logout guard touches db.pendingOps. Neither
// IndexedDB nor Dexie's liveQuery exists in jsdom, so stub the local store with a
// benign in-memory mock (0 unsynced ops) and short-circuit useLiveQuery. These
// tests assert on the Convex-live path, which is unaffected.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => undefined }));
vi.mock('@/state/db', () => {
  const mirror = () => ({
    clear: vi.fn(async () => {}),
    bulkPut: vi.fn(async () => {}),
    toArray: vi.fn(async () => []),
  });
  return {
    db: {
      products: mirror(),
      categories: mirror(),
      clients: mirror(),
      settings: mirror(),
      cartDraft: { clear: vi.fn(async () => {}) },
      pendingOps: {
        where: () => ({ anyOf: () => ({ count: async () => 0 }) }),
      },
      transaction: vi.fn(async (_mode: unknown, ...rest: unknown[]) => {
        const scope = rest[rest.length - 1] as () => unknown;
        return scope();
      }),
      delete: vi.fn(async () => {}),
    },
  };
});

import { useMutation, useQuery } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { SessionProvider, useSession } from '@/state/SessionContext';
import { CartProvider, useCart } from '@/state/CartContext';
import type { Client, Product } from '@/types';

const useQueryMock = vi.mocked(useQuery);
const useMutationMock = vi.mocked(useMutation);

// Mirrors auth.me's PUBLIC projection: no pin / pinHash / pinSalt ever reaches
// the client. The session credential is the TOKEN, persisted under pos.sessionToken.
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

const pausedProduct = {
  ...cola,
  _id: 'p_paused',
  sku: 'PAUSED',
  name: 'Pintura blanca 1gal',
  sellable: false,
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
  me?: typeof owner | null;
  products?: Product[];
  clients?: Client[];
  heldCarts?: any[];
}

/** Mutable wiring read at query time — tests can swap arrays and rerender. */
const wiring: Wiring = {};

function wireQueries(opts: Wiring) {
  Object.assign(
    wiring,
    { me: undefined, products: [], clients: [], heldCarts: [] },
    opts
  );
  useQueryMock.mockImplementation(((query: any, args: any) => {
    if (args === 'skip') return undefined;
    switch (getFunctionName(query)) {
      case 'auth:me':
        return wiring.me;
      case 'products:list':
        return wiring.products;
      case 'clients:list':
        return wiring.clients;
      case 'categories:list':
        return [];
      case 'settings:get':
        return null;
      case 'heldCarts:list':
        return wiring.heldCarts;
      default:
        return undefined;
    }
  }) as any);
}

const mutationFns = new Map<string, ReturnType<typeof vi.fn>>();
function mutationFor(name: string) {
  if (!mutationFns.has(name))
    mutationFns.set(
      name,
      vi.fn(async () => null)
    );
  return mutationFns.get(name)!;
}

beforeEach(() => {
  localStorage.clear();
  mutationFns.clear();
  useMutationMock.mockImplementation(((ref: any) =>
    mutationFor(getFunctionName(ref))) as any);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sessionWrapper = ({ children }: { children: ReactNode }) => (
  <SessionProvider>{children}</SessionProvider>
);
const cartWrapper = ({ children }: { children: ReactNode }) => (
  <SessionProvider>
    <CartProvider>{children}</CartProvider>
  </SessionProvider>
);

describe('SessionContext', () => {
  test('a stale persisted token resolves to null and gets cleaned up (legacy id wiped too)', async () => {
    localStorage.setItem('pos.sessionToken', 'stale-token-from-old-deployment');
    localStorage.setItem('pos.sessionExpiresAt', String(futureExpiry()));
    // A pre-AUTH-5 deployment may have left this key behind — boot must clear it.
    localStorage.setItem('pos.employeeId', 'legacy-id');
    wireQueries({ me: null });

    const { result } = renderHook(() => useSession(), {
      wrapper: sessionWrapper,
    });

    await waitFor(() => {
      expect(localStorage.getItem('pos.sessionToken')).toBeNull();
    });
    expect(localStorage.getItem('pos.employeeId')).toBeNull();
    expect(result.current.user).toBeNull();
  });

  test('login persists the session token and exposes the user + can()', async () => {
    wireQueries({ me: owner });
    mutationFor('auth:login').mockResolvedValue({
      ok: true,
      token: OWNER_TOKEN,
      expiresAt: futureExpiry(),
    });

    const { result } = renderHook(() => useSession(), {
      wrapper: sessionWrapper,
    });
    expect(result.current.user).toBeNull();

    await act(async () => {
      const res = await result.current.login('carlos@mitienda.com', '482106');
      expect(res.ok).toBe(true);
    });

    expect(localStorage.getItem('pos.sessionToken')).toBe(OWNER_TOKEN);
    expect(result.current.token).toBe(OWNER_TOKEN);
    expect(result.current.user?.name).toBe('Carlos Méndez');
    expect(result.current.can('manage_settings')).toBe(true);

    act(() => result.current.logout());
    // logout revokes the session server-side, THEN clears local state.
    expect(mutationFor('auth:logout')).toHaveBeenCalledWith({
      token: OWNER_TOKEN,
    });
    expect(localStorage.getItem('pos.sessionToken')).toBeNull();
    expect(result.current.user).toBeNull();
  });

  test('failed logins surface the server error untouched', async () => {
    wireQueries({ me: null });
    mutationFor('auth:login').mockResolvedValue({
      ok: false,
      error: 'Credenciales inválidas. Verifica e intenta de nuevo.',
    });

    const { result } = renderHook(() => useSession(), {
      wrapper: sessionWrapper,
    });
    await act(async () => {
      const res = await result.current.login('x@x.com', '000000');
      expect(res).toEqual({
        ok: false,
        error: 'Credenciales inválidas. Verifica e intenta de nuevo.',
      });
    });
    expect(localStorage.getItem('pos.sessionToken')).toBeNull();
    expect(result.current.user).toBeNull();
  });
});

describe('CartContext', () => {
  function renderCart(opts: Wiring) {
    localStorage.setItem('pos.sessionToken', OWNER_TOKEN);
    localStorage.setItem('pos.sessionExpiresAt', String(futureExpiry()));
    wireQueries({ me: owner, ...opts });
    return renderHook(() => useCart(), { wrapper: cartWrapper });
  }

  test('reserved stock aggregates held-cart quantities per product', () => {
    const { result } = renderCart({
      products: [cola],
      heldCarts: [
        { _id: 'h1', items: [{ productId: 'p_cola', qty: 2 }] },
        { _id: 'h2', items: [{ productId: 'p_cola', qty: 3 }] },
      ],
    });
    expect(result.current.reserved).toEqual({ p_cola: 5 });
  });

  test('a products update prunes paused lines and refreshes snapshots (products-driven sync)', async () => {
    const { result, rerender } = renderCart({
      products: [cola, pausedProduct],
    });

    act(() => {
      result.current.setCart([
        { ...cola, qty: 2 },
        { ...pausedProduct, qty: 1 },
      ]);
    });
    // Until products change, the cart keeps what was added — the prune is
    // reactive to the products query, not to setCart (characterized behavior;
    // the Venta UI never offers paused products in the first place).
    expect(result.current.cart).toHaveLength(2);

    // Live update arrives (pause happened server-side): new array identity.
    wiring.products = [{ ...cola, price: 1.75 }, pausedProduct] as Product[];
    rerender();

    await waitFor(() => {
      expect(result.current.cart).toHaveLength(1);
    });
    expect(result.current.cart[0]._id).toBe('p_cola');
    expect(result.current.cart[0].qty).toBe(2);
    expect(result.current.cart[0].price).toBe(1.75); // snapshot refreshed from live data
  });

  test('pauseSale parks the cart with clean splits and resets local state', async () => {
    const { result } = renderCart({ products: [cola] });
    const park = mutationFor('heldCarts:park');

    act(() => {
      result.current.setCart([{ ...cola, qty: 2 }]);
      result.current.setSplits([
        { id: 1, method: 'cash', amount: '3' },
        { id: 2, method: 'card', amount: '' }, // empty rows are not persisted
      ]);
    });
    await act(async () => {
      await result.current.pauseSale('Vuelve en 10 min');
    });

    expect(park).toHaveBeenCalledWith({
      token: OWNER_TOKEN,
      clientId: undefined,
      items: [{ productId: 'p_cola', qty: 2 }],
      splits: [{ method: 'cash', amount: 3 }],
      note: 'Vuelve en 10 min',
    });
    expect(result.current.cart).toHaveLength(0);
    expect(result.current.splits).toEqual([
      { id: 1, method: 'cash', amount: '' },
    ]);
  });

  test('discardSale wipes the cart, payment splits, and the selected client', () => {
    const { result } = renderCart({ products: [cola], clients: [maria] });

    act(() => {
      result.current.setCart([{ ...cola, qty: 2 }]);
      result.current.setSelectedClientId(maria._id);
      result.current.setSplits([{ id: 1, method: 'cash', amount: '3' }]);
    });
    // An in-progress sale with a client attached.
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.selectedClient?._id).toBe('c_maria');

    act(() => {
      result.current.discardSale();
    });

    // Cancelling/closing must discard the WHOLE sale — including the client —
    // so the next Venta visit re-shows the ClientGate for a fresh sale.
    expect(result.current.cart).toHaveLength(0);
    expect(result.current.selectedClient).toBeNull();
    expect(result.current.splits).toEqual([
      { id: 1, method: 'cash', amount: '' },
    ]);
  });

  test('resumeSale drops paused items AND records their names in pausedRemovals', async () => {
    const { result } = renderCart({ products: [cola, pausedProduct] });
    const resume = mutationFor('heldCarts:resume');
    resume.mockResolvedValue({
      items: [
        { productId: 'p_cola', qty: 2 },
        { productId: 'p_paused', qty: 1 }, // paused → dropped + recorded by name
      ],
      client: null,
      splits: [],
    });

    await act(async () => {
      await result.current.resumeSale('h1' as any);
    });

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]._id).toBe('p_cola');
    expect(result.current.cart[0].qty).toBe(2);
    // The dropped paused line surfaces as a Venta notice (drives the modal).
    expect(result.current.pausedRemovals).toEqual(['Pintura blanca 1gal']);
  });

  test('resumeSale with ALL lines paused → cart lands EMPTY, every name recorded', async () => {
    const otherPaused = {
      ...pausedProduct,
      _id: 'p_paused2',
      name: 'Cemento gris',
    } as unknown as Product;
    const { result } = renderCart({ products: [pausedProduct, otherPaused] });
    const resume = mutationFor('heldCarts:resume');
    resume.mockResolvedValue({
      items: [
        { productId: 'p_paused', qty: 1 },
        { productId: 'p_paused2', qty: 1 },
      ],
      client: null,
      splits: [],
    });

    await act(async () => {
      await result.current.resumeSale('h1' as any);
    });

    expect(result.current.cart).toHaveLength(0);
    expect(result.current.pausedRemovals).toEqual([
      'Pintura blanca 1gal',
      'Cemento gris',
    ]);
  });

  test('resumeSale drops DELETED products SILENTLY (no name recorded)', async () => {
    const { result } = renderCart({ products: [cola] });
    const resume = mutationFor('heldCarts:resume');
    resume.mockResolvedValue({
      items: [
        { productId: 'p_cola', qty: 2 },
        { productId: 'p_gone', qty: 1 }, // no live product → dropped silently
      ],
      client: null,
      splits: [],
    });

    await act(async () => {
      await result.current.resumeSale('h1' as any);
    });

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cart[0]._id).toBe('p_cola');
    // Deleted (not paused) → no cashier-facing notice.
    expect(result.current.pausedRemovals).toEqual([]);
  });

  test('a live cart item that becomes paused is removed and recorded in pausedRemovals; dismiss clears it', async () => {
    const { result, rerender } = renderCart({ products: [cola] });

    act(() => {
      result.current.setCart([{ ...cola, qty: 2 }]);
    });
    expect(result.current.cart).toHaveLength(1);
    expect(result.current.pausedRemovals).toEqual([]);

    // Admin pauses the product live: the reactive query yields a new array.
    wiring.products = [{ ...cola, sellable: false }] as Product[];
    rerender();

    await waitFor(() => expect(result.current.cart).toHaveLength(0));
    expect(result.current.pausedRemovals).toEqual(['Coca-Cola 600ml']);

    act(() => {
      result.current.dismissPausedRemovals();
    });
    expect(result.current.pausedRemovals).toEqual([]);
  });
});
