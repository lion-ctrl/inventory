// @vitest-environment jsdom
// CameraScanner — live camera barcode reading via zxing-wasm (zxing-cpp), plus
// the ScannerView dispatcher that lets the owner alternate camera ↔ physical.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Controllable zxing-wasm mock: tests arm one frame's decode result at a time
// (one-shot — consumed by the next pump tick) and can force the wasm module
// init to fail. It records the ReaderOptions and module overrides used —
// real-barcode detection and offline operation depend on that configuration.
const zx = vi.hoisted(() => ({
  /** One-shot decode payload for the next readBarcodes call. */
  results: [] as Array<{ text: string; format: string; isValid: boolean }>,
  /** One-shot rejection for the next readBarcodes call (pump error path). */
  readError: null as Error | null,
  /** Every prepareZXingModule call (module overrides + fireImmediately). */
  prepareCalls: [] as Array<
    | {
        fireImmediately?: boolean;
        overrides?: {
          locateFile?: (path: string, prefix: string) => string;
        };
      }
    | undefined
  >,
  wasmInitError: null as Error | null,
  readerOptions: null as {
    formats?: string[];
    tryHarder?: boolean;
    tryRotate?: boolean;
    tryInvert?: boolean;
    tryDownscale?: boolean;
    maxNumberOfSymbols?: number;
  } | null,
  decodeInputs: [] as unknown[],
}));

vi.mock('zxing-wasm/reader', () => ({
  prepareZXingModule: (options?: (typeof zx.prepareCalls)[number]) => {
    zx.prepareCalls.push(options);
    if (options?.fireImmediately) {
      return zx.wasmInitError
        ? Promise.reject(zx.wasmInitError)
        : Promise.resolve({});
    }
    return undefined;
  },
  readBarcodes: (input: unknown, options: unknown) => {
    zx.decodeInputs.push(input);
    zx.readerOptions = options as typeof zx.readerOptions;
    if (zx.readError) {
      const error = zx.readError;
      zx.readError = null; // one-shot, like results
      return Promise.reject(error);
    }
    const results = zx.results;
    zx.results = []; // one-shot: the following frames are "empty"
    return Promise.resolve(results);
  },
}));

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

// jsdom has no camera and no canvas: getUserMedia, the 2D context, video.play,
// canvas.toBlob and the object-URL pair are stubbed so the engine can run its
// real frame-pump and frame-capture logic.
let getUserMedia: ReturnType<
  typeof vi.fn<(constraints: MediaStreamConstraints) => Promise<unknown>>
>;
let trackStop: ReturnType<typeof vi.fn<() => void>>;
let fakeStream: {
  getTracks: () => Array<{ stop: () => void }>;
  getVideoTracks: () => Array<{ getSettings: () => MediaTrackSettings }>;
};
let ctx2d: {
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
};
let toBlobStub: ReturnType<
  typeof vi.fn<(callback: BlobCallback, type?: string) => void>
>;
let createObjectURL: ReturnType<
  typeof vi.fn<(obj: Blob | MediaSource) => string>
