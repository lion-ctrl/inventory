// @vitest-environment jsdom
// Phase 6.5 — AppShell offline-checkout integration. OFFLINE, confirming the
// payment must QUEUE a durable SALE_CREATE (never call the online `checkout`),
// set a PENDING_SYNC receipt, and route to /venta/exito. Drives the two REAL
// handlers (handleSaleConfirm → handlePaymentConfirm) through mocked screen leaves
// that expose their onConfirm callbacks as buttons. `buildOfflineSale` runs for
// real, so the queued payload's shape (incl. the captured rate/IVA) is asserted.
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const H = vi.hoisted(() => {
  const cart: {
    selectedClient: unknown;
    heldCarts: unknown[];
    completedSale: unknown;
    setCompletedSale: ReturnType<typeof vi.fn>;
    setCart: ReturnType<typeof vi.fn>;
    setSelectedClientId: ReturnType<typeof vi.fn>;
    resetPayment: ReturnType<typeof vi.fn>;
  } = {
    selectedClient: null,
    heldCarts: [],
    completedSale: null,
    setCompletedSale: vi.fn(),
    setCart: vi.fn(),
    setSelectedClientId: vi.fn(),
    resetPayment: vi.fn(),
  };
  return {
    navigate: vi.fn(),
    enqueue: vi.fn(
      (_type: string, _payload: unknown): Promise<number> => Promise.resolve(1)
    ),
    checkout: vi.fn(async () => ({ invoiceNumber: '00000001' })),
    cartDraftDelete: vi.fn(),
    cart,
  };
});

vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => H.navigate,
}));
vi.mock('convex/react', () => ({ useMutation: () => H.checkout }));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({
    user: { name: 'Carlos', permissions: 'all', active: true },
    token: 'tok',
    loading: false,
    can: () => true,
    logout: vi.fn(),
  }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => H.cart }));
vi.mock('@/state/useOnline', () => ({ useOnline: () => false })); // OFFLINE
vi.mock('@/state/useSyncEngine', () => ({ useSyncEngine: () => {} }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 36,
  useSettingsDoc: () => ({ ivaPct: 13 }),
}));
vi.mock('@/state/pendingOps', () => ({ enqueuePendingOp: H.enqueue }));
vi.mock('@/state/db', () => ({
  db: { cartDraft: { delete: H.cartDraftDelete } },
}));
vi.mock('@/components', () => ({
  NavLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConfirmDialog: () => null,
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/screens/Sale', () => ({
  default: ({
    onConfirm,
  }: {
    onConfirm: (items: unknown[], total: number) => void;
  }) => (
    <button
      onClick={() =>
        onConfirm(
          [
            {
              _id: 'p_cola',
              name: 'Coca-Cola 600ml',
              sku: 'COCA',
              barcode: '1',
              price: 1.5,
              qty: 2,
              glyph: '🥤',
              exempt: false,
            },
          ],
          3.39
        )
      }
    >
      sale-confirm
    </button>
  ),
}));
vi.mock('@/screens/Payment', () => ({
  PaymentSheet: ({
    onConfirm,
  }: {
    onConfirm: (m: string, t: number, s: unknown[]) => void;
  }) => (
    <button
      onClick={() => onConfirm('cash', 5, [{ method: 'cash', amount: 3.39 }])}
    >
      pay-confirm
    </button>
  ),
  SuccessScreen: () => <div>success-screen</div>,
}));

import AppShell from '@/AppShell';

const maria = {
  _id: 'c_maria',
  name: 'María',
  taxPrefix: 'V',
  taxId: '1',
  kind: 'person',
};

beforeEach(() => {
  H.navigate.mockClear();
  H.enqueue.mockClear();
  H.checkout.mockClear();
  H.cart.selectedClient = maria;
  H.cart.heldCarts = [];
  H.cart.setCompletedSale = vi.fn();
});
afterEach(() => cleanup());

describe('AppShell — offline checkout (§6.5)', () => {
  test('offline payment QUEUES a SALE_CREATE (never checkout) and routes to a PENDING_SYNC receipt', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/venta']}>
        <AppShell />
      </MemoryRouter>
    );

    // Open the payment step (Venta "Cobrar"), then confirm the payment.
    await user.click(screen.getByRole('button', { name: 'sale-confirm' }));
    await user.click(screen.getByRole('button', { name: 'pay-confirm' }));

    // The ONLINE checkout mutation was never called.
    expect(H.checkout).not.toHaveBeenCalled();

    // A durable SALE_CREATE was queued, carrying the rate/IVA captured at sale time.
    expect(H.enqueue).toHaveBeenCalledTimes(1);
    expect(H.enqueue.mock.calls[0][0]).toBe('SALE_CREATE');
    expect(H.enqueue.mock.calls[0][1]).toMatchObject({
      clientId: 'c_maria',
      items: [{ productId: 'p_cola', qty: 2 }],
      ivaPct: 13,
      exchangeRate: 36,
    });

    // A PENDING_SYNC receipt was set and we routed to the success screen.
    expect(H.cart.setCompletedSale).toHaveBeenCalledWith(
      expect.objectContaining({ pendingSync: true, invoice: null })
    );
    expect(H.navigate).toHaveBeenCalledWith('/venta/exito');
  });
});
