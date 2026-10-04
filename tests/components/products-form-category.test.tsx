// @vitest-environment jsdom
// ProductForm — the category field (product-category-selection).
// The server requires a category on every product, so the form never submits
// without one. It resolves the category from the list AS CURRENTLY DELIVERED —
// the stored id first, then the first category — at render and at submit, never
// once at mount: the live query can deliver the list AFTER the form opened. An
// empty list is an honest, guided state (disabled placeholder, hint, required
// marker, disabled save) that clears in place the moment a category arrives.
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { FunctionReference } from 'convex/server';
import type { Id } from '@convex/_generated/dataModel';
import type { CategoryWithCount, Product, Supplier } from '@/types';

const {
  onlineMock,
  productsMock,
  categoriesMock,
  suppliersMock,
  mutationFns,
  mutationFor,
} = vi.hoisted(() => {
  // The generated `api` is a Proxy minting a NEW reference per property access,
  // so identity never matches — mocks key on getFunctionName() instead (same
  // pattern as tests/state/contexts.test.tsx). One vi.fn per function NAME, so
  // a test can ask afterwards exactly what `products:create` was handed.
  const mutationFns = new Map<string, ReturnType<typeof vi.fn>>();
  const mutationFor = (name: string) => {
    if (!mutationFns.has(name))
      mutationFns.set(
        name,
        vi.fn(async () => null)
      );
    return mutationFns.get(name)!;
  };
  return {
    onlineMock: { current: true },
    productsMock: { current: [] as Product[] },
    categoriesMock: { current: [] as CategoryWithCount[] },
    suppliersMock: { current: [] as Supplier[] },
    mutationFns,
    mutationFor,
  };
});

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, key: 'test', pathname: '/productos' }),
}));
vi.mock('convex/react', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useMutation: (ref: FunctionReference<'mutation'>) =>
      mutationFor(getFunctionName(ref)),
    useQuery: vi.fn(),
  };
});
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

const categoryId = (raw: string) => raw as unknown as Id<'categories'>;

