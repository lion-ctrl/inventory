// @vitest-environment jsdom
// Stock visibility + availability (Venta). The displayed stock is PHYSICAL
// everywhere; a product reserved by held ("en espera") carts is soft-locked at
// SELL-TIME only — the number on screen never subtracts en-espera units.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Client, Product } from '@/types';

const { cartMock, productsMock } = vi.hoisted(() => {
  const cartMock: {
    cart: unknown[];
    setCart: ReturnType<typeof vi.fn>;
    selectedClient: Client | null;
    setSelectedClientId: ReturnType<typeof vi.fn>;
    splits: unknown[];
    resetPayment: ReturnType<typeof vi.fn>;
    discardSale: ReturnType<typeof vi.fn>;
    reserved: Record<string, number>;
    pauseSale: ReturnType<typeof vi.fn>;
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

import SaleScreen, {
  ManualSearchSheet,
  ProductFoundSheet,
} from '@/screens/Sale';

const makeProduct = (over: Partial<Product> = {}): Product =>
  ({
    _id: 'p_cola',
    _creationTime: 0,
    name: 'Coca-Cola 600ml',
    sku: 'COCA',
    barcode: '7591234567890',
    price: 1.5,
    stock: 1,
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cartMock.cart = [];
  cartMock.reserved = {};
  cartMock.selectedClient = null;
  productsMock.current = [];
});

const agregarBtn = () =>
  screen.getByRole('button', { name: /Agregar al carrito/ });
const plusBtn = () => screen.getByRole('button', { name: 'agregar uno' });

describe('Venta — ProductFoundSheet (physical display, net enforcement)', () => {
  test('physical=1, reserved=1 → "1 en stock" + "1 en espera"; Agregar disabled; banner names en espera; available-to-add 0', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 1 })}
        reservedUnits={1}
        currentCartQty={0}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('1 en stock')).toBeDefined(); // PHYSICAL, never net
    expect(screen.getByText('1 en espera')).toBeDefined();
    expect(agregarBtn()).toHaveProperty('disabled', true);
    expect(plusBtn()).toHaveProperty('disabled', true); // 0 available to add
    expect(screen.getByText(/no disponibles para esta venta/)).toBeDefined();
  });

  test('physical=3, reserved=1, 2 already in cart → Agregar disabled + en-espera banner (max(0,3-1-2)=0)', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 3 })}
        reservedUnits={1}
        currentCartQty={2}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('3 en stock')).toBeDefined(); // physical, not 0
    expect(agregarBtn()).toHaveProperty('disabled', true);
    expect(screen.getByText(/no disponibles para esta venta/)).toBeDefined();
  });

  test('physical=3, reserved=1, empty cart → can add up to 2; the 3rd is blocked with an en-espera message', async () => {
    const user = userEvent.setup();
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 3 })}
        reservedUnits={1}
        currentCartQty={0}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('3 en stock')).toBeDefined(); // physical
    expect(screen.getByText('1 en espera')).toBeDefined();
    expect(agregarBtn()).toHaveProperty('disabled', false); // 2 available
    await user.click(plusBtn()); // qty 1 → 2 (the cap)
    expect(plusBtn()).toHaveProperty('disabled', true); // the 3rd is blocked
    expect(screen.getByText(/no disponibles para esta venta/)).toBeDefined();
  });

  test('physical=3, reserved=0 → unchanged: Agregar enabled, no en-espera chip/banner', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 3 })}
        reservedUnits={0}
        currentCartQty={0}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('3 en stock')).toBeDefined();
    expect(agregarBtn()).toHaveProperty('disabled', false);
    expect(screen.queryByText(/en espera/)).toBeNull();
    expect(screen.queryByText(/no disponibles para esta venta/)).toBeNull();
  });
});

describe('Venta — ManualSearchSheet en-espera chip', () => {
  test('reserved>0 → physical "Máx. N en stock" + "N en espera"', () => {
    render(
      <ManualSearchSheet
        catalog={[makeProduct({ stock: 2 })]}
        reserved={{ p_cola: 1 }}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Máx. 2 en stock')).toBeDefined();
    expect(screen.getByText('1 en espera')).toBeDefined();
  });

  test('reserved=0 → no en-espera chip', () => {
    render(
      <ManualSearchSheet
        catalog={[makeProduct({ stock: 2 })]}
        reserved={{}}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText(/en espera/)).toBeNull();
  });
});

describe('Venta — catalog tile (full screen): physical stock + en-espera chip, not Agotado', () => {
  beforeEach(() => {
    window.innerWidth = 1280; // force the desktop two-pane layout
    cartMock.selectedClient = maria; // past the ClientGate
  });

  test('physical=1, reserved=1 → tile shows "Máx. 1 en stock" + "1 en espera", NOT "Agotado"', () => {
    productsMock.current = [makeProduct({ stock: 1 })];
    cartMock.reserved = { p_cola: 1 };
    render(<SaleScreen onConfirm={vi.fn()} />);
    const tile = screen
      .getByText('Coca-Cola 600ml')
      .closest('.quick-tile') as HTMLElement;
    expect(within(tile).getByText('Máx. 1 en stock')).toBeDefined();
    expect(within(tile).getByText('1 en espera')).toBeDefined();
    expect(within(tile).queryByText('Agotado')).toBeNull();
  });

  test('reserved=0 → tile has no en-espera chip', () => {
    productsMock.current = [makeProduct({ stock: 1 })];
    cartMock.reserved = {};
    render(<SaleScreen onConfirm={vi.fn()} />);
    const tile = screen
      .getByText('Coca-Cola 600ml')
      .closest('.quick-tile') as HTMLElement;
    expect(within(tile).queryByText(/en espera/)).toBeNull();
  });
});
