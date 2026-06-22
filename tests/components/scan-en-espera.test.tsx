// @vitest-environment jsdom
// Escanear (info-only): shows PHYSICAL stock and an informational "N en espera"
// chip wherever stock is shown — tile + ProductInfoSheet. No add-to-cart here.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Product } from '@/types';

const { cartMock, productsMock } = vi.hoisted(() => {
  const cartMock: { reserved: Record<string, number> } = { reserved: {} };
  const productsMock: { current: Product[] } = { current: [] };
  return { cartMock, productsMock };
});

// Escanear pulls ScannerView from the Sale module — stub it so the test focuses
// on the catalog grid + ProductInfoSheet (no camera / HID machinery).
vi.mock('@/screens/Sale', () => ({ ScannerView: () => null }));
vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  useMutation: () => vi.fn(),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => true }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useCategories: () => [],
  useProducts: () => productsMock.current,
  useSettingsDoc: () => ({ ivaPct: 13, scannerMode: 'scanner' }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => cartMock }));

import ScanScreen from '@/screens/Scan';

const makeProduct = (over: Partial<Product> = {}): Product =>
  ({
    _id: 'p_cola',
    _creationTime: 0,
    name: 'Coca-Cola 600ml',
    sku: 'COCA',
    barcode: '7591234567890',
    price: 1.5,
    stock: 2,
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

describe('Escanear — en-espera chip (physical stock untouched)', () => {
  test('reserved>0 → tile shows physical "Máx. 2 en stock" + "2 en espera"', () => {
    productsMock.current = [makeProduct({ stock: 2 })];
    cartMock.reserved = { p_cola: 2 };
    render(<ScanScreen />);
    expect(screen.getByText('Máx. 2 en stock')).toBeDefined();
    expect(screen.getByText('2 en espera')).toBeDefined();
  });

  test('reserved>0 → ProductInfoSheet shows physical "2 en stock" + "2 en espera"', async () => {
    const user = userEvent.setup();
    productsMock.current = [makeProduct({ stock: 2 })];
    cartMock.reserved = { p_cola: 2 };
    render(<ScanScreen />);

    await user.click(
      screen.getByText('Coca-Cola 600ml').closest('button') as HTMLElement
    );

    expect(screen.getByText('2 en stock')).toBeDefined(); // sheet chip = physical
    // chip appears in both the tile behind and the open sheet
    expect(screen.getAllByText('2 en espera').length).toBeGreaterThanOrEqual(2);
  });

  test('reserved=0 → no en-espera chip', () => {
    productsMock.current = [makeProduct({ stock: 2 })];
    cartMock.reserved = {};
    render(<ScanScreen />);
    expect(screen.queryByText(/en espera/)).toBeNull();
  });
});
