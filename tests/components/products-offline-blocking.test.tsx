// @vitest-environment jsdom
// Phase 1 (Products) + Phase 2 (Categories) — OFFLINE WRITE-BLOCKING (FEATURES §18).
// Reads stay available offline (the catalog and the category list render from the
// Dexie mirror), but every admin WRITE is blocked: create / edit / adjust-stock /
// delete a product, and create / rename / delete a category. Each blocked action is
// a disabled control plus a visible "Sin conexión" banner in the app's offline-banner
// style. Online, the same controls are enabled and no offline banner shows.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
import { ToastProvider } from '@/components';

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

// --- Product photo ----------------------------------------------------------
// The INITIAL is what covers every case a photo cannot: no photo, a fetch that
// fails, and OFFLINE — storage addresses are network-backed and are not in the
// Dexie mirror, so a photographed product simply has no address to render there.
// It replaced the emoji, which nobody should have had to pick in the first place.
const glyphBox = () =>
  document.querySelector('.prod-card-glyph')?.textContent ?? '';

describe('Productos — foto', () => {
  test('a product with no photo shows its initial', () => {
    renderScreen(true);
    expect(glyphBox()).toBe('C');
  });

  test('a photographed product renders the image instead of the initial', () => {
    onlineMock.current = true;
    productsMock.current = [
      makeProduct({ imageUrl: 'https://storage.example/abc.jpg' }),
    ];
    categoriesMock.current = [makeCategory()];
    render(<ProductsScreen />);

    const img = document.querySelector('.prod-card-glyph img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://storage.example/abc.jpg');
  });

  test('an image that fails to load falls back to the initial, never a broken image', () => {
    onlineMock.current = true;
    productsMock.current = [
      makeProduct({ imageUrl: 'https://storage.example/gone.jpg' }),
    ];
    categoriesMock.current = [makeCategory()];
    render(<ProductsScreen />);

    const img = document.querySelector(
      '.prod-card-glyph img'
    ) as HTMLImageElement;
    fireEvent.error(img);

    expect(document.querySelector('.prod-card-glyph img')).toBeNull();
    expect(glyphBox()).toBe('C');
  });

  test('offline: a photographed product still shows its initial and stays listed', () => {
    onlineMock.current = false;
    // The mirror carries the document but never the binary, so no address.
    productsMock.current = [makeProduct()];
    categoriesMock.current = [makeCategory()];
    render(<ProductsScreen />);

    expect(document.querySelector('.prod-card-glyph img')).toBeNull();
    expect(glyphBox()).toBe('C');
    expect(screen.getByText('Coca-Cola 600ml')).toBeDefined();
  });

  // Offline there is nothing to assert about the field: "Nuevo producto" is
  // already disabled, so the form never opens. Online it must be reachable.
  test('online: the form offers a photo field, enabled', async () => {
    const user = userEvent.setup();
    renderScreen(true);
    await user.click(btn(/Nuevo producto/));
    const field = screen.getByLabelText('Foto del producto');
    expect(field).toHaveProperty('disabled', false);
    expect(field.getAttribute('accept')).toBe('image/*');
  });
});

describe('Productos — orden por defecto', () => {
  const productId = (raw: string) => raw as unknown as Product['_id'];

  test('the newest product comes first, without touching the sort control', () => {
    onlineMock.current = true;
    productsMock.current = [
      makeProduct({
        _id: productId('p_old'),
        name: 'Producto viejo',
        _creationTime: 100,
      }),
      makeProduct({
        _id: productId('p_new'),
        name: 'Producto nuevo',
        _creationTime: 900,
      }),
    ];
    categoriesMock.current = [makeCategory()];
    render(<ProductsScreen />);

    // After adding a product you expect to SEE it; hunting for it alphabetically
    // is the wrong job for the screen to hand back.
    const names = Array.from(document.querySelectorAll('.prod-card-name')).map(
      (n) => n.textContent
    );
    expect(names).toEqual(['Producto nuevo', 'Producto viejo']);
  });
});

