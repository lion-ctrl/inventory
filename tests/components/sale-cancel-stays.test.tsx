// @vitest-environment jsdom
// Cancelar/Cerrar on the Venta screen must DISCARD the in-progress sale and
// STAY on Venta (re-showing the ClientGate), NOT navigate home ('/'). Owner
// request: after cancel/close the cashier starts a fresh sale with a new (or
// the same) client without leaving the screen.
//
// We assert the behavioral contract: discardSale() IS called and the navigate
// spy is NOT. discardSale (real CartContext) clears cart + splits + client, so
// the screen re-renders into the ClientGate; a dedicated case below proves the
// ClientGate ("Identificar al cliente") renders on the SAME Venta screen.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CartItem, Client, Product } from '@/types';

const { cartMock, productsMock, navigateMock } = vi.hoisted(() => {
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
  const navigateMock = vi.fn();
  return { cartMock, productsMock, navigateMock };
});

vi.mock('react-router', () => ({ useNavigate: () => navigateMock }));
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
  useSettingsDoc: () => ({ ivaPct: 13, scannerMode: 'scanner' }),
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

describe('Venta — Cancelar/Cerrar discards in place (no navigate home)', () => {
  describe('desktop (two-pane)', () => {
    beforeEach(() => {
      window.innerWidth = 1280;
      cartMock.selectedClient = maria; // past the ClientGate
    });

    test('items in cart → Cancelar → confirm: discardSale called, navigate NOT called', async () => {
      const user = userEvent.setup();
      cartMock.cart = [cartLine(2)];
      render(<SaleScreen onConfirm={vi.fn()} />);

      // The in-cart "Cancelar" opens the confirm dialog.
      await user.click(screen.getByRole('button', { name: 'Cancelar' }));
      // With items in the cart the copy warns about losing the products.
      expect(
        screen.getByText('Se perderán los productos del carrito.')
      ).toBeDefined();
      // Confirm with "Sí".
      await user.click(screen.getByRole('button', { name: 'Sí' }));

      expect(cartMock.discardSale).toHaveBeenCalledTimes(1);
      expect(navigateMock).not.toHaveBeenCalled();
    });

    test('empty cart → Cerrar → confirm dialog appears, discards only after confirm, navigate NOT called', async () => {
      const user = userEvent.setup();
      cartMock.cart = []; // empty cart shows the "Cerrar" foot button
      render(<SaleScreen onConfirm={vi.fn()} />);

      // The empty-cart "Cerrar" foot button must open the confirm dialog —
      // it must NOT discard immediately (previously it did).
      await user.click(screen.getByRole('button', { name: 'Cerrar' }));
      expect(cartMock.discardSale).not.toHaveBeenCalled();

      // The dialog shows the empty-appropriate copy (not the cart-items copy).
      expect(
        screen.getByText(
          'Se descartará la venta actual y volverás a identificar al cliente.'
        )
      ).toBeDefined();
      expect(
        screen.queryByText('Se perderán los productos del carrito.')
      ).toBeNull();

      // Only after confirming with "Sí" does the sale discard — in place, no nav.
      await user.click(screen.getByRole('button', { name: 'Sí' }));
      expect(cartMock.discardSale).toHaveBeenCalledTimes(1);
      expect(navigateMock).not.toHaveBeenCalled();
    });

    test('empty cart → Cerrar → cancel dialog ("No"): does NOT discard, stays in the sale', async () => {
      const user = userEvent.setup();
      cartMock.cart = [];
      render(<SaleScreen onConfirm={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Cerrar' }));
      // Dismiss the dialog with "No" — nothing discards, no navigation.
      await user.click(screen.getByRole('button', { name: 'No' }));

      expect(cartMock.discardSale).not.toHaveBeenCalled();
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  describe('mobile (single column)', () => {
    beforeEach(() => {
      window.innerWidth = 480;
      cartMock.selectedClient = maria; // past the ClientGate
    });

    test('items in cart → Cancelar → confirm: discardSale called, navigate NOT called', async () => {
      const user = userEvent.setup();
      cartMock.cart = [cartLine(2)];
      render(<SaleScreen onConfirm={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Cancelar' }));
      await user.click(screen.getByRole('button', { name: 'Sí' }));

      expect(cartMock.discardSale).toHaveBeenCalledTimes(1);
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  describe('after the client is cleared the ClientGate shows in place', () => {
    // discardSale (real CartContext) clears the selected client; once it is
    // null the Venta screen re-renders straight into the ClientGate — proving
    // the cashier lands on the cédula entry on the SAME screen, not home.
    test('desktop: no selected client → ClientGate ("Identificar al cliente") on the Venta screen', () => {
      window.innerWidth = 1280;
      cartMock.selectedClient = null;
      render(<SaleScreen onConfirm={vi.fn()} />);
      // The Venta AppBar is still present (we did not navigate away)…
      expect(screen.getByText('Nueva venta')).toBeDefined();
      // …and the ClientGate cédula/RIF entry is shown.
      expect(screen.getByText('Identificar al cliente')).toBeDefined();
      expect(navigateMock).not.toHaveBeenCalled();
    });

    test('mobile: no selected client → ClientGate on the Venta screen', () => {
      window.innerWidth = 480;
      cartMock.selectedClient = null;
      render(<SaleScreen onConfirm={vi.fn()} />);
      expect(screen.getByText('Nueva venta')).toBeDefined();
      expect(screen.getByText('Identificar al cliente')).toBeDefined();
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });
});

// Keep `within` referenced (test-helper parity with sibling Sale specs); used
// defensively if scoping is later needed without re-importing.
void within;
