// @vitest-environment jsdom
// Dashboard cash-flow tiles: Ingresos/Egresos/Diferencia, the period selector,
// and their truncated/offline/permission-denied states. Cash flow, never
// "ganancias"/"utilidad" — there is no cost-of-goods-sold in the schema.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useQuery } from 'convex/react';
import { getFunctionName } from 'convex/server';
import { api } from '@convex/_generated/api';

// `api.*` is a Proxy that mints a new object per access, so `===` between two
// separate accesses is always false — dispatch on the stable string instead.
const cashFlowName = getFunctionName(api.reports.cashFlow);

const H = vi.hoisted(() => {
  const online: { current: boolean } = { current: true };
  const can: { current: (perm: string) => boolean } = { current: () => true };
  const salesHistory: { current: unknown } = { current: undefined };
  const cashFlow: { current: unknown } = { current: undefined };
  return { navigate: vi.fn(), online, can, salesHistory, cashFlow };
});

vi.mock('react-router', () => ({ useNavigate: () => H.navigate }));
// Bare vi.fn() sidesteps vi.mock hoisting; dispatch is wired in beforeEach.
vi.mock('convex/react', () => ({ useQuery: vi.fn() }));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({
    user: { name: 'Carlos' },
    token: 'tok',
    can: (perm: string) => H.can.current(perm),
  }),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => H.online.current }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 36,
  useCategories: () => [],
  useClients: () => [],
  useProducts: () => [],
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => ({ heldCarts: [] }) }));

import Dashboard from '@/screens/Dashboard';

const cashFlowFixture = {
  income: 500,
  expenses: 300,
  net: 200,
  salesCount: 4,
  purchasesCount: 2,
  truncated: false,
};

beforeEach(() => {
  H.online.current = true;
  H.can.current = () => true;
  H.salesHistory.current = undefined;
  H.cashFlow.current = undefined;
  // Dispatch on the query reference — Dashboard now issues two distinct
  // queries, and ignoring which one is called would leak fixtures across them.
  vi.mocked(useQuery).mockImplementation((query: unknown, args?: unknown) => {
    if (args === 'skip') return undefined;
    if (getFunctionName(query as never) === cashFlowName) {
      return H.cashFlow.current;
    }
    return H.salesHistory.current;
  });
});
afterEach(() => cleanup());

describe('Dashboard — cash-flow tiles', () => {
  test('happy path: Ingresos/Egresos/Diferencia render numbers, never "ganancia"/"utilidad"', () => {
    H.cashFlow.current = cashFlowFixture;
    render(<Dashboard />);

    expect(screen.getByText('Ingresos')).toBeDefined();
    expect(screen.getByText('Egresos')).toBeDefined();
    expect(screen.getByText('Diferencia')).toBeDefined();
    expect(screen.getByText('$500.00')).toBeDefined();
    expect(screen.getByText('$300.00')).toBeDefined();
    expect(screen.getByText('$200.00')).toBeDefined();
    expect(screen.queryByText(/ganancia|utilidad/i)).toBeNull();
  });

  test('truncated: real figures sit in the mock, but all three tiles show "—" instead', () => {
    H.cashFlow.current = { ...cashFlowFixture, truncated: true };
    render(<Dashboard />);

    expect(screen.queryByText('$500.00')).toBeNull();
    expect(screen.queryByText('$300.00')).toBeNull();
    expect(screen.queryByText('$200.00')).toBeNull();
    // Ingresos, Egresos and Diferencia together, on top of the pre-existing
    // Ventas/Productos dashes that never render here (this test stays online).
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  test('offline with no cached result: all three "—", alongside the sales tiles', () => {
    H.online.current = false;
    H.cashFlow.current = undefined;
    render(<Dashboard />);

    expect(
      screen.getAllByText('No disponible sin conexión').length
    ).toBeGreaterThan(0);
    // The "Vendido hoy" hero + Ventas + Productos (already-passing sales tiles)
    // plus Ingresos + Egresos + Diferencia — six dashes, offline together.
    expect(screen.getAllByText('—')).toHaveLength(6);
  });

  test('permission denied: the three labels and the selector are absent, nothing throws', () => {
    H.can.current = () => false;
    expect(() => render(<Dashboard />)).not.toThrow();

    expect(screen.queryByText('Ingresos')).toBeNull();
    expect(screen.queryByText('Egresos')).toBeNull();
    expect(screen.queryByText('Diferencia')).toBeNull();
    expect(screen.queryByText('Mes')).toBeNull();
    expect(screen.queryByText('Semana')).toBeNull();
    expect(screen.queryByText('Día')).toBeNull();
  });

  test('Egresos caption states it counts supplier purchases only, as visible text (not a title attribute)', () => {
    H.cashFlow.current = cashFlowFixture;
    render(<Dashboard />);

    const caption = screen.getByText(
      'Egresos = solo compras a proveedores. No incluye alquiler, sueldos ni servicios.'
    );
    expect(caption).toBeDefined();
    expect(caption.getAttribute('title')).toBeNull();
  });

  test('selector: Mes carries .on by default; no control navigates to a previous period; no comparison figure exists', () => {
    H.cashFlow.current = cashFlowFixture;
    render(<Dashboard />);

    const mesButton = screen.getByRole('button', { name: 'Mes' });
    const semanaButton = screen.getByRole('button', { name: 'Semana' });
    const diaButton = screen.getByRole('button', { name: 'Día' });
    expect(mesButton.className).toBe('on');
    expect(semanaButton.className).toBe('');
    expect(diaButton.className).toBe('');

    // The scope guard against this screen drifting toward a "ganancias" trend:
    // the CURRENT period only, no back/forward control, no comparison figure.
    expect(screen.queryByText(/anterior/i)).toBeNull();
    expect(
      screen.queryByText(/vs\.?\s*(período|periodo|mes|semana)/i)
    ).toBeNull();
  });
});
