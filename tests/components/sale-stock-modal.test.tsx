// @vitest-environment jsdom
// Venta MODAL for cart lines reconciled against LIVE stock when a held sale is
// RESUMED (reserved removal, Phase 5). Parked carts reserve nothing, so units may
// have been sold while the sale sat: the line is dropped ('gone', danger red) or
// clamped to what's left ('reduced', warn terracotta). The reconciliation itself
// lives in CartContext.resumeSale (covered in contexts.test.tsx). Here we assert
// the acknowledge MODAL renders the color-coded rows (product name + severity copy)
// in BOTH layouts and that "Entendido" dismisses it. Sibling of sale-paused-modal.
import { cleanup, render, screen } from '@testing-library/react';
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
    pauseSale: ReturnType<typeof vi.fn>;
    pausedRemovals: string[];
    dismissPausedRemovals: ReturnType<typeof vi.fn>;
    stockAdjustments: { name: string; kind: 'gone' | 'reduced'; left: number }[];
    dismissStockAdjustments: ReturnType<typeof vi.fn>;
  } = {
    cart: [],
    setCart: vi.fn(),
    selectedClient: null,
    setSelectedClientId: vi.fn(),
    splits: [],
    resetPayment: vi.fn(),
    discardSale: vi.fn(),
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

const maria = {
  _id: 'c_maria',
  name: 'María',
  taxPrefix: 'V',
  taxId: '1',
  kind: 'person',
  createdAt: 0,
} as unknown as Client;

beforeEach(() => {
  cartMock.cart = [];
  cartMock.selectedClient = maria; // past the ClientGate
  cartMock.pausedRemovals = [];
  cartMock.dismissPausedRemovals = vi.fn();
  cartMock.stockAdjustments = [];
  cartMock.dismissStockAdjustments = vi.fn();
  productsMock.current = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const entendido = () => screen.getByRole('button', { name: 'Entendido' });

describe('Venta — stock-adjustment modal (desktop layout)', () => {
  beforeEach(() => {
    window.innerWidth = 1280;
  });

  test('a clamped line shows the product name + "solo quedan N" copy; Entendido dismisses', async () => {
    const user = userEvent.setup();
    cartMock.stockAdjustments = [
      { name: 'Coca-Cola 600ml', kind: 'reduced', left: 3 },
    ];
    render(<SaleScreen onConfirm={vi.fn()} />);

    expect(screen.getByText('Stock actualizado')).toBeDefined();
    // Name and severity copy are separate elements now (color-coded row).
    expect(screen.getByText('Coca-Cola 600ml')).toBeDefined();
    expect(
      screen.getByText('Solo quedan 3 — se ajustó la cantidad')
    ).toBeDefined();

    await user.click(entendido());
    expect(cartMock.dismissStockAdjustments).toHaveBeenCalledTimes(1);
  });

  test('a sold-out line shows the product name + "ya no hay stock" copy', () => {
    cartMock.stockAdjustments = [{ name: 'Agua 1L', kind: 'gone', left: 0 }];
    render(<SaleScreen onConfirm={vi.fn()} />);

    expect(screen.getByText('Stock actualizado')).toBeDefined();
    expect(screen.getByText('Agua 1L')).toBeDefined();
    expect(
      screen.getByText('Ya no hay stock — se quitó de la venta')
    ).toBeDefined();
  });

  test('no adjustments → no modal', () => {
    cartMock.stockAdjustments = [];
    render(<SaleScreen onConfirm={vi.fn()} />);
    expect(screen.queryByText('Stock actualizado')).toBeNull();
  });
});

describe('Venta — stock-adjustment modal (mobile layout)', () => {
  beforeEach(() => {
    window.innerWidth = 375;
  });

  test('empty cart on mobile → both rows render (all-sold-out + clamped resume case)', () => {
    cartMock.cart = [];
    cartMock.stockAdjustments = [
      { name: 'Cemento gris', kind: 'gone', left: 0 },
      { name: 'Coca-Cola 600ml', kind: 'reduced', left: 2 },
    ];
    render(<SaleScreen onConfirm={vi.fn()} />);

    expect(screen.getByText('Stock actualizado')).toBeDefined();
    // One list item per adjustment, each with its own name + severity copy.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Cemento gris')).toBeDefined();
    expect(
      screen.getByText('Ya no hay stock — se quitó de la venta')
    ).toBeDefined();
    expect(screen.getByText('Coca-Cola 600ml')).toBeDefined();
    expect(
      screen.getByText('Solo quedan 2 — se ajustó la cantidad')
    ).toBeDefined();
  });
});
