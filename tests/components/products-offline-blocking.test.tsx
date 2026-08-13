// @vitest-environment jsdom
// Phase 1 (Products) + Phase 2 (Categories) — OFFLINE WRITE-BLOCKING (FEATURES §18).
// Reads stay available offline (the catalog and the category list render from the
// Dexie mirror), but every admin WRITE is blocked: create / edit / adjust-stock /
// delete a product, and create / rename / delete a category. Each blocked action is
// a disabled control plus a visible "Sin conexión" banner in the app's offline-banner
// style. Online, the same controls are enabled and no offline banner shows.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CategoryWithCount, Product, Supplier } from '@/types';

const { onlineMock, productsMock, categoriesMock, suppliersMock } = vi.hoisted(
  () => ({
    onlineMock: { current: true },
    productsMock: { current: [] as Product[] },
    categoriesMock: { current: [] as CategoryWithCount[] },
    suppliersMock: { current: [] as Supplier[] },
  })
);

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, key: 'test', pathname: '/productos' }),
}));
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => onlineMock.current }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useCategories: () => categoriesMock.current,
  useProducts: () => productsMock.current,
  useSuppliers: () => suppliersMock.current,
}));
vi.mock('@/state/SessionContext', () => ({
  useSession: () => ({ token: 't', user: null }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => ({ reserved: {} }) }));

import ProductsScreen from '@/screens/Products';

const makeProduct = (over: Partial<Product> = {}): Product =>
  ({
    _id: 'p_cola',
    _creationTime: 0,
    name: 'Coca-Cola 600ml',
    sku: 'COCA',
    barcode: '7591234567890',
    price: 1.5,
    stock: 3,
    glyph: '🥤',
    categoryId: 'cat1',
    minStock: 5,
    sellable: true,
    exempt: false,
    createdAt: 0,
    ...over,
  }) as unknown as Product;

const makeCategory = (
  over: Partial<CategoryWithCount> = {}
): CategoryWithCount =>
  ({ _id: 'cat1', label: 'Bebidas', count: 1, ...over }) as CategoryWithCount;

const renderScreen = (online: boolean) => {
  onlineMock.current = online;
  productsMock.current = [makeProduct()];
  categoriesMock.current = [makeCategory()];
  return render(<ProductsScreen />);
};

const btn = (name: RegExp | string) => screen.getByRole('button', { name });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onlineMock.current = true;
  productsMock.current = [];
  categoriesMock.current = [];
  suppliersMock.current = [];
});

describe('Productos — offline write-blocking (FEATURES §18)', () => {
  test('offline: "Nuevo producto" is disabled and the screen shows the offline notice', () => {
    renderScreen(false);
    expect(btn(/Nuevo producto/)).toHaveProperty('disabled', true);
    expect(
      screen.getByText(
        /Solo lectura\. No puedes crear, editar o eliminar productos ni categorías/
      )
    ).toBeDefined();
  });

  test('online: "Nuevo producto" is enabled and no offline notice is shown', () => {
    renderScreen(true);
    expect(btn(/Nuevo producto/)).toHaveProperty('disabled', false);
    expect(screen.queryByText(/Solo lectura\./)).toBeNull();
  });

  test('offline: product detail blocks editar / ajustar stock / eliminar', async () => {
    const user = userEvent.setup();
    renderScreen(false);

    await user.click(
      screen.getByText('Coca-Cola 600ml').closest('button') as HTMLElement
    );
    // Even after entering a valid stock delta, "Guardar" stays disabled offline.
    await user.type(screen.getByPlaceholderText('3'), '10');

    expect(btn(/Editar/)).toHaveProperty('disabled', true);
    expect(btn('Eliminar')).toHaveProperty('disabled', true);
    expect(btn('Guardar')).toHaveProperty('disabled', true);
    expect(
      screen.getByText(/Editar, ajustar stock y eliminar requieren conexión/)
    ).toBeDefined();
  });

  test('online: product detail enables editar / eliminar (and ajuste once a delta is set)', async () => {
    const user = userEvent.setup();
    renderScreen(true);

    await user.click(
      screen.getByText('Coca-Cola 600ml').closest('button') as HTMLElement
    );
    await user.type(screen.getByPlaceholderText('3'), '10');

    expect(btn(/Editar/)).toHaveProperty('disabled', false);
    expect(btn('Eliminar')).toHaveProperty('disabled', false);
    expect(btn('Guardar')).toHaveProperty('disabled', false);
    expect(screen.queryByText(/requieren conexión/)).toBeNull();
  });
});