// --- Automatic SKU ----------------------------------------------------------
// The user does not invent the code any more. The form still SHOWS it, because
// a code you cannot see before saving is a code you cannot put on a label.
describe('Productos — SKU automático', () => {
  const skuField = () => screen.getByLabelText('SKU', { selector: 'input' });

  test('the SKU field cannot be typed into', async () => {
    const user = userEvent.setup();
    renderScreen(true);
    await user.click(btn(/Nuevo producto/));
    expect(skuField()).toHaveProperty('readOnly', true);
  });

  test('the preview follows the name as it is typed', async () => {
    const user = userEvent.setup();
    renderScreen(true);
    await user.click(btn(/Nuevo producto/));

    await user.type(
      screen.getByPlaceholderText('Ej. Coca-Cola 600ml'),
      'Café con leche 250g'
    );
    // Derived by the same function the server runs, so the preview is not a
    // guess at what will be stored.
    expect(skuField()).toHaveProperty('value', 'CAFE-CON-LECHE-250G');
  });

  test('editing shows the STORED SKU, not a fresh derivation from the name', async () => {
    const user = userEvent.setup();
    renderScreen(true);

    await user.click(
      screen.getByText('Coca-Cola 600ml').closest('button') as HTMLElement
    );
    await user.click(btn(/Editar/));

    // Deriving here would read COCA-COLA-600ML. The product's code is COCA, and
    // it may already be on a shelf label — a rename must not move it.
    expect(skuField()).toHaveProperty('value', 'COCA');
  });

  test('the emoji field is gone from the form', async () => {
    const user = userEvent.setup();
    renderScreen(true);
    await user.click(btn(/Nuevo producto/));
    expect(screen.queryByText('Emoji / símbolo')).toBeNull();
  });

  test('a product is valid without the user supplying a SKU', async () => {
    const user = userEvent.setup();
    renderScreen(true);
    await user.click(btn(/Nuevo producto/));

    await user.type(
      screen.getByPlaceholderText('Ej. Coca-Cola 600ml'),
      'Producto nuevo'
    );
    await user.type(screen.getByPlaceholderText('7591000000123'), '7591111111');
    await user.type(screen.getByPlaceholderText('0.00'), '3.50');

    expect(btn('Crear producto')).toHaveProperty('disabled', false);
  });
});

// --- Photo size -------------------------------------------------------------
// A phone camera hands back 8-12 MB per shot and this app runs on Venezuelan
// mobile data. Refusing costs one message; not refusing costs the upload, and
// the user finds out by watching it hang.
describe('Productos — peso de la foto', () => {
  const fileOfSize = (bytes: number) => {
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    // Declared rather than allocated: the guard reads `.size`, and putting six
    // real megabytes in a test buys nothing.
    Object.defineProperty(file, 'size', { value: bytes });
    return file;
  };

  const openFormWithToasts = async () => {
    onlineMock.current = true;
    productsMock.current = [makeProduct()];
    categoriesMock.current = [makeCategory()];
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ProductsScreen />
      </ToastProvider>
    );
    await user.click(btn(/Nuevo producto/));
    return user;
  };

  test('a photo over the limit is refused with a message, and never uploaded', async () => {
    await openFormWithToasts();
    const field = screen.getByLabelText('Foto del producto');

    fireEvent.change(field, {
      target: { files: [fileOfSize(6 * 1024 * 1024)] },
    });

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      expect.stringContaining('La foto pesa demasiado')
    );
    // Nothing was attached: the button still offers to pick a first photo.
    expect(btn(/Elegir foto/)).toBeDefined();
  });

  test('a photo under the limit is not refused', async () => {
    await openFormWithToasts();
    const field = screen.getByLabelText('Foto del producto');

    fireEvent.change(field, { target: { files: [fileOfSize(1024)] } });

    expect(screen.queryByText(/La foto pesa demasiado/)).toBeNull();
  });
});