const makeProduct = (over: Partial<Product> = {}): Product =>
  ({
    _id: 'p_cola',
    _creationTime: 0,
    name: 'Coca-Cola 600ml',
    sku: 'COCA',
    barcode: '7591234567890',
    price: 1.5,
    stock: 3,
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

const cat1 = makeCategory({ _id: categoryId('cat1'), label: 'Bebidas' });
const cat2 = makeCategory({ _id: categoryId('cat2'), label: 'Limpieza' });
const general = makeCategory({
  _id: categoryId('cat_general'),
  label: 'General',
  count: 0,
});

const PLACEHOLDER = 'Sin categorías disponibles';
const HINT =
  'Crea una categoría desde «Categorías» para poder guardar el producto.';

const btn = (name: RegExp | string) => screen.getByRole('button', { name });
/** The form, scoped: the filter row above it also labels a `Categoría` select. */
const form = (container: HTMLElement) =>
  within(container.querySelector('.prod-form') as HTMLElement);
const categorySelect = (container: HTMLElement) =>
  form(container).getByLabelText(/Categoría/, { selector: 'select' });
const optionsOf = (select: HTMLElement) =>
  Array.from(select.querySelectorAll('option'));

type User = ReturnType<typeof userEvent.setup>;
/** Name, barcode and price — everything `valid` asked for before this change. */
const fillRequired = async (user: User) => {
  await user.type(
    screen.getByPlaceholderText('Ej. Coca-Cola 600ml'),
    'Producto nuevo'
  );
  await user.type(screen.getByPlaceholderText('7591000000123'), '7591111111');
  await user.type(screen.getByPlaceholderText('0.00'), '3.50');
};
const openEdit = async (user: User, name: string) => {
  await user.click(screen.getByText(name).closest('button') as HTMLElement);
  await user.click(btn(/Editar/));
};
/** The sheet closes once the save resolved; awaiting it keeps act() quiet. */
const untilClosed = (saveLabel: string) =>
  waitFor(() =>
    expect(screen.queryByRole('button', { name: saveLabel })).toBeNull()
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mutationFns.clear();
  onlineMock.current = true;
  productsMock.current = [];
  categoriesMock.current = [];
  suppliersMock.current = [];
});

describe('Productos — categoría del formulario', () => {
  test('zero categories: the save is disabled and the empty state is honest and guided', async () => {
    const user = userEvent.setup();
    const { container } = render(<ProductsScreen />);
    await user.click(btn(/Nuevo producto/));
    await fillRequired(user);

    // Valid name, barcode and price — and still no save: nothing to save INTO.
    expect(btn('Crear producto')).toHaveProperty('disabled', true);
    const options = optionsOf(categorySelect(container));
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveProperty('disabled', true);
    expect(options[0].textContent).toBe(PLACEHOLDER);
    expect(form(container).getByText(HINT).textContent).toBe(HINT);
    expect(form(container).getByText('Categoría').textContent).toBe(
      'Categoría *'
    );
  });

  test('a category that arrives after the form opened is the one saved — never ""', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<ProductsScreen />);
    await user.click(btn(/Nuevo producto/));
    await fillRequired(user);
    expect(btn('Crear producto')).toHaveProperty('disabled', true);

    // The live query delivers the row. Same mounted form — no reload, no remount.
    categoriesMock.current = [cat1];
    rerender(<ProductsScreen />);

    expect(form(container).queryByText(PLACEHOLDER)).toBeNull();
    expect(form(container).queryByText(HINT)).toBeNull();
    expect(btn('Crear producto')).toHaveProperty('disabled', false);
    await user.click(btn('Crear producto'));
    await untilClosed('Crear producto');

    const create = mutationFor('products:create');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ categoryId: 'cat1' });
    for (const [args] of create.mock.calls) {
      expect(args.categoryId).not.toBe('');
    }
  });

  test('editing with a stored category while the list is still empty: placeholder, no hint, save enabled', async () => {
    const user = userEvent.setup();
    productsMock.current = [makeProduct({ categoryId: cat2._id })];
    const { container } = render(<ProductsScreen />);
    await openEdit(user, 'Coca-Cola 600ml');

    const options = optionsOf(categorySelect(container));
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveProperty('disabled', true);
    expect(options[0].textContent).toBe(PLACEHOLDER);
    // The product HAS a category; telling the user to create one would be false.
    expect(form(container).queryByText(HINT)).toBeNull();
    expect(btn('Guardar cambios')).toHaveProperty('disabled', false);
    await user.click(btn('Guardar cambios'));
    await untilClosed('Guardar cambios');

    const update = mutationFor('products:update');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].patch).toMatchObject({ categoryId: 'cat2' });
  });

  test('editing keeps the stored category through a list that orders another category first', async () => {
    const user = userEvent.setup();
    productsMock.current = [makeProduct({ categoryId: cat2._id })];
    const { container, rerender } = render(<ProductsScreen />);
    await openEdit(user, 'Coca-Cola 600ml');

    categoriesMock.current = [cat1, cat2];
    rerender(<ProductsScreen />);

    // A loading list must never re-categorize a product that already has one.
    expect(categorySelect(container)).toHaveProperty('value', 'cat2');
    await user.click(btn('Guardar cambios'));
    await untilClosed('Guardar cambios');

    const update = mutationFor('products:update');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].patch).toMatchObject({ categoryId: 'cat2' });
  });

  test('create falls back to the FIRST delivered category when the field is untouched', async () => {
    const user = userEvent.setup();
    categoriesMock.current = [general, cat1];
    render(<ProductsScreen />);
    await user.click(btn(/Nuevo producto/));
    await fillRequired(user);
    await user.click(btn('Crear producto'));
    await untilClosed('Crear producto');

    const create = mutationFor('products:create');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      categoryId: 'cat_general',
    });
  });
});
