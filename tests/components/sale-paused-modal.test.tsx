// @vitest-environment jsdom
// Venta MODAL for products auto-removed because their product was paused
// (sellable === false). The removal itself happens in CartContext (either live
// on the active cart, or while resuming a held cart). Here we only assert the
// acknowledge MODAL renders the neutral-Spanish copy in BOTH layouts and that
// "Entendido" dismisses it. Replaces the old dismissible banner (which failed
// to render because it sat inside a branch that didn't always mount).
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
  cartMock.reserved = {};
  cartMock.selectedClient = maria; // past the ClientGate
  cartMock.pausedRemovals = [];
  cartMock.dismissPausedRemovals = vi.fn();
  productsMock.current = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const entendido = () => screen.getByRole('button', { name: 'Entendido' });

describe('Venta — paused-removal modal (desktop layout)', () => {
  beforeEach(() => {
    window.innerWidth = 1280;
  });

  test('single removed → neutral-Spanish modal; Entendido dismisses it', async () => {
    const user = userEvent.setup();
    cartMock.pausedRemovals = ['Pintura blanca 1gal'];
    render(<SaleScreen onConfirm={vi.fn()} />);

    expect(screen.getByText('Productos pausados')).toBeDefined();
    // Singular intro line + the name on its own list item.
    expect(
      screen.getByText(
        'Este producto fue quitado de la venta porque está pausado:'
      )
    ).toBeDefined();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toContain('Pintura blanca 1gal');

    await user.click(entendido());
    expect(cartMock.dismissPausedRemovals).toHaveBeenCalledTimes(1);
  });

  test('no removals → no modal', () => {
    cartMock.pausedRemovals = [];
    render(<SaleScreen onConfirm={vi.fn()} />);
    expect(screen.queryByText('Productos pausados')).toBeNull();
    expect(
      screen.queryByText(/fue quitado de la venta|fueron quitados de la venta/)
    ).toBeNull();
  });
});

describe('Venta — paused-removal modal (mobile layout)', () => {
  beforeEach(() => {
    window.innerWidth = 375;
  });

  test('multiple removed → modal lists the names (plural copy)', () => {
    cartMock.pausedRemovals = ['Pintura blanca 1gal', 'Cemento gris'];
    render(<SaleScreen onConfirm={vi.fn()} />);

    expect(screen.getByText('Productos pausados')).toBeDefined();
    // Plural intro line + each name on its own list item.
    expect(
      screen.getByText(
        'Estos productos fueron quitados de la venta porque están pausados:'
      )
    ).toBeDefined();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toContain('Pintura blanca 1gal');
    expect(items).toContain('Cemento gris');
  });

  test('empty cart on mobile → modal still renders (covers the all-paused resume case)', () => {
    cartMock.cart = [];
    cartMock.pausedRemovals = ['Pintura blanca 1gal'];
    render(<SaleScreen onConfirm={vi.fn()} />);

    expect(screen.getByText('Productos pausados')).toBeDefined();
    expect(
      screen.getByText(
        'Este producto fue quitado de la venta porque está pausado:'
      )
    ).toBeDefined();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toContain('Pintura blanca 1gal');
  });
});
