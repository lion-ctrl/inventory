// @vitest-environment jsdom
// Cart line items show a small "Exento IVA" chip (Chip tone="info") on each line
// whose product is IVA-exempt (item.exempt === true), so the cashier sees at a
// glance which products don't add IVA. Non-exempt lines show no chip. The chip
// lives in CartItemRow, which is shared by BOTH the mobile (CartContent) and the
// desktop inline cart — so one chip covers both layouts.
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CartItem, Client, Product } from '@/types';

const { cartMock, productsMock } = vi.hoisted(() => {
  const cartMock: {
    cart: CartItem[];
    setCart: ReturnType<typeof vi.fn>;
    selectedClient: Client | null;
    setSelectedClientId: ReturnType<typeof vi.fn>;
    splits: unknown[];
    resetPayment: ReturnType<typeof vi.fn>;
    discardSale: ReturnType<typeof vi.fn>;
    reserved: Record<string, number>;
    pauseSale: ReturnType<typeof vi.fn>;
    pausedRemovals: string[];
    dismissPausedRemovals: ReturnType<typeof vi.fn>;
  } = {
    cart: [],
    setCart: vi.fn(),
    selectedClient: null,
    setSelectedClientId: vi.fn(),
    splits: [],
    resetPayment: vi.fn(),
    discardSale: vi.fn(),
    reserved: {},
    pauseSale: vi.fn(async () => {}),
    pausedRemovals: [],
    dismissPausedRemovals: vi.fn(),
  };
  const productsMock: { current: Product[] } = { current: [] };
  return { cartMock, productsMock };
});

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => true }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useCategories: () => [],
  useClients: () => [],
  useProducts: () => productsMock.current,
  useSettingsDoc: () => ({
    salesType: 'invoice',
    ivaPct: 13,
    scannerMode: 'scanner',
  }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => cartMock }));

import SaleScreen from '@/screens/Sale';

const makeProduct = (over: Record<string, unknown> = {}): Product =>
  ({
    _id: 'p_cola',
    _creationTime: 0,
    name: 'Coca-Cola 600ml',
    sku: 'COCA',
    barcode: '7591234567890',
    price: 1.5,
    stock: 24,
    glyph: '🥤',
    categoryId: 'cat1',
    minStock: 5,
    sellable: true,
    exempt: false,
    createdAt: 0,
    ...over,
  }) as unknown as Product;

const maria = {
  _id: 'c_maria',
  name: 'María',
  taxPrefix: 'V',
  taxId: '1',
  kind: 'person',
  createdAt: 0,
} as unknown as Client;

const line = (over: Record<string, unknown>, qty = 1): CartItem => ({
  ...makeProduct(over),
  qty,
});

// One exempt line + one taxable line, so we can assert the chip shows on exactly
// the exempt row and not the other.
const mixedCart = (): CartItem[] => [
  line({ _id: 'p_cola', name: 'Coca-Cola 600ml', exempt: false }, 2),
  line({ _id: 'p_agua', name: 'Agua mineral 1L', exempt: true }, 1),
];

// Scope to a specific cart row by product name — the product name is unique per
// `.cartrow`, so we find the row whose `.pname` matches.
const rowByName = (name: string): HTMLElement => {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.cartrow'));
  const match = rows.find(
    (r) => r.querySelector('.pname')?.textContent === name
  );
  if (!match) throw new Error(`No .cartrow found for "${name}"`);
  return match;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cartMock.cart = [];
  cartMock.reserved = {};
  cartMock.selectedClient = null;
  cartMock.pausedRemovals = [];
  productsMock.current = [];
});

describe('Venta — cart line "Exento IVA" chip', () => {
  beforeEach(() => {
    cartMock.selectedClient = maria; // past the ClientGate
  });

  test('desktop: exempt line shows the chip, non-exempt line does not', () => {
    window.innerWidth = 1280; // desktop two-pane renders CartItemRow directly
    cartMock.cart = mixedCart();
    render(<SaleScreen onConfirm={vi.fn()} />);

    const exemptRow = rowByName('Agua mineral 1L');
    const taxableRow = rowByName('Coca-Cola 600ml');

    expect(within(exemptRow).getByText('Exento IVA')).toBeDefined();
    expect(within(taxableRow).queryByText('Exento IVA')).toBeNull();
  });

  test('mobile (CartContent): exempt line shows the chip, non-exempt line does not', () => {
    window.innerWidth = 480; // mobile renders CartContent (same CartItemRow)
    cartMock.cart = mixedCart();
    render(<SaleScreen onConfirm={vi.fn()} />);

    const exemptRow = rowByName('Agua mineral 1L');
    const taxableRow = rowByName('Coca-Cola 600ml');

    expect(within(exemptRow).getByText('Exento IVA')).toBeDefined();
    expect(within(taxableRow).queryByText('Exento IVA')).toBeNull();
  });

  test('the chip uses Chip tone="info" (matches ProductFoundSheet)', () => {
    window.innerWidth = 1280;
    cartMock.cart = [
      line({ _id: 'p_agua', name: 'Agua mineral 1L', exempt: true }, 1),
    ];
    render(<SaleScreen onConfirm={vi.fn()} />);

    const exemptRow = rowByName('Agua mineral 1L');
    const chip = within(exemptRow).getByText('Exento IVA');
    expect(chip.className).toContain('chip-info');
  });
});
