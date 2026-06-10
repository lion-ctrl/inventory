// @vitest-environment jsdom
// ScannerView HID keyboard-wedge support: rapid keystrokes + Enter resolve
// against the catalog with the camera-style READING → LOCKED flow.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ScannerView } from '@/screens/Sale';
import type { Product } from '@/types';

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

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const typeCode = (code: string, target: EventTarget = window) => {
  act(() => {
    for (const ch of code) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    }
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
};

describe('ScannerView (HID wedge)', () => {
  test('a known barcode walks READING → LOCKED → found result', () => {
    const onScanResult = vi.fn();
    render(<ScannerView onScanResult={onScanResult} mode="split" catalog={[cola]} />);

    expect(screen.getByText('Apunta la cámara al código de barras')).toBeDefined();

    typeCode(cola.barcode);
    expect(screen.getByText('Leyendo código…')).toBeDefined();
    expect(screen.getByText('EAN-13')).toBeDefined(); // detected format badge

    act(() => { vi.advanceTimersByTime(450); });
    expect(screen.getByText('✓ Código leído')).toBeDefined();
    expect(onScanResult).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(350); });
    expect(onScanResult).toHaveBeenCalledWith({ found: true, product: cola });
    expect(screen.getByText('Apunta la cámara al código de barras')).toBeDefined();
  });

  test('an unknown barcode reports a miss with the raw code', () => {
    const onScanResult = vi.fn();
    render(<ScannerView onScanResult={onScanResult} mode="split" catalog={[cola]} />);

    typeCode('9999999999999');
    act(() => { vi.advanceTimersByTime(450); });
    expect(onScanResult).toHaveBeenCalledWith({ found: false, code: '9999999999999' });
  });

  test('keystrokes typed into form fields are ignored', () => {
    const onScanResult = vi.fn();
    render(
      <div>
        <input aria-label="caja" />
        <ScannerView onScanResult={onScanResult} mode="split" catalog={[cola]} />
      </div>,
    );

    typeCode(cola.barcode, screen.getByLabelText('caja'));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onScanResult).not.toHaveBeenCalled();
  });

  test('short buffers (under 6 chars) never trigger a read', () => {
    const onScanResult = vi.fn();
    render(<ScannerView onScanResult={onScanResult} mode="split" catalog={[cola]} />);

    typeCode('12345');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onScanResult).not.toHaveBeenCalled();
  });

  test('a second scan during an active read is ignored (busy lock)', () => {
    const onScanResult = vi.fn();
    render(<ScannerView onScanResult={onScanResult} mode="split" catalog={[cola]} />);

    typeCode(cola.barcode);
    typeCode('9999999999999'); // arrives while READING
    act(() => { vi.advanceTimersByTime(450 + 350); });

    expect(onScanResult).toHaveBeenCalledTimes(1);
    expect(onScanResult).toHaveBeenCalledWith({ found: true, product: cola });
  });
});
