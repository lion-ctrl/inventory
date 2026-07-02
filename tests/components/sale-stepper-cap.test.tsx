// @vitest-environment jsdom
// In-cart quantity stepper (CartItemRow) caps at PHYSICAL stock. A product
// reserved by held ("en espera") carts NO LONGER lowers the cap — stock is live
// for everyone. The stepper only stops the cashier from exceeding what
// physically exists in one cart.
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
  useSettingsDoc: () => ({ scannerMode: 'scanner' }),
}));
vi.mock('@/state/SessionContext', () => ({
  // SaleScreen only reads `token` inside the create-client handler (not on
  // render), so a stub session is enough to render the Venta screen.
  useSession: () => ({ token: 'tok_test' }),
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

describe('Venta — in-cart stepper caps at physical stock', () => {
  beforeEach(() => {
    window.innerWidth = 1280; // desktop two-pane renders CartItemRow directly
    cartMock.selectedClient = maria; // past the ClientGate
  });

  test('physical=5, 5 in cart → "+" disabled (cap = physical 5)', () => {
    productsMock.current = [makeProduct({ stock: 5 })];
    cartMock.cart = [cartLine(5, { stock: 5 })];
    render(<SaleScreen onConfirm={vi.fn()} />);
    expect(plusInRow()).toHaveProperty('disabled', true);
    // Cashier-facing cap hint reflects the physical stock.
    expect(within(cartRow()).getByText('Máx. 5 en stock')).toBeDefined();
  });

  test('physical=5, 4 in cart → "+" enabled (can reach the physical cap of 5)', () => {
    productsMock.current = [makeProduct({ stock: 5 })];
    cartMock.cart = [cartLine(4, { stock: 5 })];
    render(<SaleScreen onConfirm={vi.fn()} />);
    expect(plusInRow()).toHaveProperty('disabled', false);
  });

  test('typing 9 into the qty input clamps to the physical 5', async () => {
    const user = userEvent.setup();
    productsMock.current = [makeProduct({ stock: 5 })];
    cartMock.cart = [cartLine(2, { stock: 5 })];
    render(<SaleScreen onConfirm={vi.fn()} />);

    const input = cartRow().querySelector<HTMLInputElement>('.qty-input')!;
    await user.clear(input);
    await user.type(input, '9');
    // The input clamps the display to the physical cap (5), never above stock.
    expect(input.value).toBe('5');
  });

  test('reserved no longer lowers the cap: physical=5, reserved=1, 4 in cart → "+" still enabled up to physical 5', () => {
    productsMock.current = [makeProduct({ stock: 5 })];
    cartMock.reserved = { p_cola: 1 }; // ignored now — stock is live for everyone
    cartMock.cart = [cartLine(4, { stock: 5 })];
    render(<SaleScreen onConfirm={vi.fn()} />);
    // Before Phase 2 the cap was 4 (5 − 1 reserved) and "+" was disabled; now
    // the reserved term is gone, so the cap is the physical 5 and "+" is enabled.
    expect(plusInRow()).toHaveProperty('disabled', false);
  });
});
