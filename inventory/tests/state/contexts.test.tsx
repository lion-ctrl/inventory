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

import { useMutation, useQuery } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { SessionProvider, useSession } from '@/state/SessionContext';
import { CartProvider, useCart } from '@/state/CartContext';
import type { Product } from '@/types';

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
  pin: '482106',
  active: true,
  createdAt: 0,
};

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

interface Wiring {
  me?: typeof owner | null;
  products?: Product[];
  heldCarts?: any[];
}

/** Mutable wiring read at query time — tests can swap arrays and rerender. */
const wiring: Wiring = {};

function wireQueries(opts: Wiring) {
  Object.assign(wiring, { me: undefined, products: [], heldCarts: [] }, opts);
  useQueryMock.mockImplementation(((query: any, args: any) => {
    if (args === 'skip') return undefined;
    switch (getFunctionName(query)) {
      case 'auth:me':         return wiring.me;
      case 'products:list':   return wiring.products;
      case 'clients:list':    return [];
      case 'categories:list': return [];
      case 'settings:get':    return null;
      case 'heldCarts:list':  return wiring.heldCarts;
      default:                return undefined;
    }
  }) as any);
}

const mutationFns = new Map<string, ReturnType<typeof vi.fn>>();
function mutationFor(name: string) {
  if (!mutationFns.has(name)) mutationFns.set(name, vi.fn(async () => null));
  return mutationFns.get(name)!;
}

beforeEach(() => {
  localStorage.clear();
  mutationFns.clear();
  useMutationMock.mockImplementation(((ref: any) => mutationFor(getFunctionName(ref))) as any);
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
  test('a stale persisted id resolves to null and gets cleaned up', async () => {
    localStorage.setItem('pos.employeeId', 'stale-id-from-old-deployment');
    wireQueries({ me: null });

    const { result } = renderHook(() => useSession(), { wrapper: sessionWrapper });

    await waitFor(() => {
      expect(localStorage.getItem('pos.employeeId')).toBeNull();
    });
    expect(result.current.user).toBeNull();
  });

  test('login persists the employee id and exposes the user + can()', async () => {
    wireQueries({ me: owner });
    mutationFor('auth:login').mockResolvedValue({ ok: true, employee: owner });

    const { result } = renderHook(() => useSession(), { wrapper: sessionWrapper });
    expect(result.current.user).toBeNull();

    await act(async () => {
      const res = await result.current.login('carlos@mitienda.com', '482106');
      expect(res.ok).toBe(true);
    });

    expect(localStorage.getItem('pos.employeeId')).toBe('e_owner');
    expect(result.current.user?.name).toBe('Carlos Méndez');
    expect(result.current.can('manage_settings')).toBe(true);

    act(() => result.current.logout());
    expect(localStorage.getItem('pos.employeeId')).toBeNull();
    expect(result.current.user).toBeNull();
  });

  test('failed logins surface the server error untouched', async () => {
    wireQueries({ me: null });
    mutationFor('auth:login').mockResolvedValue({
      ok: false,
      error: 'Credenciales inválidas. Verifica e intenta de nuevo.',
    });

    const { result } = renderHook(() => useSession(), { wrapper: sessionWrapper });
    await act(async () => {
      const res = await result.current.login('x@x.com', '000000');
      expect(res).toEqual({
        ok: false,
        error: 'Credenciales inválidas. Verifica e intenta de nuevo.',
      });
    });
    expect(localStorage.getItem('pos.employeeId')).toBeNull();
    expect(result.current.user).toBeNull();
  });
});

describe('CartContext', () => {
  function renderCart(opts: Wiring) {
    localStorage.setItem('pos.employeeId', 'e_owner');
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
    const { result, rerender } = renderCart({ products: [cola, pausedProduct] });

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
      actorId: 'e_owner',
      clientId: undefined,
      items: [{ productId: 'p_cola', qty: 2 }],
      splits: [{ method: 'cash', amount: 3 }],
      note: 'Vuelve en 10 min',
    });
    expect(result.current.cart).toHaveLength(0);
    expect(result.current.splits).toEqual([{ id: 1, method: 'cash', amount: '' }]);
  });
});
