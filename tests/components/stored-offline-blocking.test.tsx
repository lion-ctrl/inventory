// @vitest-environment jsdom
// Phase 8 — StoredCartsScreen offline write-blocking. The held-carts list RENDERS
// offline (Dexie mirror), but park/resume/discard are server mutations, so their
// triggers are DISABLED offline with a "Sin conexión" affordance; online they work.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Client, HeldCart } from '@/types';

const { navigateMock, cartMock, onlineRef } = vi.hoisted(() => {
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
  return { navigateMock: vi.fn(), cartMock, onlineRef: { current: false } };
});

vi.mock('react-router', () => ({ useNavigate: () => navigateMock }));
vi.mock('@/state/useOnline', () => ({ useOnline: () => onlineRef.current }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useSettingsDoc: () => null,
  useProducts: () => [{ _id: 'p_cola', name: 'Coca-Cola 600ml', sellable: true }],
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
    { productId: 'p_cola', name: 'Coca-Cola 600ml', sku: 'COCA', price: 1.5, qty: 2, glyph: '🥤' },
  ],
  splits: [],
  client: null,
} as unknown as HeldCart;

const storedCard = () => document.querySelector('.stored-card') as HTMLElement;
const resumeBtn = () =>
  within(storedCard()).getByRole('button', { name: 'Reanudar' });
const discardBtn = () =>
  within(storedCard()).getByRole('button', { name: 'Descartar' });

beforeEach(() => {
  cartMock.heldCarts = [held];
  onlineRef.current = false;
});
afterEach(() => cleanup());

describe('StoredCartsScreen — offline write-blocking', () => {
  test('offline: Reanudar + Descartar are disabled and a "Sin conexión" banner shows', () => {
    onlineRef.current = false;
    render(<StoredCartsScreen />);
    expect(resumeBtn()).toHaveProperty('disabled', true);
    expect(discardBtn()).toHaveProperty('disabled', true);
    expect(screen.getByText(/son de solo lectura/)).toBeDefined();
  });

  test('online: Reanudar + Descartar are enabled and no offline banner', () => {
    onlineRef.current = true;
    render(<StoredCartsScreen />);
    expect(resumeBtn()).toHaveProperty('disabled', false);
    expect(discardBtn()).toHaveProperty('disabled', false);
    expect(screen.queryByText(/son de solo lectura/)).toBeNull();
  });
});
