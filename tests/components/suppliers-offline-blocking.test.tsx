// @vitest-environment jsdom
// Suppliers — OFFLINE WRITE-BLOCKING (FEATURES §18), the same per-phase contract
// every migrated screen ships with. Reads stay available offline (the list and
// its search render from the Dexie mirror), but every admin WRITE is blocked:
// create / edit / delete. Each blocked action is a disabled control plus a
// visible "Sin conexión" banner. A supplier is never queued offline.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Supplier } from '@/types';

const { onlineMock, suppliersMock, productsMock, bsRateMock } = vi.hoisted(
  () => ({
    onlineMock: { current: true },
    suppliersMock: { current: [] as Supplier[] },
    productsMock: { current: [] as unknown[] },
    bsRateMock: { current: 36.5 },
  })
);

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, key: 'test', pathname: '/proveedores' }),
}));
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  // purchases.bySupplier — undefined is the loading state, which is what an
  // unmocked query returns; no test here asserts on the history list.
  useQuery: () => undefined,
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => onlineMock.current }));
vi.mock('@/state/hooks', () => ({
  useSuppliers: () => suppliersMock.current,
  useProducts: () => productsMock.current,
  useBsRate: () => bsRateMock.current,
}));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ token: 't', user: null }),
}));

import SuppliersScreen from '@/screens/Suppliers';

const makeSupplier = (over: Partial<Supplier> = {}): Supplier =>
  ({
    _id: 's_sol',
    _creationTime: 0,
    name: 'Distribuidora El Sol, C.A.',
    taxPrefix: 'J',
    taxId: '40123456-7',
    contactName: 'Ramón Silva',
    phone: '02125550101',
    active: true,
    createdAt: 0,
    ...over,
  }) as unknown as Supplier;

const renderSuppliers = (online: boolean, rows = [makeSupplier()]) => {
  onlineMock.current = online;
  suppliersMock.current = rows;
  return render(<SuppliersScreen />);
};

const btn = (name: RegExp | string) => screen.getByRole('button', { name });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onlineMock.current = true;
  suppliersMock.current = [];
  productsMock.current = [];
  bsRateMock.current = 36.5;
});

describe('Proveedores — offline write-blocking (FEATURES §18)', () => {
  test('offline: "Nuevo proveedor" is disabled and the screen shows the notice', () => {
    renderSuppliers(false);
    expect(btn(/Nuevo proveedor/)).toHaveProperty('disabled', true);
    expect(
      screen.getByText(
        /Solo lectura\. No puedes crear, editar o eliminar proveedores/
      )
    ).toBeDefined();
  });

  test('online: "Nuevo proveedor" is enabled and no offline notice is shown', () => {
    renderSuppliers(true);
    expect(btn(/Nuevo proveedor/)).toHaveProperty('disabled', false);
    expect(screen.queryByText(/Solo lectura\./)).toBeNull();
  });

  test('offline: reads still work — the list renders from the mirror', () => {
    renderSuppliers(false);
    expect(screen.getByText('Distribuidora El Sol, C.A.')).toBeDefined();
    expect(screen.getByText('J-40123456-7')).toBeDefined();
  });

  test('offline: the detail sheet blocks editar / eliminar with the notice', async () => {
    const user = userEvent.setup();
    renderSuppliers(false);

    await user.click(
      screen
        .getByText('Distribuidora El Sol, C.A.')
        .closest('.lrow') as HTMLElement
    );

    expect(btn(/Editar/)).toHaveProperty('disabled', true);
    expect(btn('Eliminar')).toHaveProperty('disabled', true);
    expect(
      screen.getByText(/Editar y eliminar requieren conexión/)
    ).toBeDefined();
  });

  test('online: the detail sheet enables editar / eliminar (no offline notice)', async () => {
    const user = userEvent.setup();
    renderSuppliers(true);

    await user.click(
      screen
        .getByText('Distribuidora El Sol, C.A.')
        .closest('.lrow') as HTMLElement
    );

    expect(btn(/Editar/)).toHaveProperty('disabled', false);
    expect(btn('Eliminar')).toHaveProperty('disabled', false);
    expect(screen.queryByText(/requieren conexión/)).toBeNull();
  });
});

describe('Registrar compra — the two amount fields mirror each other', () => {
  const openPurchaseForm = async (user: ReturnType<typeof userEvent.setup>) => {
    productsMock.current = [
      {
        _id: 'p_cola',
        name: 'Coca-Cola 600ml',
        sku: 'COCA-600',
        barcode: '7591000000123',
        stock: 24,
        glyph: '🥤',
      },
    ];
    renderSuppliers(true);
    await user.click(
      screen
        .getByText('Distribuidora El Sol, C.A.')
        .closest('.lrow') as HTMLElement
    );
    await user.click(btn(/Registrar compra/));
  };

  test('typing a Bs total fills the $ field at the current rate', async () => {
    const user = userEvent.setup();
    await openPurchaseForm(user);

    // 365 Bs at the seeded 36.5 rate is exactly $10.
    await user.type(screen.getByLabelText(/Monto total en Bs/), '365');
    expect(screen.getByLabelText(/Monto total en \$/)).toHaveProperty(
      'value',
      '10.00'
    );
  });

  test('typing a $ total fills the Bs field, and the last field typed wins', async () => {
    const user = userEvent.setup();
    await openPurchaseForm(user);

    await user.type(screen.getByLabelText(/Monto total en \$/), '10');
    expect(screen.getByLabelText(/Monto total en Bs/)).toHaveProperty(
      'value',
      '365.00'
    );
  });

  test('the purchase cannot be saved without products and an amount', async () => {
    const user = userEvent.setup();
    await openPurchaseForm(user);

    const save = btn('Registrar compra');
    expect(save).toHaveProperty('disabled', true); // no lines, no amount

    await user.type(screen.getByPlaceholderText(/Buscar por nombre/), 'coca');
    await user.click(
      screen.getByText('Coca-Cola 600ml').closest('.lrow') as HTMLElement
    );
    expect(btn('Registrar compra')).toHaveProperty('disabled', true); // still no amount

    await user.type(screen.getByLabelText(/Monto total en \$/), '25');
    expect(btn('Registrar compra')).toHaveProperty('disabled', false);
  });
});

describe('Proveedores — list behaviour', () => {
  test('an inactive supplier is chipped as such and filtered by Estado', async () => {
    const user = userEvent.setup();
    renderSuppliers(true, [
      makeSupplier(),
      makeSupplier({
        _id: 's_norte' as Supplier['_id'],
        name: 'Insumos del Norte',
        taxId: '40777777-1',
        active: false,
      }),
    ]);

    expect(screen.getByText('Inactivo')).toBeDefined();

    await user.selectOptions(
      screen.getByLabelText('Estado', { selector: 'select' }),
      'active'
    );
    expect(screen.queryByText('Insumos del Norte')).toBeNull();
    expect(screen.getByText('Distribuidora El Sol, C.A.')).toBeDefined();
  });
});
