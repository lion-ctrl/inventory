// @vitest-environment jsdom
// The invoice carries NO per-method payment breakdown. How a sale was settled
// (splits: cash + card + mobile…) is internal bookkeeping — it stays on the sale
// document and surfaces in Historial, never on the customer's fiscal document.
// The only payment data the invoice prints is the authorization method header.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SuccessScreen } from '@/screens/Payment';
import type { SaleItemSnapshot } from '@/types';

vi.mock('@/state/hooks', () => ({
  useSettingsDoc: () => ({
    storeName: 'Mi Tienda',
    storeRif: 'J-123',
    address: '',
  }),
}));

/** Exempt so the receipt totals stay whole: grandTotal === the splits' sum. */
const items: SaleItemSnapshot[] = [
  {
    productId: 'p_agua',
    name: 'Agua mineral 1L',
    price: 1.46,
    qty: 1,
    exempt: true,
  } as unknown as SaleItemSnapshot,
];

const base = {
  invoice: '00000051',
  client: null,
  ivaPct: 13,
  // A round rate keeps the Bs assertions readable: 1 USD === Bs 100,00.
  bsRate: 100,
  online: true,
  total: 1.46,
  items,
  onNew: vi.fn(),
  onPrint: vi.fn(),
  onDash: vi.fn(),
};

afterEach(() => cleanup());

describe('SuccessScreen — the invoice omits the payment breakdown', () => {
  test('a sale settled across three methods prints none of them as lines', () => {
    render(
      <SuccessScreen
        {...base}
        method="cash"
        splits={[
          { method: 'cash', amount: 0.73 },
          { method: 'card', amount: 0.365 },
          { method: 'mobile', amount: 0.365 },
        ]}
      />
    );

    // "Efectivo" survives ONCE — the authorization header, a fiscal field.
    expect(screen.getAllByText('Efectivo')).toHaveLength(1);
    expect(screen.queryByText('Tarjeta')).toBeNull();
    expect(screen.queryByText('Pago móvil')).toBeNull();
    // …and no split amount is printed anywhere.
    expect(screen.queryByText('Bs 73,00')).toBeNull();
    expect(screen.queryAllByText('Bs 36,50')).toHaveLength(0);
    // The TOTAL is untouched.
    expect(screen.getAllByText('Bs 146,00').length).toBeGreaterThan(0);
  });

  test('a single-method sale is unchanged — header only, no payment line', () => {
    render(
      <SuccessScreen
        {...base}
        method="mobile"
        splits={[{ method: 'mobile', amount: 1.46 }]}
      />
    );

    expect(screen.getAllByText('Pago móvil')).toHaveLength(1);
  });
});