>;
let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  zx.results = [];
  zx.readError = null;
  zx.prepareCalls = [];
  zx.wasmInitError = null;
  zx.readerOptions = null;
  zx.decodeInputs = [];

  trackStop = vi.fn<() => void>();
  fakeStream = {
    getTracks: () => [{ stop: trackStop }],
    // The dev diagnostics overlay reads the granted track settings.
    getVideoTracks: () => [
      { getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }) },
    ],
  };
  getUserMedia = vi.fn(
    (_constraints: MediaStreamConstraints): Promise<unknown> =>
      Promise.resolve(fakeStream)
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });

  ctx2d = {
    drawImage: vi.fn(),
    getImageData: vi.fn((x: number, y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx2d
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // jsdom implements neither toBlob nor object URLs (frame-capture flow).
  toBlobStub = vi.fn((callback: BlobCallback, type?: string) => {
    callback(new Blob(['frame'], { type: type ?? 'image/png' }));
  });
  HTMLCanvasElement.prototype.toBlob = toBlobStub;
  createObjectURL = vi.fn((_obj: Blob | MediaSource) => 'blob:scan-frame');
  revokeObjectURL = vi.fn((_url: string) => undefined);
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    writable: true,
    value: null,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Flush the async camera startup (getUserMedia → play → wasm init chain). */
const startCamera = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** The pump reads the intrinsic stream size; jsdom reports 0×0 by default. */
const primeVideo = (width = 1280, height = 720) => {
  const video = document.querySelector('video') as HTMLVideoElement;
  Object.defineProperty(video, 'videoWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(video, 'videoHeight', {
    configurable: true,
    value: height,
  });
};

/** Advance fake time and flush the decode/lock microtask chain. */
const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Arm one frame with a decode result and run exactly one pump tick. */
const scanFrame = async (text: string, format = 'EAN13') => {
  zx.results = [{ text, format, isValid: true }];
  await advance(150);
};

describe('CameraScanner', () => {
  // Real-world detection contract: the decoder must be restricted to the
  // formats the store sells and run in accuracy mode (tryHarder + rotate +
  // invert) over frames captured at the stream's intrinsic resolution.
  // The format names are EXACT-matched on purpose: this mock can only record
  // what the component sends; tests/integration/zxing-formats.test.ts proves
  // this same list against the real wasm engine (where an invalid name would
  // fail silently), so the two tests together pin component → vocabulary.
  test('tunes the decoder: retail formats, tryHarder, intrinsic-size frames', async () => {
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();
    primeVideo(1280, 720);
    await scanFrame(cola.barcode);

    expect(zx.readerOptions).not.toBeNull();
    expect(zx.readerOptions!.formats).toEqual([
      'EAN13',
      'EAN8',
      'UPCA',
      'UPCE',
      'Code128',
      'Code39',
      'QRCode',
    ]);
    expect(zx.readerOptions!.tryHarder).toBe(true);
    expect(zx.readerOptions!.tryRotate).toBe(true);
    expect(zx.readerOptions!.tryInvert).toBe(true);
    expect(zx.readerOptions!.tryDownscale).toBe(true);
    expect(zx.readerOptions!.maxNumberOfSymbols).toBe(1);
    // Frames are grabbed at videoWidth×videoHeight, not the CSS preview size.
    expect(ctx2d.getImageData).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(zx.decodeInputs.length).toBeGreaterThan(0);
  });

  test('self-hosts the wasm binary instead of the default CDN fetch', async () => {
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();

    const prep = zx.prepareCalls.find((c) => c?.overrides?.locateFile);
    expect(prep).toBeDefined();
    expect(prep!.fireImmediately).toBe(true);
    const locate = prep!.overrides!.locateFile!;
    // The .wasm request must NOT resolve to the library's CDN default…
    expect(locate('zxing_reader.wasm', 'https://fake.cdn/')).not.toBe(
      'https://fake.cdn/zxing_reader.wasm'
    );
    expect(typeof locate('zxing_reader.wasm', 'https://fake.cdn/')).toBe(
      'string'
    );
    // …while non-wasm assets keep the standard prefix resolution.
    expect(locate('glue.js', 'https://fake.cdn/')).toBe(
      'https://fake.cdn/glue.js'
    );
  });

  test('requests the rear camera at HD resolution with the live preview wired', async () => {
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const constraints = getUserMedia.mock.calls[0][0];
    const video = constraints.video as MediaTrackConstraints;
    expect(video.facingMode).toEqual({ ideal: 'environment' });
    expect(video.width).toEqual({ ideal: 1920 });
    expect(video.height).toEqual({ ideal: 1080 });
    expect(constraints.audio).toBe(false);
    const preview = document.querySelector('video') as HTMLVideoElement;
    expect(preview).not.toBeNull();
    expect(preview.srcObject).toBe(fakeStream);
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
    primeVideo();

    await scanFrame(cola.barcode);
    expect(screen.getByText('✓ Código leído')).toBeDefined();
    expect(screen.getByText('EAN-13')).toBeDefined();

    await advance(350);
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
    primeVideo();

    await scanFrame('9999999999999');
    await advance(350);
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
    primeVideo();

    await scanFrame(cola.barcode);
    await advance(350);
    // The camera keeps streaming the same frame — must not fire twice.
    await scanFrame(cola.barcode);
    await advance(350);
    expect(onScanResult).toHaveBeenCalledTimes(1);

    // After the debounce window the same code scans again.
    await advance(1500);
    await scanFrame(cola.barcode);
    await advance(350);
    expect(onScanResult).toHaveBeenCalledTimes(2);
  });

  test('permission denial shows the PRD copy with the manual fallback', async () => {
    getUserMedia.mockImplementation(() =>
      Promise.reject(new DOMException('denied', 'NotAllowedError'))
    );
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
    getUserMedia.mockImplementation(() =>
      Promise.reject(new Error('no camera'))
    );
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

  test('a wasm init failure degrades to the unavailable copy', async () => {
    zx.wasmInitError = new Error('wasm fetch failed');
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();

    expect(
      screen.getByText(
        'No se pudo acceder a la cámara. Puedes ingresar el código manualmente.'
      )
    ).toBeDefined();
    // The camera light must not stay on after a failed start.
    expect(trackStop).toHaveBeenCalled();
  });

  test('stops the camera stream on unmount', async () => {
    const view = render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();
    const video = document.querySelector('video') as HTMLVideoElement;
    view.unmount();
    expect(trackStop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
  });
});

// Live decoding works in synthetic tests yet finds nothing on some real
// hardware. The dev-only diagnostics strip exposes what the pump actually
// sees (granted resolution, wasm state, tick/decode counters, last error) and
// can save the exact decoder input frame for offline analysis.
// Skipped while SHOW_SCANNER_DIAGNOSTICS=false in CameraScanner.tsx — these document the overlay's contract for when it gets re-enabled.
describe.skip('CameraScanner diagnostics overlay (dev only)', () => {
  test('shows the wasm state and the granted camera resolution', async () => {
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();

    // The strip is rendered in dev builds with the module already compiled.
    expect(
      screen.getByRole('button', { name: 'Guardar fotograma' })
    ).toBeDefined();
    expect(screen.getByText(/wasm: listo/)).toBeDefined();

    // Once the stream reports its intrinsic size, the overlay shows the
    // real granted resolution plus the track's frame rate.
    primeVideo(1280, 720);
    await advance(150);
    expect(screen.getByText(/cámara: 1280×720@30/)).toBeDefined();
  });

  test('counts pump ticks and decode attempts live', async () => {
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();
    primeVideo();

    const counters = () => {
      const text = screen.getByText(/intentos: \d+/).textContent ?? '';
      return {
        ticks: Number(/intentos: (\d+)/.exec(text)?.[1]),
        decodes: Number(/lecturas: (\d+)/.exec(text)?.[1]),
      };
    };

    for (let i = 0; i < 5; i++) await advance(150);
    const first = counters();
    expect(first.ticks).toBeGreaterThan(0);
    expect(first.decodes).toBeGreaterThan(0);

    for (let i = 0; i < 4; i++) await advance(150);
    const later = counters();
    expect(later.ticks).toBeGreaterThan(first.ticks);
    expect(later.decodes).toBeGreaterThan(first.decodes);
  });

  test('a readBarcodes failure surfaces in the overlay and the pump survives', async () => {
    const onScanResult = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <CameraScanner
        onScanResult={onScanResult}
        catalog={[cola]}
        mode="split"
      />
    );
    await startCamera();
    primeVideo();

    zx.readError = new Error('descodificador roto');
    await advance(150);
    expect(screen.getByText(/último error: descodificador roto/)).toBeDefined();

    // The same failure repeating must warn only once (per distinct message).
    zx.readError = new Error('descodificador roto');
    await advance(150);
    const decodeWarns = warn.mock.calls.filter((call) =>
      call.some((arg) => String(arg).includes('descodificador roto'))
    );
    expect(decodeWarns).toHaveLength(1);

    // The pump keeps scheduling: a later armed frame still decodes.
    await scanFrame(cola.barcode);
    expect(screen.getByText('✓ Código leído')).toBeDefined();
    await advance(350);
    expect(onScanResult).toHaveBeenCalledWith({ found: true, product: cola });
    warn.mockRestore();
  });

  test("'Guardar fotograma' downloads the current decoder frame as a PNG", async () => {
    render(
      <CameraScanner onScanResult={vi.fn()} catalog={[cola]} mode="split" />
    );
    await startCamera();
    primeVideo(1280, 720);
    await advance(150);

    const clicks: Array<{ download: string; href: string }> = [];
    const anchorClick = vi
      .spyOn(HTMLElement.prototype, 'click')
      .mockImplementation(function (this: HTMLElement) {
        const anchor = this as HTMLAnchorElement;
        clicks.push({
          download: anchor.download,
          href: anchor.getAttribute('href') ?? '',
        });
      });

    fireEvent.click(screen.getByRole('button', { name: 'Guardar fotograma' }));

    // The capture re-draws the live video at the intrinsic stream size —
    // exactly the bitmap readBarcodes receives.
    const drawCalls = ctx2d.drawImage.mock.calls;
    const lastDraw = drawCalls[drawCalls.length - 1] as unknown[];
    expect(lastDraw.slice(1)).toEqual([0, 0, 1280, 720]);
    expect(toBlobStub).toHaveBeenCalledTimes(1);
    expect(toBlobStub.mock.calls[0][1]).toBe('image/png');
    expect(clicks).toEqual([
      { download: 'scan-frame.png', href: 'blob:scan-frame' },
    ]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:scan-frame');
    anchorClick.mockRestore();
  });
});

// The scanner is confirmed working on real hardware, so the diagnostics strip
// is switched off via SHOW_SCANNER_DIAGNOSTICS: it must stay out of the DOM
// even in dev builds, without disturbing the scan pipeline — and the pump's
// always-on error handling (recording + warn-once) must survive the gating.
describe('CameraScanner diagnostics overlay (disabled by flag)', () => {
  test('renders no diagnostics strip while scanning keeps working', async () => {
    const onScanResult = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <CameraScanner
        onScanResult={onScanResult}
        catalog={[cola]}
        mode="split"
      />
    );
    await startCamera();
    primeVideo(1280, 720);

    // No strip even though import.meta.env.DEV is true under vitest.
    expect(
      screen.queryByRole('button', { name: 'Guardar fotograma' })
    ).toBeNull();
    expect(screen.queryByText(/wasm:/)).toBeNull();
    expect(screen.queryByText(/intentos:/)).toBeNull();

    // Pump errors are still recorded and warned once per distinct message,
    // overlay or not — there is just no strip to surface them in.
    zx.readError = new Error('descodificador roto');
    await advance(150);
    zx.readError = new Error('descodificador roto');
    await advance(150);
    const decodeWarns = warn.mock.calls.filter((call) =>
      call.some((arg) => String(arg).includes('descodificador roto'))
    );
    expect(decodeWarns).toHaveLength(1);
    expect(screen.queryByText(/último error/)).toBeNull();

    // The pump survived the failures and scanning works end to end.
    await scanFrame(cola.barcode);
    expect(screen.getByText('✓ Código leído')).toBeDefined();
    await advance(350);
    expect(onScanResult).toHaveBeenCalledWith({ found: true, product: cola });
    expect(
      screen.queryByRole('button', { name: 'Guardar fotograma' })
    ).toBeNull();
    warn.mockRestore();
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
