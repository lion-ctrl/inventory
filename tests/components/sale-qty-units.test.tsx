// @vitest-environment jsdom
// Unit 3 — every quantity input follows the PRODUCT's base unit: a measured
// product accepts a fraction, a counted one keeps the digits-only behaviour it
// has always had, and one cart can hold both at once.
import { cleanup, fireEvent, render, within } from '@testing-library/react';
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
    stockAdjustments: unknown[];
    dismissStockAdjustments: ReturnType<typeof vi.fn>;
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
    stockAdjustments: [],
    dismissStockAdjustments: vi.fn(),
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
    stock: 20,
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

const cheese = {
  _id: 'p_queso',
  name: 'Queso amarillo',
  sku: 'QUESO',
  barcode: '7591000009090',
  price: 8,
  stock: 10,
  unit: 'kilogram',
} as unknown as Partial<Product>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cartMock.cart = [];
  cartMock.reserved = {};
  cartMock.selectedClient = null;
  cartMock.pausedRemovals = [];
  productsMock.current = [];
});

const rows = () => Array.from(document.querySelectorAll('.cartrow'));
const qtyInputIn = (row: Element) =>
  within(row as HTMLElement).getByLabelText('cantidad');
const rowNamed = (name: string) =>
  rows().find((r) => r.textContent?.includes(name))!;

// Unit 3 — product-base-unit. Whether a line accepts a fraction is decided by
// the PRODUCT's unit, so one cart can hold both kinds and each line enforces
// its own rule. This is the scenario the spec names explicitly.
describe('Venta — cantidades por unidad base', () => {
  beforeEach(() => {
    window.innerWidth = 1280; // desktop two-pane renders CartItemRow directly
    cartMock.selectedClient = maria;
  });

  test('a product measured in kilograms accepts 1.5', async () => {
    const user = userEvent.setup();
    cartMock.cart = [cartLine(1, cheese)];
    render(<SaleScreen onConfirm={vi.fn()} />);

    const input = qtyInputIn(rowNamed('Queso'));
    await user.clear(input);
    await user.type(input, '1.5');

    expect(cartMock.setCart).toHaveBeenCalled();
    expect(input).toHaveProperty('value', '1.5');
  });

  test('a comma is a decimal separator too — it is what the keyboard gives', async () => {
    const user = userEvent.setup();
    cartMock.cart = [cartLine(1, cheese)];
    render(<SaleScreen onConfirm={vi.fn()} />);

    const input = qtyInputIn(rowNamed('Queso'));
    await user.clear(input);
    await user.type(input, '2,5');
    fireEvent.blur(input);

    expect(input).toHaveProperty('value', '2.5');
  });

  test('a counted product still refuses a fraction, exactly as before', async () => {
    const user = userEvent.setup();
    cartMock.cart = [cartLine(1)];
    render(<SaleScreen onConfirm={vi.fn()} />);

    const input = qtyInputIn(rowNamed('Coca-Cola'));
    await user.clear(input);
    await user.type(input, '1.5');
    fireEvent.blur(input);

    // The separator is dropped and the digits stand: the pre-unit behaviour.
    expect(input).toHaveProperty('value', '15');
  });

  test('one cart holds both kinds, each enforcing its own rule', async () => {
    const user = userEvent.setup();
    cartMock.cart = [cartLine(1), cartLine(1, cheese)];
    render(<SaleScreen onConfirm={vi.fn()} />);

    const counted = qtyInputIn(rowNamed('Coca-Cola'));
    const weighed = qtyInputIn(rowNamed('Queso'));

    await user.clear(counted);
    await user.type(counted, '1.2');
    fireEvent.blur(counted);

    await user.clear(weighed);
    await user.type(weighed, '2.5');
    fireEvent.blur(weighed);

    // Digits only: 1.2 reads as twelve bottles, the pre-unit behaviour.
    expect(counted).toHaveProperty('value', '12');
    expect(weighed).toHaveProperty('value', '2.5');
  });

  test('the phone keypad offers a separator only where one is usable', () => {
    cartMock.cart = [cartLine(1), cartLine(1, cheese)];
    render(<SaleScreen onConfirm={vi.fn()} />);

    expect(qtyInputIn(rowNamed('Queso'))).toHaveProperty(
      'inputMode',
      'decimal'
    );
    expect(qtyInputIn(rowNamed('Coca-Cola'))).toHaveProperty(
      'inputMode',
      'numeric'
    );
  });
});
