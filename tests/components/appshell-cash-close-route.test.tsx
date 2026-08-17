// @vitest-environment jsdom
// sdd-verify round 5, item 4: nothing previously rendered AppShell's route
// table — every CashClose test mounted CashCloseScreen directly. Adding
// `perm="view_reports"` to the `/cierre-de-caja` Guard, or to its nav item,
// leaves every one of those tests green while silently taking the route and
// the menu entry away from any cajero without that permission — the same
// terminal-lockout class this whole change has spent five rounds closing,
// just one layer upstream of the screen where the escape hatch cannot help.
// Follows tests/components/appshell-offline-checkout.test.tsx's precedent
// for mounting the real AppShell.
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const H = vi.hoisted(() => {
  const cart = {
    selectedClient: null,
    heldCarts: [] as unknown[],
    completedSale: null,
    splits: [],
    splitsIdRef: { current: 1 },
    setCompletedSale: vi.fn(),
    setCart: vi.fn(),
    setSelectedClientId: vi.fn(),
    setSplits: vi.fn(),
    resetPayment: vi.fn(),
  };
  return { navigate: vi.fn(), cart };
});

vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => H.navigate,
}));
// The whole point of this file: a session WITHOUT view_reports.
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({
    user: { name: 'Carlos' },
    token: 'tok',
    loading: false,
    can: (perm: string) => perm !== 'view_reports',
    logout: vi.fn(),
  }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => H.cart }));
vi.mock('@/state/useOnline', () => ({ useOnline: () => true }));
vi.mock('@/state/useSyncEngine', () => ({ useSyncEngine: () => {} }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 36,
  useSettingsDoc: () => ({ ivaPct: 13 }),
  // Dashboard.tsx's own dependencies — kept mocked so a WRONG redirect to
  // "/" (the exact regression this file exists to catch) fails cleanly on
  // this file's own assertions, not on an unrelated crash in Dashboard.
  useCategories: () => [],
  useClients: () => [],
  useProducts: () => [],
}));
vi.mock('@/state/usePendingSales', () => ({ usePendingSales: () => [] }));
vi.mock('@/state/pendingOps', () => ({ enqueuePendingOp: vi.fn() }));
vi.mock('@/state/db', () => ({ db: { cartDraft: { delete: vi.fn() } } }));
// CashCloseScreen's own closes.list/closes.create calls, and AppShell's
// sales.checkout — none exercised in this test, just kept non-crashing.
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: () => ({ closes: [], truncated: false }),
}));
// Real AppBar/Banner/Button/Icon/Input (CashCloseScreen needs them) — only
// NavLayout/ConfirmDialog/useToast are replaced, so the nav array AppShell
// builds is actually observable instead of discarded by a `{children}`-only
// stub.
vi.mock('@/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components')>();
  return {
    ...actual,
    NavLayout: ({
      nav,
      children,
    }: {
      nav: Array<{ id: string; label: string }>;
      children: ReactNode;
    }) => (
      <div>
        <nav aria-label="test-nav">
          {nav.map((item) => (
            <span key={item.id}>{item.label}</span>
          ))}
        </nav>
        {children}
      </div>
    ),
    ConfirmDialog: () => null,
    useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
  };
});

import AppShell from '@/AppShell';

beforeEach(() => {
  H.navigate.mockClear();
});
afterEach(() => cleanup());

describe('AppShell — /cierre-de-caja is reachable and has a nav entry without view_reports', () => {
  test('a session without view_reports sees the nav entry and reaches the real screen', () => {
    render(
      <MemoryRouter initialEntries={['/cierre-de-caja']}>
        <AppShell />
      </MemoryRouter>
    );

    // The nav item was NOT filtered out by a wrongly-added perm. Scoped to
    // the mocked <nav> — CashCloseScreen's own AppBar ALSO renders the
    // identical string "Cierre de caja" as its title, so a bare
    // `getByText` here would be ambiguous.
    const nav = screen.getByRole('navigation', { name: 'test-nav' });
    expect(within(nav).getByText('Cierre de caja')).toBeDefined();

    // The Guard did NOT redirect to "/" for lack of view_reports — the real
    // screen rendered its own content.
    expect(screen.getByText('Conteo de caja')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cerrar caja' })).toBeDefined();
  });
});
