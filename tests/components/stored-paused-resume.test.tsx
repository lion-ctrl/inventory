// @vitest-environment jsdom
// Resuming a held cart that contains PAUSED products (live product.sellable ===
// false). BEFORE navigating to Venta, when the held cart has paused product(s)
// the screen shows a PRE-confirm dialog ("Productos pausados") naming them:
//   - "Continuar" → proceeds into the existing sale-in-progress resume guard
//     (resumeSale directly when nothing is in progress, or the guard otherwise).
//   - "Cancelar"  → does NOTHING (held cart intact, current sale untouched, no nav).
// If NO line is paused, there is no pre-confirm and the screen composes with the
// existing resume guard exactly as before. The all-paused case still RESUMES
// (cart lands EMPTY) on Continuar — it does NOT block. The post-resume modal on
// Venta (driven by pausedRemovals) is unchanged and covered elsewhere.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Client, HeldCart, Product } from '@/types';

const { navigateMock, cartMock, productsMock } = vi.hoisted(() => {
  const cartMock: {
    cart: unknown[];
    selectedClient: Client | null;
    heldCarts: HeldCart[];
    resumeSale: ReturnType<typeof vi.fn>;
    pauseSale: ReturnType<typeof vi.fn>;
    discardSale: ReturnType<typeof vi.fn>;
    discardStored: ReturnType<typeof vi.fn>;
  } = {
    cart: [],
    selectedClient: null,
    heldCarts: [],
    resumeSale: vi.fn(async () => {}),
    pauseSale: vi.fn(async () => {}),
    discardSale: vi.fn(() => {}),
    discardStored: vi.fn(async () => {}),
  };
  const productsMock: { current: Product[] } = { current: [] };
  return { navigateMock: vi.fn(), cartMock, productsMock };
});

vi.mock('react-router', () => ({ useNavigate: () => navigateMock }));
vi.mock('@/state/useOnline', () => ({ useOnline: () => true }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useSettingsDoc: () => null,
  useProducts: () => productsMock.current,
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => cartMock }));

import StoredCartsScreen from '@/screens/Stored';

const makeProd = (over: Record<string, unknown>): Product =>
  ({
    _id: 'p1',
    _creationTime: 0,
    name: 'Producto',
    sku: 'SKU',
    barcode: '1',
    price: 1,
    stock: 5,
    glyph: '📦',
    categoryId: 'cat1',
    minStock: 5,
    sellable: true,
    exempt: false,
    createdAt: 0,
    ...over,
  }) as unknown as Product;

// Held cart with three lines (productId + snapshot name, as stored server-side).
const held3 = {
  _id: 'h1',
  _creationTime: 0,
  code: '1001',
  createdAt: Date.now(),
  total: 6,
  items: [
    {
      productId: 'p1',
      name: 'Agua 1L',
      sku: 'AGUA',
      price: 1,
      qty: 1,
      glyph: '💧',
    },
    { productId: 'p2', name: 'Pan', sku: 'PAN', price: 2, qty: 1, glyph: '🍞' },
    {
      productId: 'p3',
      name: 'Café',
      sku: 'CAFE',
      price: 3,
      qty: 1,
      glyph: '☕',
    },
  ],
  splits: [],
  client: null,
} as unknown as HeldCart;

const inProgressLine = { _id: 'p_other', qty: 1 } as unknown;

