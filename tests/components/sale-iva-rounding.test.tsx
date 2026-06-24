// @vitest-environment jsdom
// IVA rounding parity with the backend (bug/iva-calculation). The cart used to
// compute IVA UNROUNDED: subtotal $2.30 × 13% = $0.299, total 2.599. The USD
// lines showed $0.30 / $2.60 (toFixed display rounding) but "Total en Bs"
// converted the UNROUNDED total (2.599 × 700 = Bs 1819.30), so USD and Bs did
// not correspond and the Bs misrepresented what the backend actually charges
// (it round2's the tax → $2.60). Fix: round2 the IVA in the cart too, so every
// USD and Bs line derives from the rounded total. Target for $2.30 / 13% / 700:
// IVA $0.30, Total $2.60, Total en Bs Bs 1820.00 (== round2(total) × bsRate).
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CartItem, Client, Product } from '@/types';

const BS_RATE = 700;
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  useBsRate: () => BS_RATE,
  useCategories: () => [],
  useClients: () => [],
  useProducts: () => productsMock.current,
  useSettingsDoc: () => ({
    ivaPct: 13,
    scannerMode: 'scanner',
  }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => cartMock }));

import SaleScreen from '@/screens/Sale';

const makeProduct = (over: Record<string, unknown> = {}): Product =>
  ({
    _id: 'p_item',
    _creationTime: 0,
    name: 'Producto 2.30',
    sku: 'ITEM',
    barcode: '7591234567890',
    price: 2.3,
    stock: 24,
    glyph: '📦',
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

// One non-exempt item @ $2.30 → subtotal 2.30, IVA round2(0.299)=0.30, total 2.60.
const cart230 = (): CartItem[] => [line({}, 1)];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cartMock.cart = [];
  cartMock.reserved = {};
  cartMock.selectedClient = null;
  cartMock.pausedRemovals = [];
  productsMock.current = [];
});

// Read a totals line by its leading <span> label; return the value span text.
const valueFor = (totals: HTMLElement, label: RegExp): string => {
  const lines = Array.from(totals.querySelectorAll('.line'));
  const row = lines.find((l) =>
    label.test(l.querySelector('span:first-child')?.textContent ?? '')
  );
  if (!row) throw new Error(`No totals line for ${label}`);
  return row.querySelector('span:last-child')?.textContent ?? '';
};

describe('Venta — IVA rounding parity (display == charge, Bs == rounded USD)', () => {
  beforeEach(() => {
    cartMock.selectedClient = maria; // past the ClientGate
  });

  for (const [name, width] of [
    ['desktop', 1280],
    ['mobile', 480],
  ] as const) {
    test(`${name}: IVA 0.30, Total 2.60, Total en Bs == round2(total) * bsRate`, () => {
      window.innerWidth = width;
      cartMock.cart = cart230();
      render(<SaleScreen onConfirm={vi.fn()} />);
      const totals = document.querySelector('.totals') as HTMLElement;

      // IVA round2(2.30 * 0.13) = round2(0.299) = 0.30 (not the raw 0.299).
      expect(valueFor(totals, /^IVA/)).toBe('$0.30');
      // Total = round2(2.30 + 0.30) = 2.60 (subtotal sum of 2-dec prices).
      expect(within(totals).getByText('$2.60')).toBeTruthy();

      // The bug: Total en Bs must equal round2(total) * bsRate (1820.00), NOT
      // the unrounded total * bsRate (2.599 * 700 = 1819.30).
      const expectedBs = `Bs ${(round2(2.6) * BS_RATE).toFixed(2)}`; // Bs 1820.00
      expect(valueFor(totals, /^Total en Bs/)).toBe(expectedBs);
      // Guard against the exact pre-fix divergence resurfacing.
      expect(valueFor(totals, /^Total en Bs/)).not.toBe('Bs 1819.30');
    });
  }
});
