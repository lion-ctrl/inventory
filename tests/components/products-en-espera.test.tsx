// @vitest-environment jsdom
// Productos: the screen that EDITS/ADJUSTS physical stock must keep showing the
// physical number — we only ADD an informational "N en espera" chip (card +
// detail). The displayed stock number must never change.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Product } from '@/types';

const { cartMock, productsMock } = vi.hoisted(() => {
  const cartMock: { reserved: Record<string, number> } = { reserved: {} };
  const productsMock: { current: Product[] } = { current: [] };
  return { cartMock, productsMock };
});

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, key: 'test', pathname: '/productos' }),
}));
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => true }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useCategories: () => [],
  useProducts: () => productsMock.current,
}));
vi.mock('@/state/SessionContext', () => ({
  // ProductsScreen only reads `user` inside mutation handlers (not on render),
  // so null is enough to render the grid + detail sheet.
  useSession: () => ({ user: null }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => cartMock }));

import ProductsScreen from '@/screens/Products';

const makeProduct = (over: Partial<Product> = {}): Product =>
  ({
    _id: 'p_cola',
    _creationTime: 0,
    name: 'Coca-Cola 600ml',
    sku: 'COCA',
    barcode: '7591234567890',
    price: 1.5,
    stock: 3,
    glyph: '🥤',
    categoryId: 'cat1',
    minStock: 5,
    sellable: true,
    exempt: false,
    createdAt: 0,
    ...over,
  }) as unknown as Product;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cartMock.reserved = {};
  productsMock.current = [];
});

describe('Productos — en-espera chip (physical stock untouched)', () => {
  test('reserved>0 → card shows physical "3 en stock" + "3 en espera"', () => {
    productsMock.current = [makeProduct({ stock: 3 })];
    cartMock.reserved = { p_cola: 3 };
    render(<ProductsScreen />);
    expect(screen.getByText('3 en stock')).toBeDefined(); // physical
    expect(screen.getByText('3 en espera')).toBeDefined();
  });

  test('reserved>0 → detail keeps "Stock actual: 3 unidades" and adds "3 en espera"', async () => {
    const user = userEvent.setup();
    productsMock.current = [makeProduct({ stock: 3 })];
    cartMock.reserved = { p_cola: 3 };
    render(<ProductsScreen />);

    await user.click(
      screen.getByText('Coca-Cola 600ml').closest('button') as HTMLElement
    );

    expect(screen.getByText('Stock actual')).toBeDefined();
    // physical, unchanged — shown in the "Stock actual" row (and adjust helper)
    expect(screen.getAllByText('3 unidades').length).toBeGreaterThanOrEqual(1);
    // chip present on both the card behind and the open detail sheet
    expect(screen.getAllByText('3 en espera').length).toBeGreaterThanOrEqual(2);
  });

  test('reserved=0 → no en-espera chip', () => {
    productsMock.current = [makeProduct({ stock: 3 })];
    cartMock.reserved = {};
    render(<ProductsScreen />);
    expect(screen.queryByText(/en espera/)).toBeNull();
  });
});
