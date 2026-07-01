// @vitest-environment jsdom
// Phase 5 (Scan) — OFFLINE SEARCH PROOF + the "datos desactualizados" affordance
// (FEATURES §4). Scan is read-only, so there are NO writes to block. Because
// useProducts() is Dexie-backed (Phase 1), Scan's in-memory catalog.filter/find
// search keeps working offline with ZERO changes to the screen. This suite proves
// that (name / SKU / barcode search + an HID barcode scan resolve against the
// cached catalog) and asserts the offline banner warns that BOTH prices and stock
// may be stale — shown offline, hidden online. The camera scan path shares the same
// catalog.find lookup and is covered by camera-scanner.test.tsx.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Product } from '@/types';

const { onlineMock, productsMock } = vi.hoisted(() => ({
  onlineMock: { current: true },
  productsMock: { current: [] as Product[] },
}));

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock('@/state/useOnline', () => ({ useOnline: () => onlineMock.current }));
vi.mock('@/state/CartContext', () => ({ useCart: () => ({ reserved: {} }) }));
vi.mock('@/state/hooks', () => ({
  useBsRate: () => 0,
  useProducts: () => productsMock.current,
  useCategories: () => [],
  useSettingsDoc: () => ({ scannerMode: 'physical', ivaPct: 13 }),
}));

import ScanScreen from '@/screens/Scan';

const cola = {
  _id: 'p_cola',
  _creationTime: 0,
  barcode: '7591000000123',
  sku: 'COCA-600',
  name: 'Coca-Cola 600ml',
  price: 1.5,
  stock: 24,
  minStock: 5,
  categoryId: 'cat1',
  glyph: '🥤',
} as unknown as Product;

const arepa = {
  _id: 'p_arepa',
  _creationTime: 0,
  barcode: '7591000000456',
  sku: 'AREPA-1',
  name: 'Harina PAN 1kg',
  price: 2,
  stock: 12,
  minStock: 5,
  categoryId: 'cat1',
  glyph: '🌽',
} as unknown as Product;

const search = () =>
  screen.getByPlaceholderText('Nombre, SKU o código de barras');

const renderScan = (online: boolean, catalog: Product[] = [cola, arepa]) => {
  onlineMock.current = online;
  productsMock.current = catalog;
  return render(<ScanScreen />);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  onlineMock.current = true;
  productsMock.current = [];
});

describe('Escanear — offline "datos desactualizados" affordance (FEATURES §4)', () => {
  test('offline: warns that BOTH prices and stock may be outdated', () => {
    renderScan(false);
    expect(screen.getByText('Sin conexión')).toBeDefined();
    expect(
      screen.getByText('Los precios y el stock pueden estar desactualizados.')
    ).toBeDefined();
  });

  test('online: no offline banner is shown', () => {
    renderScan(true);
    expect(screen.queryByText('Sin conexión')).toBeNull();
    expect(screen.queryByText(/pueden estar desactualizados/)).toBeNull();
  });
});

describe('Escanear — offline product search resolves from the cached catalog (FEATURES §4)', () => {
  test('offline: the cached catalog renders and search by name filters it', () => {
    renderScan(false);

    // Read-only offline: both cached products render from the Dexie-backed hook.
    expect(screen.getByText('Coca-Cola 600ml')).toBeDefined();
    expect(screen.getByText('Harina PAN 1kg')).toBeDefined();

    fireEvent.change(search(), { target: { value: 'coca' } });
    expect(screen.getByText('Coca-Cola 600ml')).toBeDefined();
    expect(screen.queryByText('Harina PAN 1kg')).toBeNull();
  });

  test('offline: search by SKU filters the cached catalog', () => {
    renderScan(false);
    fireEvent.change(search(), { target: { value: 'AREPA-1' } });
    expect(screen.getByText('Harina PAN 1kg')).toBeDefined();
    expect(screen.queryByText('Coca-Cola 600ml')).toBeNull();
  });

  test('offline: search by barcode filters the cached catalog', () => {
    renderScan(false);
    fireEvent.change(search(), { target: { value: '7591000000123' } });
    expect(screen.getByText('Coca-Cola 600ml')).toBeDefined();
    expect(screen.queryByText('Harina PAN 1kg')).toBeNull();
  });
});

describe('Escanear — offline HID barcode scan resolves against the cached catalog (FEATURES §4)', () => {
  test('offline: scanning a cached barcode opens that product’s info sheet', () => {
    renderScan(false);

    // HID keyboard-wedge: rapid keystrokes + Enter dispatched on window, then
    // advance the ScannerView READING → LOCKED flow (450 + 350ms).
    act(() => {
      for (const ch of cola.barcode) {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: ch, bubbles: true })
        );
      }
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    act(() => {
      vi.advanceTimersByTime(450 + 350);
    });

    // The scanned barcode matched the cached product → its info sheet opened
    // (the barcode value only appears inside ProductInfoSheet, not in the grid).
    expect(screen.getByText('Código de barras')).toBeDefined();
    expect(screen.getByText('7591000000123')).toBeDefined();
    expect(screen.queryByText('Producto no encontrado')).toBeNull();
  });
});
