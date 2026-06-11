// @vitest-environment jsdom
// CameraScanner — live camera barcode reading via @zxing/browser, plus the
// ScannerView dispatcher that lets the owner alternate camera ↔ physical.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Controllable zxing mock: tests capture the decode callback and can force
// the camera startup to fail with a specific error. It also records how the
// reader was configured (hints/options) and which media constraints were
// requested — real-barcode detection depends on that configuration.
const zxing = vi.hoisted(() => ({
  decodeCb: null as
    | ((result: { getText(): string } | undefined, err?: unknown) => void)
    | null,
  rejectWith: null as Error | null,
  stop: vi.fn(),
  ctorHints: null as Map<unknown, unknown> | null,
  ctorOptions: null as { delayBetweenScanAttempts?: number } | null,
  constraints: null as MediaStreamConstraints | null,
  previewVideo: null as HTMLVideoElement | null,
}));

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    constructor(
      hints?: Map<unknown, unknown>,
      options?: { delayBetweenScanAttempts?: number }
    ) {
      zxing.ctorHints = hints ?? null;
      zxing.ctorOptions = options ?? null;
    }
    async decodeFromConstraints(
      constraints: MediaStreamConstraints,
      video: HTMLVideoElement | undefined,
      cb: (result: { getText(): string } | undefined, err?: unknown) => void
    ) {
      if (zxing.rejectWith) throw zxing.rejectWith;
      zxing.constraints = constraints;
      zxing.previewVideo = video ?? null;
      zxing.decodeCb = cb;
      return { stop: zxing.stop };
    }
  },
}));

import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { CameraScanner } from '@/screens/CameraScanner';
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
  zxing.decodeCb = null;
  zxing.rejectWith = null;
  zxing.stop.mockClear();
  zxing.ctorHints = null;
  zxing.ctorOptions = null;
  zxing.constraints = null;
  zxing.previewVideo = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Flush the async camera startup (decodeFromVideoDevice promise). */
const startCamera = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('CameraScanner', () => {
  // Real-world detection contract: default fast-mode decoding over a 640×480
  // default stream cannot resolve EAN-13 bars at focusable distance — the
  // reader must be tuned and the stream must be HD. These pin both.
  test('tunes the decoder: TRY_HARDER, retail formats only, fast attempts', async () => {
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();

    expect(zxing.ctorHints).not.toBeNull();
    expect(zxing.ctorHints!.get(DecodeHintType.TRY_HARDER)).toBe(true);
    expect(zxing.ctorHints!.get(DecodeHintType.POSSIBLE_FORMATS)).toEqual(
      expect.arrayContaining([
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.QR_CODE,
      ])
    );
    expect(zxing.ctorOptions?.delayBetweenScanAttempts).toBe(150);
  });

  test('requests the rear camera at HD resolution with the live preview wired', async () => {
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();

    expect(zxing.constraints).not.toBeNull();
    const video = zxing.constraints!.video as MediaTrackConstraints;
    expect(video.facingMode).toEqual({ ideal: 'environment' });
    expect(video.width).toEqual({ ideal: 1280 });
    expect(video.height).toEqual({ ideal: 720 });
    expect(zxing.constraints!.audio).toBe(false);
    expect(zxing.previewVideo).toBe(document.querySelector('video'));
  });

  test('starts the camera and scans a known barcode into a found result', async () => {
    const onScanResult = vi.fn();
    render(
      <CameraScanner
        onScanResult={onScanResult}
        catalog={[cola]}
        mode="split"
      />
    );

    expect(screen.getByText('Iniciando cámara…')).toBeDefined();
    await startCamera();
    expect(
      screen.getByText('Apunta la cámara al código de barras')
    ).toBeDefined();
    expect(document.querySelector('video')).not.toBeNull();

    act(() => {
      zxing.decodeCb!({ getText: () => cola.barcode });
    });
    expect(screen.getByText('✓ Código leído')).toBeDefined();
    expect(screen.getByText('EAN-13')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onScanResult).toHaveBeenCalledWith({ found: true, product: cola });
  });

  test('reports unknown codes as misses', async () => {
    const onScanResult = vi.fn();
    render(
      <CameraScanner
        onScanResult={onScanResult}
        catalog={[cola]}
        mode="split"
      />
    );
    await startCamera();

    act(() => {
      zxing.decodeCb!({ getText: () => '9999999999999' });
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onScanResult).toHaveBeenCalledWith({
      found: false,
      code: '9999999999999',
    });
  });

  test('debounces repeated reads of the same code', async () => {
    const onScanResult = vi.fn();
    render(
      <CameraScanner
        onScanResult={onScanResult}
        catalog={[cola]}
        mode="split"
      />
    );
    await startCamera();

    act(() => {
      zxing.decodeCb!({ getText: () => cola.barcode });
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    // The camera keeps streaming the same frame — must not fire twice.
    act(() => {
      zxing.decodeCb!({ getText: () => cola.barcode });
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onScanResult).toHaveBeenCalledTimes(1);

    // After the debounce window the same code scans again.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => {
      zxing.decodeCb!({ getText: () => cola.barcode });
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onScanResult).toHaveBeenCalledTimes(2);
  });

  test('permission denial shows the PRD copy with the manual fallback', async () => {
    zxing.rejectWith = new DOMException('denied', 'NotAllowedError');
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();

    expect(
      screen.getByText(
        'Permiso de cámara denegado. Activa el permiso desde la configuración del navegador o ingresa el código manualmente.'
      )
    ).toBeDefined();
  });

  test('an unavailable camera shows the PRD copy with the manual fallback', async () => {
    zxing.rejectWith = new Error('no camera');
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();

    expect(
      screen.getByText(
        'No se pudo acceder a la cámara. Puedes ingresar el código manualmente.'
      )
    ).toBeDefined();
  });

  test('stops the camera stream on unmount', async () => {
    const view = render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();
    view.unmount();
    expect(zxing.stop).toHaveBeenCalled();
  });
});

describe('ScannerView dispatcher (owner-configured mode)', () => {
  test('defaults to the physical scanner (no camera)', () => {
    render(
      <ScannerView onScanResult={vi.fn()} mode="split" catalog={[cola]} />
    );
    expect(
      screen.getByText('Apunta la cámara al código de barras')
    ).toBeDefined();
    expect(document.querySelector('video')).toBeNull();
  });

  test("renders the camera scanner when the owner chose 'camera'", async () => {
    render(
      <ScannerView
        onScanResult={vi.fn()}
        mode="split"
        catalog={[cola]}
        scannerMode="camera"
      />
    );
    expect(screen.getByText('Iniciando cámara…')).toBeDefined();
    await startCamera();
    expect(document.querySelector('video')).not.toBeNull();
  });
});
