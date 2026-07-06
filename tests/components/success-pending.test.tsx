// @vitest-environment jsdom
// Phase 6.5 — the SuccessScreen receipt for an OFFLINE sale. A sale queued offline
// has no server invoice # yet, so the receipt shows "Pendiente de sincronización"
// wherever the number would go; a synced (online) sale shows the invoice number.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SuccessScreen } from '@/screens/Payment';
import type { SaleItemSnapshot } from '@/types';

vi.mock('@/state/hooks', () => ({
  useSettingsDoc: () => ({ storeName: 'Mi Tienda', storeRif: 'J-123', address: '' }),
}));

const items: SaleItemSnapshot[] = [
  {
    productId: 'p_cola',
    name: 'Coca-Cola 600ml',
    price: 1.5,
    qty: 2,
    exempt: false,
  } as unknown as SaleItemSnapshot,
];

const base = {
  total: 3.39,
  items,
  method: 'cash',
  splits: [{ method: 'cash', amount: 3.39 }],
  client: null,
  ivaPct: 13,
  bsRate: 36,
  onNew: vi.fn(),
  onPrint: vi.fn(),
  onDash: vi.fn(),
};

afterEach(() => cleanup());

describe('SuccessScreen — PENDING_SYNC (offline sale)', () => {
  test('a pending offline sale shows "Pendiente de sincronización", never an invoice #', () => {
    render(
      <SuccessScreen {...base} invoice={null} pendingSync online={false} />
    );
    expect(
      screen.getAllByText(/Pendiente de sincronización/).length
    ).toBeGreaterThan(0);
    // No "N° <digits>" invoice label anywhere while pending.
    expect(screen.queryByText(/N°\s*\d/)).toBeNull();
  });

  test('a synced (online) sale shows the invoice number', () => {
    render(<SuccessScreen {...base} invoice="00000042" online />);
    expect(screen.getAllByText(/00000042/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Pendiente de sincronización/)).toBeNull();
  });
});