describe('Categorías — offline write-blocking (FEATURES §18)', () => {
  test('offline: the Categorías sheet still OPENS (read) but crear / renombrar / eliminar are blocked', async () => {
    const user = userEvent.setup();
    renderScreen(false);

    // Reads aren't blocked: the manager button is enabled and opens the sheet.
    const manager = btn(/Categorías/);
    expect(manager).toHaveProperty('disabled', false);
    await user.click(manager);

    // Typing a valid name does NOT enable "Crear" while offline.
    await user.type(screen.getByPlaceholderText('Nueva categoría'), 'Snacks');

    expect(btn('Crear')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Renombrar')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Eliminar')).toHaveProperty('disabled', true);
    expect(
      screen.getByText(
        /Crear, renombrar y eliminar categorías requieren conexión/
      )
    ).toBeDefined();
  });

  test('online: crear (with a valid name) / renombrar / eliminar are enabled, no offline notice', async () => {
    const user = userEvent.setup();
    renderScreen(true);

    await user.click(btn(/Categorías/));
    await user.type(screen.getByPlaceholderText('Nueva categoría'), 'Snacks');

    expect(btn('Crear')).toHaveProperty('disabled', false);
    expect(screen.getByLabelText('Renombrar')).toHaveProperty(
      'disabled',
      false
    );
    expect(screen.getByLabelText('Eliminar')).toHaveProperty('disabled', false);
    expect(screen.queryByText(/requieren conexión/)).toBeNull();
  });
});

// --- Preferred supplier -----------------------------------------------------
// The link answers "who do I reorder this from". It is optional, so "Sin
// proveedor" is a real choice; and a RETIRED supplier still labels the products
// that name it, marked, because the link is historically true.
describe('Productos — proveedor preferido', () => {
  const makeSupplier = (over: Partial<Supplier> = {}): Supplier =>
    ({
      _id: 's_sol',
      _creationTime: 0,
      name: 'Distribuidora El Sol, C.A.',
      taxPrefix: 'J',
      taxId: '40123456-7',
      active: true,
      createdAt: 0,
      ...over,
    }) as unknown as Supplier;

  test('the form offers the supplier base plus an explicit "Sin proveedor"', async () => {
    const user = userEvent.setup();
    suppliersMock.current = [makeSupplier()];
    renderScreen(true);

    await user.click(btn(/Nuevo producto/));
    const picker = screen.getByLabelText('Proveedor', { selector: 'select' });
    const options = Array.from(picker.querySelectorAll('option')).map(
      (o) => o.textContent
    );
    expect(options).toEqual(['Sin proveedor', 'Distribuidora El Sol, C.A.']);
    // Unset is the default: a product without a supplier stays valid.
    expect(picker).toHaveProperty('value', '');
  });

  test('a retired supplier is still offered, marked as inactive', async () => {
    const user = userEvent.setup();
    suppliersMock.current = [makeSupplier({ active: false })];
    renderScreen(true);

    await user.click(btn(/Nuevo producto/));
    const picker = screen.getByLabelText('Proveedor', { selector: 'select' });
    expect(
      Array.from(picker.querySelectorAll('option')).map((o) => o.textContent)
    ).toEqual(['Sin proveedor', 'Distribuidora El Sol, C.A. (inactivo)']);
  });

  test('the product detail shows a dash when no supplier is set', async () => {
    const user = userEvent.setup();
    suppliersMock.current = [makeSupplier()];
    renderScreen(true);

    await user.click(
      screen.getByText('Coca-Cola 600ml').closest('button') as HTMLElement
    );
    const row = screen
      .getByText('Proveedor')
      .closest('.prod-detail-row') as HTMLElement;
    expect(row.textContent).toContain('—');
  });
});
