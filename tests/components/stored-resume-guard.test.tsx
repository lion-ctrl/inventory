// @vitest-environment jsdom
// StoredCartsScreen "Reanudar" guard: resuming a held cart while a sale is in
// progress must NOT silently overwrite/lose the in-progress sale. The guard
// intercepts both Reanudar entry points (list card + detail sheet).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Client, HeldCart } from '@/types';

// Hoisted so the vi.mock factories can reference them (vitest hoists vi.mock).
const { navigateMock, cartMock } = vi.hoisted(() => {
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
  return { navigateMock: vi.fn(), cartMock };
});

vi.mock('react-router', () => ({ useNavigate: () => navigateMock }));
vi.mock('@/state/useOnline', () => ({ useOnline: () => true }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useSettingsDoc: () => null,
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => cartMock }));

import StoredCartsScreen from '@/screens/Stored';

const held = {
  _id: 'h1',
  _creationTime: 0,
  code: '1001',
  createdAt: Date.now(),
  total: 10,
  items: [
    {
      productId: 'p_cola',
      name: 'Coca-Cola 600ml',
      sku: 'COCA',
      price: 1.5,
      qty: 2,
      glyph: '🥤',
    },
  ],
  splits: [],
  client: null,
} as unknown as HeldCart;

const maria = {
  _id: 'c_maria',
  _creationTime: 0,
  name: 'María González',
  taxPrefix: 'V',
  taxId: '5.123.456',
  kind: 'person',
  createdAt: 0,
} as unknown as Client;

// A minimal "current in-progress sale" line — Stored only reads cart.length.
const inProgressLine = { _id: 'p_cola', qty: 1 } as unknown;

beforeEach(() => {
  navigateMock.mockReset();
  cartMock.cart = [];
  cartMock.selectedClient = null;
  cartMock.heldCarts = [held];
  cartMock.resumeSale = vi.fn(async () => {});
  cartMock.pauseSale = vi.fn(async () => {});
  cartMock.discardSale = vi.fn(() => {});
  cartMock.discardStored = vi.fn(async () => {});
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const dialogTitle = () => screen.queryByText('Tienes una venta en curso');
const reanudar = () => screen.getByRole('button', { name: 'Reanudar' });
const pauseBtn = () =>
  screen.getByRole('button', { name: 'Pausar y reanudar' });
const discardBtn = () =>
  screen.getByRole('button', { name: 'Descartar y reanudar' });
const cancelBtn = () => screen.getByRole('button', { name: 'Cancelar' });

describe('StoredCartsScreen — resume guard', () => {
  test('empty cart and no client → Reanudar resumes directly, no dialog', async () => {
    const user = userEvent.setup();
    render(<StoredCartsScreen />);

    await user.click(reanudar());

    await waitFor(() => expect(cartMock.resumeSale).toHaveBeenCalledWith('h1'));
    expect(dialogTitle()).toBeNull();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/venta'));
    expect(cartMock.pauseSale).not.toHaveBeenCalled();
    expect(cartMock.discardSale).not.toHaveBeenCalled();
  });

  test('sale with items → dialog shows THREE actions; Pausar y reanudar parks THEN resumes', async () => {
    const user = userEvent.setup();
    cartMock.cart = [inProgressLine];
    render(<StoredCartsScreen />);

    await user.click(reanudar());

    expect(dialogTitle()).not.toBeNull();
    expect(pauseBtn()).toBeDefined();
    expect(discardBtn()).toBeDefined();
    expect(cancelBtn()).toBeDefined();
    expect(cartMock.resumeSale).not.toHaveBeenCalled(); // awaiting the choice

    await user.click(pauseBtn());

    await waitFor(() => expect(cartMock.resumeSale).toHaveBeenCalledWith('h1'));
    expect(cartMock.pauseSale).toHaveBeenCalledTimes(1);
    // Order matters: park the current sale BEFORE overwriting it.
    expect(cartMock.pauseSale.mock.invocationCallOrder[0]).toBeLessThan(
      cartMock.resumeSale.mock.invocationCallOrder[0]
    );
    expect(cartMock.discardSale).not.toHaveBeenCalled();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/venta'));
  });

  test('sale with items → Descartar y reanudar discards THEN resumes', async () => {
    const user = userEvent.setup();
    cartMock.cart = [inProgressLine];
    render(<StoredCartsScreen />);

    await user.click(reanudar());
    await user.click(discardBtn());

    await waitFor(() => expect(cartMock.resumeSale).toHaveBeenCalledWith('h1'));
    expect(cartMock.discardSale).toHaveBeenCalledTimes(1);
    expect(cartMock.discardSale.mock.invocationCallOrder[0]).toBeLessThan(
      cartMock.resumeSale.mock.invocationCallOrder[0]
    );
    expect(cartMock.pauseSale).not.toHaveBeenCalled();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/venta'));
  });

  test('sale with items → Cancelar closes the dialog and touches nothing', async () => {
    const user = userEvent.setup();
    cartMock.cart = [inProgressLine];
    render(<StoredCartsScreen />);

    await user.click(reanudar());
    expect(dialogTitle()).not.toBeNull();

    await user.click(cancelBtn());

    expect(dialogTitle()).toBeNull();
    expect(cartMock.resumeSale).not.toHaveBeenCalled();
    expect(cartMock.pauseSale).not.toHaveBeenCalled();
    expect(cartMock.discardSale).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('pauseSale rejects → ABORT: resumeSale is never called, current sale not lost', async () => {
    const user = userEvent.setup();
    cartMock.cart = [inProgressLine];
    // Simulate the server park() rejection (ConvexError-shaped: `.data` string).
    cartMock.pauseSale = vi
      .fn()
      .mockRejectedValue({ data: 'No hay productos en el carrito.' });
    render(<StoredCartsScreen />);

    await user.click(reanudar());
    await user.click(pauseBtn());

    await waitFor(() => expect(cartMock.pauseSale).toHaveBeenCalledTimes(1));
    expect(cartMock.resumeSale).toHaveBeenCalledTimes(0);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalled();
    // Dialog stays open so the cashier can retry or cancel — nothing lost.
    expect(dialogTitle()).not.toBeNull();
  });

  test('only a client (empty cart) → dialog has TWO actions, NO Pausar', async () => {
    const user = userEvent.setup();
    cartMock.cart = [];
    cartMock.selectedClient = maria;
    render(<StoredCartsScreen />);

    await user.click(reanudar());

    expect(dialogTitle()).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Pausar y reanudar' })
    ).toBeNull();
    expect(discardBtn()).toBeDefined();
    expect(cancelBtn()).toBeDefined();

    await user.click(discardBtn());

    await waitFor(() => expect(cartMock.resumeSale).toHaveBeenCalledWith('h1'));
    expect(cartMock.discardSale).toHaveBeenCalledTimes(1);
    expect(cartMock.discardSale.mock.invocationCallOrder[0]).toBeLessThan(
      cartMock.resumeSale.mock.invocationCallOrder[0]
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/venta'));
  });

  test('the detail-sheet Reanudar goes through the same guard', async () => {
    const user = userEvent.setup();
    cartMock.cart = [inProgressLine];
    render(<StoredCartsScreen />);

    await user.click(screen.getByRole('button', { name: /Ver productos/ }));
    const resumes = screen.getAllByRole('button', { name: 'Reanudar' });
    expect(resumes.length).toBeGreaterThanOrEqual(2);

    await user.click(resumes[resumes.length - 1]); // the sheet's button

    expect(dialogTitle()).not.toBeNull();
    expect(cartMock.resumeSale).not.toHaveBeenCalled();
  });
});
