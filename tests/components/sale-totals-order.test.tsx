// @vitest-environment jsdom
// Cart totals line order (owner request): Exento → Subtotal → IVA. The "Exento
// (E)" line must render ABOVE "Subtotal". Total / Total en Bs stay after IVA.
// The Exento line is conditional (invoice + an exempt amount exists).
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
    ivaPct: 13,
    scannerMode: 'scanner',
  }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => cartMock }));

import SaleScreen, { ProductFoundSheet } from '@/screens/Sale';

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

// A taxable + an exempt line so the Exento line is shown alongside Subtotal/IVA.
const mixedCart = (): CartItem[] => [
  line({ _id: 'p_cola', name: 'Coca-Cola 600ml', exempt: false }, 2),
  line({ _id: 'p_agua', name: 'Agua mineral 1L', exempt: true }, 1),
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cartMock.cart = [];
  cartMock.reserved = {};
  cartMock.selectedClient = null;
  cartMock.pausedRemovals = [];
  productsMock.current = [];
});

const labelsInOrder = (totals: HTMLElement): string[] =>
  Array.from(totals.querySelectorAll('.line > span:first-child')).map(
    (el) => el.textContent ?? ''
  );

describe('Venta — cart totals order: Exento before Subtotal', () => {
  beforeEach(() => {
    cartMock.selectedClient = maria; // past the ClientGate
  });

  test('desktop totals render Exento above Subtotal, then IVA, then Total', () => {
    window.innerWidth = 1280;
    cartMock.cart = mixedCart();
    render(<SaleScreen onConfirm={vi.fn()} />);
    const totals = document.querySelector('.totals') as HTMLElement;
    const labels = labelsInOrder(totals);
    const iExento = labels.findIndex((l) => l.startsWith('Exento'));
    const iSubtotal = labels.indexOf('Subtotal');
    const iIva = labels.findIndex((l) => l.startsWith('IVA'));
    const iTotal = labels.indexOf('Total');
    expect(iExento).toBeGreaterThanOrEqual(0);
    expect(iExento).toBeLessThan(iSubtotal);
    expect(iSubtotal).toBeLessThan(iIva);
    expect(iIva).toBeLessThan(iTotal);
  });

  test('mobile (CartContent) totals render Exento above Subtotal too', () => {
    window.innerWidth = 480;
    cartMock.cart = mixedCart();
    render(<SaleScreen onConfirm={vi.fn()} />);
    const totals = document.querySelector('.totals') as HTMLElement;
    const labels = labelsInOrder(totals);
    const iExento = labels.findIndex((l) => l.startsWith('Exento'));
    const iSubtotal = labels.indexOf('Subtotal');
    expect(iExento).toBeGreaterThanOrEqual(0);
    expect(iExento).toBeLessThan(iSubtotal);
  });

  test('no exempt amount → no Exento line (Subtotal stays first)', () => {
    window.innerWidth = 1280;
    cartMock.cart = [
      line({ _id: 'p_cola', name: 'Coca-Cola 600ml', exempt: false }, 2),
    ];
    render(<SaleScreen onConfirm={vi.fn()} />);
    const totals = document.querySelector('.totals') as HTMLElement;
    expect(within(totals).queryByText(/^Exento/)).toBeNull();
    expect(labelsInOrder(totals)[0]).toBe('Subtotal');
  });
});

// Keep ProductFoundSheet referenced so an unused-import lint never trips if the
// suite is trimmed; it documents that the reorder is cart-only, not the sheet.
void ProductFoundSheet;
