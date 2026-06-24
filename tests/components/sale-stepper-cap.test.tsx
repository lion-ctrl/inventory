// @vitest-environment jsdom
// In-cart quantity stepper (CartItemRow) must cap at physical − reserved, not
// at the physical stock. Bug: with physical 5 and 1 unit held "en espera"
// (reserved 1), the +/qty-input let the cashier climb back to 5. The displayed
// stock number stays PHYSICAL; only the CAP nets out en-espera units.
import { cleanup, render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  useSettingsDoc: () => ({ salesType: 'invoice', scannerMode: 'scanner' }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => cartMock }));

import SaleScreen from '@/screens/Sale';

const makeProduct = (over: Partial<Product> = {}): Product =>
  ({
    _id: 'p_cola',
    _creationTime: 0,
    name: 'Coca-Cola 600ml',
    sku: 'COCA',
    barcode: '7591234567890',
    price: 1.5,
    stock: 5,
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

const cartLine = (qty: number, over: Partial<Product> = {}): CartItem => ({
  ...makeProduct(over),
  qty,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cartMock.cart = [];
  cartMock.reserved = {};
  cartMock.selectedClient = null;
  cartMock.pausedRemovals = [];
  productsMock.current = [];
});

// Grab the cart row's +/− stepper specifically. The product name also appears
// in the catalog tile, so scope by the unique `.cartrow` container, not by text.
const cartRow = () => document.querySelector('.cartrow') as HTMLElement;
const plusInRow = () =>
  within(cartRow()).getByRole('button', { name: 'agregar uno' });

describe('Venta — in-cart stepper caps at physical − reserved', () => {
  beforeEach(() => {
    window.innerWidth = 1280; // desktop two-pane renders CartItemRow directly
    cartMock.selectedClient = maria; // past the ClientGate
  });

  test('physical=5, reserved=1, 4 in cart → "+" disabled (cap 4, cannot reach 5)', () => {
    productsMock.current = [makeProduct({ stock: 5 })];
    cartMock.reserved = { p_cola: 1 };
    cartMock.cart = [cartLine(4, { stock: 5 })];
    render(<SaleScreen onConfirm={vi.fn()} />);
    expect(plusInRow()).toHaveProperty('disabled', true);
    // Cashier-facing cap hint reflects the net availability, not physical.
    expect(within(cartRow()).getByText('Máx. 4 en stock')).toBeDefined();
  });

  test('physical=5, reserved=1, 3 in cart → "+" still enabled (can reach the cap of 4)', () => {
    productsMock.current = [makeProduct({ stock: 5 })];
    cartMock.reserved = { p_cola: 1 };
    cartMock.cart = [cartLine(3, { stock: 5 })];
    render(<SaleScreen onConfirm={vi.fn()} />);
    expect(plusInRow()).toHaveProperty('disabled', false);
  });

  test('typing 5 into the qty input clamps to 4 when reserved=1', async () => {
    const user = userEvent.setup();
    productsMock.current = [makeProduct({ stock: 5 })];
    cartMock.reserved = { p_cola: 1 };
    cartMock.cart = [cartLine(2, { stock: 5 })];
    render(<SaleScreen onConfirm={vi.fn()} />);

    const input = cartRow().querySelector<HTMLInputElement>('.qty-input')!;
    await user.clear(input);
    await user.type(input, '5');
    // The input clamps the display to the cap (4), never the physical 5.
    expect(input.value).toBe('4');
  });

  test('physical=5, reserved=0, 4 in cart → "+" still enabled up to physical 5', () => {
    productsMock.current = [makeProduct({ stock: 5 })];
    cartMock.reserved = {};
    cartMock.cart = [cartLine(4, { stock: 5 })];
    render(<SaleScreen onConfirm={vi.fn()} />);
    expect(plusInRow()).toHaveProperty('disabled', false); // unchanged
  });
});
