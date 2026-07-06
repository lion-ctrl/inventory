// @vitest-environment jsdom
// Phase 10 — usePendingSales: turns the locally-queued SALE_CREATE ops into
// display-ready PENDING_SYNC sales, enriching the minimal payload (productId + qty)
// with mirrored product prices/names + the captured IVA to compute a total.
import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

const OPS = [
  {
    localId: 2,
    type: 'SALE_CREATE',
    status: 'pending',
    payload: {
      clientId: 'c_maria',
      items: [
        { productId: 'p_cola', qty: 2 }, // 1.50 each, taxable
        { productId: 'p_agua', qty: 1 }, // 0.80, exempt
      ],
      method: 'cash',
      ivaPct: 13,
      exchangeRate: 36,
      soldAt: 1_700_000_000_000,
    },
  },
];

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => OPS }));
vi.mock('@/state/db', () => ({
  db: {
    pendingOps: {
      where: () => ({ equals: () => ({ toArray: async () => OPS }) }),
    },
  },
}));
vi.mock('@/state/hooks', () => ({
  useProducts: () => [
    { _id: 'p_cola', name: 'Coca-Cola', price: 1.5, exempt: false },
    { _id: 'p_agua', name: 'Agua', price: 0.8, exempt: true },
  ],
  useClients: () => [{ _id: 'c_maria', name: 'María González' }],
}));

import { usePendingSales } from '@/state/usePendingSales';

describe('usePendingSales', () => {
  test('enriches a SALE_CREATE op into a PENDING_SYNC sale (total, count, client)', () => {
    const { result } = renderHook(() => usePendingSales());
    expect(result.current).toHaveLength(1);
    const ps = result.current[0];
    // subtotal 3.80 (2×1.50 + 0.80); taxable 3.00; IVA 13% = 0.39 → total 4.19.
    expect(ps.total).toBe(4.19);
    expect(ps.itemCount).toBe(3);
    expect(ps.clientName).toBe('María González');
    expect(ps.method).toBe('cash');
    expect(ps.status).toBe('pending');
    expect(ps.soldAt).toBe(1_700_000_000_000);
  });
});