beforeEach(() => {
  navigateMock.mockReset();
  cartMock.cart = [];
  cartMock.selectedClient = null;
  cartMock.heldCarts = [held3];
  cartMock.resumeSale = vi.fn(async () => {});
  cartMock.pauseSale = vi.fn(async () => {});
  cartMock.discardSale = vi.fn(() => {});
  cartMock.discardStored = vi.fn(async () => {});
  productsMock.current = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const reanudar = () => screen.getAllByRole('button', { name: 'Reanudar' })[0];
const preConfirmTitle = () => screen.queryByText('Productos pausados');
const continuar = () => screen.getByRole('button', { name: 'Continuar' });
const cancelar = () => screen.getByRole('button', { name: 'Cancelar' });

describe('StoredCartsScreen — paused-product PRE-confirm before resume', () => {
  test('SOME paused → pre-confirm names the paused items; Continuar proceeds (resumes directly when nothing in progress)', async () => {
    const user = userEvent.setup();
    // p1 paused, p2 + p3 sellable → 1 of 3 paused → pre-confirm shows.
    productsMock.current = [
      makeProd({ _id: 'p1', name: 'Agua 1L', sellable: false }),
      makeProd({ _id: 'p2', name: 'Pan' }),
      makeProd({ _id: 'p3', name: 'Café' }),
    ];
    render(<StoredCartsScreen />);

    await user.click(reanudar());

    // Pre-confirm dialog appears: intro line + the paused name as a list item +
    // closing line. Nothing resumed yet.
    expect(preConfirmTitle()).not.toBeNull();
    expect(
      screen.getByText('Esta venta tiene producto(s) pausado(s):')
    ).toBeDefined();
    expect(screen.getByText('Agua 1L')).toBeDefined();
    expect(screen.getByText(/¿Deseas continuar\?/)).toBeDefined();
    expect(cartMock.resumeSale).not.toHaveBeenCalled();

    await user.click(continuar());

    // Nothing in progress → proceeds straight into resume.
    await waitFor(() => expect(cartMock.resumeSale).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/venta'));
  });

  test('SOME paused → Cancelar does nothing: held cart intact, no resume, no navigation', async () => {
    const user = userEvent.setup();
    productsMock.current = [
      makeProd({ _id: 'p1', name: 'Agua 1L', sellable: false }),
      makeProd({ _id: 'p2', name: 'Pan' }),
      makeProd({ _id: 'p3', name: 'Café' }),
    ];
    render(<StoredCartsScreen />);

    await user.click(reanudar());
    expect(preConfirmTitle()).not.toBeNull();

    await user.click(cancelar());

    expect(preConfirmTitle()).toBeNull();
    expect(cartMock.resumeSale).not.toHaveBeenCalled();
    expect(cartMock.pauseSale).not.toHaveBeenCalled();
    expect(cartMock.discardSale).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('multiple paused → pre-confirm lists each paused name as its own list item', async () => {
    const user = userEvent.setup();
    // p1 + p3 paused, p2 sellable → both paused names listed.
    productsMock.current = [
      makeProd({ _id: 'p1', name: 'Agua 1L', sellable: false }),
      makeProd({ _id: 'p2', name: 'Pan' }),
      makeProd({ _id: 'p3', name: 'Café', sellable: false }),
    ];
    render(<StoredCartsScreen />);

    await user.click(reanudar());

    expect(
      screen.getByText('Esta venta tiene producto(s) pausado(s):')
    ).toBeDefined();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toContain('Agua 1L');
    expect(items).toContain('Café');
  });

  test('ALL paused → same pre-confirm; Continuar resumes (cart lands EMPTY); does NOT block', async () => {
    const user = userEvent.setup();
    cartMock.heldCarts = [
      {
        ...held3,
        items: [
          { productId: 'p1', name: 'Agua 1L', price: 1, qty: 1, glyph: '💧' },
          { productId: 'p2', name: 'Pan', price: 2, qty: 1, glyph: '🍞' },
        ],
      } as unknown as HeldCart,
    ];
    productsMock.current = [
      makeProd({ _id: 'p1', name: 'Agua 1L', sellable: false }),
      makeProd({ _id: 'p2', name: 'Pan', sellable: false }),
    ];
    render(<StoredCartsScreen />);

    await user.click(reanudar());

    // It is a confirm — NOT a hard block.
    expect(preConfirmTitle()).not.toBeNull();
    expect(screen.queryByText('No se puede reanudar')).toBeNull();
    expect(
      screen.getByText('Esta venta tiene producto(s) pausado(s):')
    ).toBeDefined();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toContain('Agua 1L');
    expect(items).toContain('Pan');

    await user.click(continuar());

    // Resumes anyway — resumeSale drops the (all) paused lines → cart lands EMPTY.
    await waitFor(() => expect(cartMock.resumeSale).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/venta'));
  });

  test('SOME paused + sale in progress → Continuar shows the existing resume guard (does not resume yet)', async () => {
    const user = userEvent.setup();
    cartMock.cart = [inProgressLine]; // a sale is already in progress
    productsMock.current = [
      makeProd({ _id: 'p1', name: 'Agua 1L', sellable: false }),
      makeProd({ _id: 'p2', name: 'Pan' }),
      makeProd({ _id: 'p3', name: 'Café' }),
    ];
    render(<StoredCartsScreen />);

    await user.click(reanudar());

    // Pre-confirm comes FIRST (before the in-progress guard).
    expect(preConfirmTitle()).not.toBeNull();
    expect(screen.queryByText('Tienes una venta en curso')).toBeNull();

    await user.click(continuar());

    // Now the existing sale-in-progress guard appears; resume still awaits a choice.
    expect(screen.queryByText('Tienes una venta en curso')).not.toBeNull();
    expect(cartMock.resumeSale).not.toHaveBeenCalled();
  });

  test('NO paused → no pre-confirm; resumes directly when nothing is in progress', async () => {
    const user = userEvent.setup();
    productsMock.current = [
      makeProd({ _id: 'p1', name: 'Agua 1L' }),
      makeProd({ _id: 'p2', name: 'Pan' }),
      makeProd({ _id: 'p3', name: 'Café' }),
    ];
    render(<StoredCartsScreen />);

    await user.click(reanudar());

    expect(preConfirmTitle()).toBeNull();
    expect(screen.queryByText('No se puede reanudar')).toBeNull();
    await waitFor(() => expect(cartMock.resumeSale).toHaveBeenCalledWith('h1'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/venta'));
  });

  test('NO paused + sale in progress → no pre-confirm; goes straight to the existing resume guard', async () => {
    const user = userEvent.setup();
    cartMock.cart = [inProgressLine];
    productsMock.current = [
      makeProd({ _id: 'p1', name: 'Agua 1L' }),
      makeProd({ _id: 'p2', name: 'Pan' }),
      makeProd({ _id: 'p3', name: 'Café' }),
    ];
    render(<StoredCartsScreen />);

    await user.click(reanudar());

    expect(preConfirmTitle()).toBeNull();
    expect(screen.queryByText('Tienes una venta en curso')).not.toBeNull();
    expect(cartMock.resumeSale).not.toHaveBeenCalled();
  });
});
