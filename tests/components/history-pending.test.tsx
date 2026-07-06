// @vitest-environment jsdom
// Phase 10 — History offline. Official history is server-only (not mirrored), so
// offline it is unavailable; the locally-queued offline sales show in a separate
// "Pendientes de sincronización" section (PENDING_SYNC), and refund is blocked.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const H = vi.hoisted(() => ({
  navigate: vi.fn(),
  refund: vi.fn(),
  online: { current: false },
  pending: [] as unknown[],
}));

vi.mock('react-router', () => ({ useNavigate: () => H.navigate }));
vi.mock('convex/react', () => ({
  useQuery: () => undefined, // sales.history unavailable offline
  useMutation: () => H.refund,
}));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ token: 'tok', can: () => true }),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => H.online.current }));
vi.mock('@/state/hooks', () => ({ useBsRate: () => 36 }));
vi.mock('@/state/usePendingSales', () => ({ usePendingSales: () => H.pending }));
vi.mock('@/screens/Stored', () => ({
  DateField: () => <input aria-label="date" />,
}));

import HistoryScreen from '@/screens/History';

beforeEach(() => {
  H.online.current = false;
  H.pending = [
    {
      localId: 1,
      soldAt: Date.now(),
      total: 4.19,
      itemCount: 3,
      clientName: 'María González',
      method: 'cash',
      status: 'pending',
    },
  ];
});
afterEach(() => cleanup());

describe('History — offline pending sales (§10)', () => {
  test('offline: the PENDING_SYNC section lists the queued offline sale + a "Sin conexión" banner', () => {
    render(<HistoryScreen />);
    expect(screen.getByText('Pendientes de sincronización')).toBeDefined();
    expect(screen.getByText(/Venta offline · 3 productos/)).toBeDefined();
    expect(screen.getByText('$4.19')).toBeDefined();
    expect(screen.getByText('Sin conexión')).toBeDefined();
  });

  test('online with no pending sales: no PENDING_SYNC section, no offline banner', () => {
    H.pending = [];
    H.online.current = true;
    render(<HistoryScreen />);
    expect(screen.queryByText('Pendientes de sincronización')).toBeNull();
    expect(screen.queryByText('Sin conexión')).toBeNull();
  });
});
