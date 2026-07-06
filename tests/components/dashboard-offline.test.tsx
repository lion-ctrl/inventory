// @vitest-environment jsdom
// Phase 9 — Dashboard offline. Master data (products/clients/categories/heldCarts)
// is Dexie-mirrored, so the low-stock tiles + counts render offline. But
// `sales.history` is NOT mirrored, so offline the "Vendido hoy" hero + recent-sales
// show "No disponible sin conexión" instead of a misleading $0 — and never throw.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const H = vi.hoisted(() => {
  const salesHistory: { current: unknown } = { current: undefined };
  return {
    navigate: vi.fn(),
    online: { current: false },
    salesHistory,
    products: [
      {
        _id: 'p_cafe',
        name: 'Café molido 500g',
        sku: 'CAFE',
        stock: 1,
        minStock: 5,
        sellable: true,
        categoryId: 'c1',
        glyph: '☕',
      },
    ],
  };
});

vi.mock('react-router', () => ({ useNavigate: () => H.navigate }));
vi.mock('convex/react', () => ({ useQuery: () => H.salesHistory.current }));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ user: { name: 'Carlos' }, token: 'tok', can: () => true }),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => H.online.current }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 36,
  useCategories: () => [{ _id: 'c1', label: 'Bebidas' }],
  useClients: () => [{ _id: 'cl1' }],
  useProducts: () => H.products,
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => ({ heldCarts: [] }) }));

import Dashboard from '@/screens/Dashboard';

beforeEach(() => {
  H.online.current = false;
  H.salesHistory.current = undefined;
});
afterEach(() => cleanup());

describe('Dashboard — offline', () => {
  test('offline with no cached history: sales tiles show "No disponible sin conexión", master-data tiles still render', () => {
    H.online.current = false;
    H.salesHistory.current = undefined;
    render(<Dashboard />);

    // The misleading $0 is replaced by the honest offline state (hero + recent).
    expect(
      screen.getAllByText(/No disponible sin conexión/).length
    ).toBeGreaterThan(0);
    // The mirrored master data still renders offline — low-stock product shows.
    expect(screen.getByText('Café molido 500g')).toBeDefined();
    // The offline banner is present.
    expect(screen.getByText('Sin conexión')).toBeDefined();
  });

  test('online with history: the sales hero shows figures, not the offline state', () => {
    H.online.current = true;
    H.salesHistory.current = [
      {
        _id: 's1',
        soldAt: Date.now(),
        total: 50,
        items: [{ qty: 2 }],
        method: 'cash',
        invoiceNumber: '00000001',
        refund: false,
        client: null,
      },
    ];
    render(<Dashboard />);
    expect(screen.queryByText(/No disponible sin conexión/)).toBeNull();
  });
});
