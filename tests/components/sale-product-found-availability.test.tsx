// @vitest-environment jsdom
// ProductFoundSheet ("add to cart" modal) availability banner. Bug: selecting the
// MAXIMUM valid quantity (e.g. stock 30, empty cart, qty 30) wrongly showed a
// DANGER "Producto no disponible / agotado" banner because the condition was
// `qty >= maxAddable` — reaching the cap is NOT the same as being unavailable.
// Correct rule: the danger banner shows ONLY when maxAddable < 1 (nothing can be
// added). With stock to add, at most a soft INFO note shows; never "agotado".
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Product } from '@/types';

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => true }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useCategories: () => [],
  useClients: () => [],
  useProducts: () => [],
  useSettingsDoc: () => ({ scannerMode: 'scanner' }),
}));
vi.mock('@/state/CartContext', () => ({ useCart: () => ({}) }));

import { ProductFoundSheet } from '@/screens/Sale';

const makeProduct = (over: Partial<Product> = {}): Product =>
  ({
    _id: 'p_cola',
    _creationTime: 0,
    name: 'Coca-Cola 600ml',
    sku: 'COCA',
    barcode: '7591234567890',
    price: 1.5,
    stock: 30,
    glyph: '🥤',
    categoryId: 'cat1',
    minStock: 5,
    sellable: true,
    exempt: false,
    createdAt: 0,
    ...over,
  }) as unknown as Product;

const agregarBtn = () =>
  screen.getByRole('button', { name: /Agregar al carrito/ });
const plusBtn = () => screen.getByRole('button', { name: 'agregar uno' });
const qtyInput = () =>
  screen.getByRole<HTMLInputElement>('textbox', { name: 'cantidad' });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Venta — ProductFoundSheet availability banner (no false "agotado")', () => {
  test('stock 30, empty cart, qty 30 (the max) → NO "no disponible"/"agotado", Agregar enabled', async () => {
    const user = userEvent.setup();
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 30 })}
        reservedUnits={0}
        currentCartQty={0}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // Drive the qty to the valid maximum (30 === maxAddable).
    await user.clear(qtyInput());
    await user.type(qtyInput(), '30');
    expect(qtyInput().value).toBe('30');

    // The false danger banner must be gone.
    expect(screen.queryByText(/no disponible/i)).toBeNull();
    expect(screen.queryByText(/agotado/i)).toBeNull();
    // Adding the full available qty is valid — button stays enabled.
    expect(agregarBtn()).toHaveProperty('disabled', false);
  });

  test('stock 0 → shows agotado / no-disponible danger banner; Agregar + "+" disabled', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 0 })}
        reservedUnits={0}
        currentCartQty={0}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/no disponible/i)).toBeDefined();
    expect(screen.getByText(/agotado/i)).toBeDefined();
    expect(agregarBtn()).toHaveProperty('disabled', true);
    expect(plusBtn()).toHaveProperty('disabled', true);
  });

  test('reserved blocks all (physical 2, reserved 2, empty cart) → en-espera message; add disabled (regression guard)', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 2 })}
        reservedUnits={2}
        currentCartQty={0}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // en-espera is the cause → en-espera wording, NOT a flat "agotado".
    expect(screen.getByText(/no disponibles para esta venta/)).toBeDefined();
    expect(screen.queryByText(/agotado/i)).toBeNull();
    expect(agregarBtn()).toHaveProperty('disabled', true);
  });

  test('currentCartQty>0 with room (stock 30, 10 in cart) → INFO "Solo puedes agregar 20 más", no agotado, add enabled', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 30 })}
        reservedUnits={0}
        currentCartQty={10}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/Solo puedes agregar 20 más/)).toBeDefined();
    expect(screen.queryByText(/no disponible/i)).toBeNull();
    expect(screen.queryByText(/agotado/i)).toBeNull();
    expect(agregarBtn()).toHaveProperty('disabled', false);
  });

  test('cart already holds all physical (stock 5, 5 in cart, no reserved) → "máximo disponible en el carrito"; add disabled', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 5 })}
        reservedUnits={0}
        currentCartQty={5}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/máximo disponible en el carrito/i)).toBeDefined();
    expect(screen.queryByText(/agotado/i)).toBeNull();
    expect(agregarBtn()).toHaveProperty('disabled', true);
  });

  // "disponibles" must reflect REAL availability (physical − en-espera), never
  // physical stock. With 2 reserved, only 2 of the 4 physical units are sellable.
  test('stock 4, reserved 2, 1 in cart → "2 disponibles" (NOT 4) + "2 en espera" + "agregar 1 más"; add enabled', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 4 })}
        reservedUnits={2}
        currentCartQty={1}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const banner = screen.getByText(/Solo puedes agregar/);
    expect(banner.textContent).toMatch(/2 disponibles/);
    expect(banner.textContent).not.toMatch(/4 disponibles/);
    expect(banner.textContent).toMatch(/2 en espera/);
    expect(banner.textContent).toMatch(/ya tienes 1 en el carrito/);
    expect(banner.textContent).toMatch(/agregar 1 más/);
    expect(screen.queryByText(/agotado/i)).toBeNull();
    expect(agregarBtn()).toHaveProperty('disabled', false);
  });

  // First open (empty cart) but availability is reduced by en-espera: the info
  // banner MUST show (it did NOT before — only the chip did), telling the cashier
  // they can add only 2. No " más" since nothing is in the cart yet.
  test('stock 4, reserved 2, empty cart (first open) → info banner SHOWN: "2 disponibles" + "2 en espera" + "agregar 2"', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 4 })}
        reservedUnits={2}
        currentCartQty={0}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const banner = screen.getByText(/Solo puedes agregar/);
    expect(banner.textContent).toMatch(/2 disponibles/);
    expect(banner.textContent).not.toMatch(/4 disponibles/);
    expect(banner.textContent).toMatch(/2 en espera/);
    expect(banner.textContent).toMatch(/agregar 2/);
    // No cart yet → no " más" and no "ya tienes ... en el carrito" clause.
    expect(banner.textContent).not.toMatch(/más/);
    expect(banner.textContent).not.toMatch(/ya tienes/);
    expect(agregarBtn()).toHaveProperty('disabled', false);
  });

  // Valid-max regression guard: nothing reserved, empty cart → NO info banner at
  // all (this is the earlier false-"agotado" fix for the valid-max case).
  test('stock 30, reserved 0, empty cart → NO info banner (valid max, no false agotado)', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 30 })}
        reservedUnits={0}
        currentCartQty={0}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByText(/Solo puedes agregar/)).toBeNull();
    expect(screen.queryByText(/Stock limitado/)).toBeNull();
    expect(screen.queryByText(/agotado/i)).toBeNull();
    expect(agregarBtn()).toHaveProperty('disabled', false);
  });

  // No reservation, but cart already holds some: "disponibles" = full physical 4
  // (none en espera) and the reason is the cart, not en-espera.
  test('stock 4, reserved 0, 1 in cart → "4 disponibles" + "ya tienes 1 en el carrito" + "agregar 3 más"; no en-espera clause', () => {
    render(
      <ProductFoundSheet
        product={makeProduct({ stock: 4 })}
        reservedUnits={0}
        currentCartQty={1}
        bsRate={0}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const banner = screen.getByText(/Solo puedes agregar/);
    expect(banner.textContent).toMatch(/4 disponibles/);
    expect(banner.textContent).toMatch(/ya tienes 1 en el carrito/);
    expect(banner.textContent).toMatch(/agregar 3 más/);
    expect(banner.textContent).not.toMatch(/en espera/);
    expect(agregarBtn()).toHaveProperty('disabled', false);
  });
});
