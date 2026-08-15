// @vitest-environment jsdom
// Dashboard cash-flow tiles: Ingresos/Egresos/Diferencia, the period selector,
// and their truncated/offline/permission-denied states. Cash flow, never
// "ganancias"/"utilidad" — there is no cost-of-goods-sold in the schema.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
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
  // The window the cash-flow query was LAST asked for. Without capturing it, a
  // frozen or wrong window is invisible to every assertion in this file.
  const cashArgs: { current: { from: number; to: number } | null } = {
    current: null,
  };
  return { navigate: vi.fn(), online, can, salesHistory, cashFlow, cashArgs };
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
  H.cashArgs.current = null;
  // Dispatch on the query reference — Dashboard now issues two distinct
  // queries, and ignoring which one is called would leak fixtures across them.
  vi.mocked(useQuery).mockImplementation((query: unknown, args?: unknown) => {
    if (args === 'skip') return undefined;
    if (getFunctionName(query as never) === cashFlowName) {
      H.cashArgs.current = args as { from: number; to: number };
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

    // EXACT count, not "greater than zero": that string is already rendered
    // twice by pre-existing markup whenever the sales figures are unavailable
    // (the hero sub-caption and the recent-sales empty state), so a loose
    // assertion passes even if the cash-flow caption silently reverts to the
    // Egresos wording while blanked. The third occurrence IS the cash caption.
    expect(screen.getAllByText('No disponible sin conexión')).toHaveLength(3);
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

// A POS tablet lives on this screen all day. The window must follow the wall
// clock, not the moment the component happened to mount — otherwise Ingresos
// and Diferencia quietly stop moving while the selector still reads "Mes".
describe('Dashboard — the cash-flow window follows the clock', () => {
  afterEach(() => vi.useRealTimers());

  test('crossing the end of the period re-windows instead of freezing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 31, 23, 50, 0)); // Mar 31, 23:50 local
    H.cashFlow.current = cashFlowFixture;

    render(<Dashboard />);

    const march = H.cashArgs.current!;
    expect(new Date(march.from).getMonth()).toBe(2); // March
    expect(new Date(march.to).getDate()).toBe(31);

    // Twenty minutes later it is April, and nobody has touched the tablet.
    await act(async () => {
      vi.advanceTimersByTime(20 * 60 * 1000);
    });

    const april = H.cashArgs.current!;
    expect(new Date(april.from).getMonth()).toBe(3); // April
    expect(new Date(april.from).getDate()).toBe(1);
    // The old window ended before the new one starts — no overlap, no gap.
    expect(april.from).toBeGreaterThan(march.to);
  });

  test('inside the period the window is stable, so the subscription is not churned', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 10, 9, 0, 0)); // Mar 10, mid-month
    H.cashFlow.current = cashFlowFixture;

    render(<Dashboard />);
    const before = H.cashArgs.current!;

    await act(async () => {
      vi.advanceTimersByTime(8 * 60 * 60 * 1000); // eight hours, same month
    });

    const after = H.cashArgs.current!;
    // Identical bounds: a re-armed timer must not resubscribe with a new window.
    expect(after.from).toBe(before.from);
    expect(after.to).toBe(before.to);
  });
});

// The selector's entire value is that choosing a period re-windows the money
// query. No test clicked a segment, so deleting the change handler left three
// inert buttons and a green suite.
describe('Dashboard — the period selector re-windows the query', () => {
  test('choosing Día narrows the window to a single calendar day', () => {
    H.cashFlow.current = cashFlowFixture;
    render(<Dashboard />);

    const asMonth = H.cashArgs.current!;
    expect(asMonth.to - asMonth.from).toBeGreaterThan(86_399_999);

    fireEvent.click(screen.getByRole('button', { name: 'Día' }));

    const asDay = H.cashArgs.current!;
    // Exactly one calendar day, asserted as a relative invariant so the
    // runner's own timezone cannot flake this.
    expect(asDay.to - asDay.from).toBe(86_399_999);
    expect(asDay.from).toBeGreaterThan(asMonth.from);
  });

  test('choosing Semana asks for seven days, and the active segment follows', () => {
    H.cashFlow.current = cashFlowFixture;
    render(<Dashboard />);

    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));

    const asWeek = H.cashArgs.current!;
    expect(asWeek.to - asWeek.from).toBe(7 * 86_400_000 - 1);
    expect(screen.getByRole('button', { name: 'Semana' }).className).toContain(
      'on'
    );
    expect(screen.getByRole('button', { name: 'Mes' }).className).not.toContain(
      'on'
    );
  });
});

// The clock fix closed the timer door and left the selector one open: `cashNow`
// only advances on a hop, so switching period reads a clock up to six hours old.
describe('Dashboard — switching period reads the CURRENT clock', () => {
  afterEach(() => vi.useRealTimers());

  test('choosing Día after midnight shows today, not the day the tab was opened', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 20, 0, 0)); // Mar 15, 20:00
    H.cashFlow.current = cashFlowFixture;

    render(<Dashboard />);

    // Five hours pass — under the six-hour hop, so no timer has fired and the
    // memo still holds a clock from yesterday evening.
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 60 * 1000); // now Mar 16, 01:00
    });

    fireEvent.click(screen.getByRole('button', { name: 'Día' }));

    const day = H.cashArgs.current!;
    expect(new Date(day.from).getDate()).toBe(16);
    expect(new Date(day.to).getDate()).toBe(16);
  });
});
