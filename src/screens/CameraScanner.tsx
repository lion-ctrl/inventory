// CameraScanner — live barcode reading through the device camera. The owner
// alternates between this and the physical (HID) scanner in Ajustes → "Modo de
// escaneo". Decoding runs in zxing-cpp compiled to WASM (zxing-wasm/reader):
// far stronger 1D detection on live frames than the old @zxing/browser JS port.
// The binary is bundled by Vite and self-hosted (no CDN fetches, so the
// offline PWA keeps working). Same onScanResult contract as the HID scanner.
import { useEffect, useRef, useState } from 'react';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import type { ReaderOptions } from 'zxing-wasm/reader';
// Vite resolves this to the hashed URL of the wasm asset emitted with the
// build, which the service worker precaches alongside the JS.
import readerWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { Product } from '@/types';
// Circular at module level only: detectBarcodeFormat is a hoisted function
// declaration and ScanResult is a type, so the Sale ↔ CameraScanner cycle is safe.
import { detectBarcodeFormat } from './Sale';
import type { ScanResult } from './Sale';

/** Identical frames stream continuously — ignore repeats inside this window. */
const DUPLICATE_READ_WINDOW_MS = 1500;
/** Brief LOCKED state so the cashier sees the read confirmation (matches HID). */
const LOCK_MS = 350;
/** ~7 decode attempts/s; anything slower reads as a dead scanner. */
const SCAN_ATTEMPT_INTERVAL_MS = 150;

// zxing-wasm fetches its .wasm from the jsDelivr CDN by default — useless
// offline. locateFile pins the Vite-bundled binary instead. The overrides
// object identity is stable across mounts, so the compiled module is prepared
// once and reused (prepareZXingModule caches by overrides equality).
const ZXING_MODULE_OPTIONS = {
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? readerWasmUrl : prefix + path,
  },
};

// Restricting formats to what the store actually sells keeps each attempt's
// budget on the codes that matter; tryHarder/tryRotate/tryInvert run the
// accuracy-first paths that resolve small EAN-13 bars from live frames, and
// maxNumberOfSymbols stops after the first hit (a POS scans one code at a time).
// Format names are zxing-wasm 3.x canonical (unhyphenated) and are pinned
// against the REAL engine in tests/integration/zxing-formats.test.ts — an
// invalid name would not throw: readBarcodes resolves with a sentinel
// empty-text result, i.e. it would fail completely silently.
const READER_OPTIONS: ReaderOptions = {
  formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

// Browsers default to ~640×480, where EAN-13 modules fall below the decoder's
// resolving threshold at any distance the lens can focus. 1080p matters most
// on fixed-focus webcams: the code is only sharp at arm's length, so detection
// depends on having enough pixels per bar at that small apparent size. All
// values are `ideal`, so a front-only or low-res webcam still works.
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

type CameraState =
  | 'starting'
  | 'scanning'
  | 'locked'
  | 'denied'
  | 'unavailable';

// --- Dev-only diagnostics ---------------------------------------------------
// Live decoding can fail silently on real hardware (the pump runs, the decoder
// finds nothing, every error is swallowed). In dev builds a small overlay
// exposes what the pump actually sees — granted stream size, wasm state,
// tick/decode counters, last error — and can save the exact decoder input
// frame for offline analysis. `import.meta.env.DEV` is statically false in
// production builds, so all of it is dead-code-eliminated there.

// Diagnostics tooling kept for future camera debugging — set this to true (and
// run a dev build) to re-enable the overlay strip. It proved the live decode
// tracing + frame-capture workflow during the 2026-06 scanner investigation;
// with the scanner now confirmed working on real hardware the strip stays
// hidden. Only the overlay and its snapshot publishing hang off this switch:
// the pump's error recording and warn-once console trace stay always on.
const SHOW_SCANNER_DIAGNOSTICS = false;

interface ScanDiagnostics {
  /** Granted stream label: videoWidth×videoHeight plus track settings. */
  camera: string;
  /** zxing-wasm module state: cargando | listo | error: <message>. */
  wasm: string;
  /** Pump ticks attempted (including frames skipped while locked/not ready). */
  ticks: number;
  /** Frames actually handed to readBarcodes. */
  decodes: number;
  /** Symbol count returned by the last readBarcodes call. */
  lastResultCount: number;
  /** Message of the last error thrown inside the pump, if any. */
  lastError: string | null;
}

const createDiagnostics = (): ScanDiagnostics => ({
  camera: '—',
  wasm: 'cargando',
  ticks: 0,
  decodes: 0,
  lastResultCount: 0,
  lastError: null,
});

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Publish the overlay snapshot every Nth tick (~600ms at 150ms/tick). */
const DIAG_PUBLISH_EVERY_TICKS = 4;

export interface CameraScannerProps {
  onScanResult: (r: ScanResult) => void;
  catalog: Product[];
  mode?: 'scroll' | 'split';
  density?: string;
}

export function CameraScanner({
  onScanResult,
  catalog,
  mode = 'scroll',
  density = 'roomy',
}: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CameraState>('starting');
  const [lastCode, setLastCode] = useState<string | null>(null);
  const lastReadRef = useRef<{ code: string; at: number } | null>(null);
  const busyRef = useRef(false);

  // Dev diagnostics: hot counters mutate a ref on every tick; the overlay
  // re-renders only from batched snapshots (`diag`), never per tick.
  const diagRef = useRef<ScanDiagnostics>(createDiagnostics());
  const [diag, setDiag] = useState<ScanDiagnostics>(createDiagnostics);
  const warnedErrorsRef = useRef<Set<string>>(new Set());
  const captureFrameRef = useRef<(() => void) | null>(null);

  // Latest props without re-starting the camera stream on every render —
  // synced in an effect (detection callbacks fire async, well after paint).
  const catalogRef = useRef(catalog);
  const onScanResultRef = useRef(onScanResult);
  useEffect(() => {
    catalogRef.current = catalog;
    onScanResultRef.current = onScanResult;
  });

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');

    const stopStream = (s: MediaStream | null) => {
      s?.getTracks().forEach((t) => t.stop());
    };

    const handleDetection = (code: string) => {
      if (busyRef.current) return;
      const now = Date.now();
      const last = lastReadRef.current;
      if (
        last &&
        last.code === code &&
        now - last.at < DUPLICATE_READ_WINDOW_MS
      )
        return;
      lastReadRef.current = { code, at: now };
      busyRef.current = true;
      setLastCode(code);
      setState('locked');
      window.setTimeout(() => {
        if (cancelled) return;
        busyRef.current = false;
        setLastCode(null);
        setState('scanning');
        const product = catalogRef.current.find((p) => p.barcode === code);
        if (product) onScanResultRef.current({ found: true, product });
        else onScanResultRef.current({ found: false, code });
      }, LOCK_MS);
    };

    // --- Dev diagnostics plumbing (inert in production builds) ---
    const publishDiagnostics = () => {
      if (!SHOW_SCANNER_DIAGNOSTICS || !import.meta.env.DEV || cancelled)
        return;
      setDiag({ ...diagRef.current });
    };

    const updateCameraDiagnostics = () => {
      const width = video?.videoWidth ?? 0;
      const height = video?.videoHeight ?? 0;
      // Optional-chained: test doubles (and ancient engines) may lack the
      // track APIs; the element size alone is still worth showing.
      const settings = stream?.getVideoTracks?.()[0]?.getSettings?.();
      let label = `${width}×${height}`;
      if (settings?.frameRate) label += `@${Math.round(settings.frameRate)}`;
      if (
        settings?.width &&
        settings?.height &&
        (settings.width !== width || settings.height !== height)
      ) {
        label += ` · pista: ${settings.width}×${settings.height}`;
      }
      diagRef.current.camera = label;
    };

    const recordPumpError = (e: unknown) => {
      const message = errorMessage(e);
      const changed = diagRef.current.lastError !== message;
      diagRef.current.lastError = message;
      if (!import.meta.env.DEV) return;
      if (!warnedErrorsRef.current.has(message)) {
        warnedErrorsRef.current.add(message);
        console.warn('[CameraScanner] frame decode failed:', message);
      }
      // Publish immediately only when the message changes — a persistent
      // failure repeating every tick must not turn into a setState storm.
      if (changed) publishDiagnostics();
    };

    const scheduleTick = () => {
      timer = window.setTimeout(() => void tick(), SCAN_ATTEMPT_INTERVAL_MS);
    };

    // Frame pump. setTimeout-chained (not setInterval): the next attempt is
    // armed only after the current decode settles, so readBarcodes calls never
    // overlap even when a frame takes longer than the nominal interval.
    const tick = async () => {
      if (cancelled) return;
      diagRef.current.ticks += 1;
      if (SHOW_SCANNER_DIAGNOSTICS && import.meta.env.DEV)
        updateCameraDiagnostics();
      const publishThisTick =
        diagRef.current.ticks % DIAG_PUBLISH_EVERY_TICKS === 1;
      // Skip frames while the lock window plays out or before the stream
      // reports its real size (videoWidth is 0 until metadata arrives).
      if (busyRef.current || !video || video.videoWidth === 0) {
        if (publishThisTick) publishDiagnostics();
        scheduleTick();
        return;
      }
      try {
        // Decode at the intrinsic stream resolution: EAN-13 bars need every
        // pixel the sensor captured; the CSS preview size is far smaller.
        const width = video.videoWidth;
        const height = video.videoHeight;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          diagRef.current.decodes += 1;
          const results = await readBarcodes(imageData, READER_OPTIONS);
          diagRef.current.lastResultCount = results.length;
          if (cancelled) return;
          const text = results[0]?.text;
          if (text) handleDetection(text);
        }
      } catch (e) {
        // One bad frame (canvas or decoder hiccup) must not kill the pump —
        // but it must leave a trace; silent catches made live-decode
        // failures on real hardware undiagnosable.
        recordPumpError(e);
      }
      if (cancelled) return;
      if (publishThisTick) publishDiagnostics();
      scheduleTick();
    };

    const start = async () => {
      try {
        const media =
          await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        if (cancelled) {
          stopStream(media);
          return;
        }
        stream = media;
        if (video) {
          video.srcObject = media;
          try {
            await video.play();
          } catch {
            // Autoplay quirks (and jsdom's unimplemented play) — the pump
            // only needs frames flowing, not the play() promise.
          }
        }
        // The decoder must be compiled before the first frame; a wasm load
        // failure degrades to 'unavailable' with the manual-entry fallback.
        try {
          await prepareZXingModule({
            ...ZXING_MODULE_OPTIONS,
            fireImmediately: true,
          });
        } catch (e) {
          diagRef.current.wasm = `error: ${errorMessage(e)}`;
          publishDiagnostics();
          throw e; // outer catch keeps the existing degradation path
        }
        diagRef.current.wasm = 'listo';
        publishDiagnostics();
        if (cancelled) return;
        setState('scanning');
        scheduleTick();
      } catch (e) {
        stopStream(stream);
        stream = null;
        if (cancelled) return;
        setState(
          (e as { name?: string })?.name === 'NotAllowedError'
            ? 'denied'
            : 'unavailable'
        );
      }
    };
    void start();

    if (SHOW_SCANNER_DIAGNOSTICS && import.meta.env.DEV) {
      // 'Guardar fotograma': saves EXACTLY the bitmap the decoder receives —
      // same canvas, same intrinsic-size draw as the pump — so a problem
      // frame can be re-decoded offline.
      captureFrameRef.current = () => {
        if (!video || video.videoWidth === 0) return;
        const width = video.videoWidth;
        const height = video.videoHeight;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'scan-frame.png';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
        }, 'image/png');
      };
    }

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (video) video.srcObject = null;
      stopStream(stream);
      stream = null;
      captureFrameRef.current = null;
    };
  }, []);

  const locked = state === 'locked';
  const aspect = mode === 'split' ? 'wide' : density === 'dense' ? 'wide' : '';
  const detectedFormat = locked ? detectBarcodeFormat(lastCode) : null;

  // PRD §19.3/§19.4 copy — manual entry stays available as the fallback.
  const errorCopy =
    state === 'denied'
      ? 'Permiso de cámara denegado. Activa el permiso desde la configuración del navegador o ingresa el código manualmente.'
      : state === 'unavailable'
        ? 'No se pudo acceder a la cámara. Puedes ingresar el código manualmente.'
        : null;

  return (
    <div
      className={`scanner-wrap ${aspect}`}
      style={{ margin: '0px 4px 0px 3px' }}
    >
      <div className="cam-bg" style={{ margin: '0px' }} />
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
      {detectedFormat && (
        <div className={`scan-format ${locked ? 'locked' : ''}`}>
          <span className="led" />
          {detectedFormat}
        </div>
      )}
      <div className={`scan-frame ${locked ? 'locked' : ''}`}>
        <i />
      </div>
      {state === 'scanning' && <div className="scan-beam" />}
      <div className={`scan-hint ${locked ? 'locked' : ''}`}>
        {errorCopy ??
          (state === 'starting'
            ? 'Iniciando cámara…'
            : locked
              ? '✓ Código leído'
              : 'Apunta la cámara al código de barras')}
      </div>
      {SHOW_SCANNER_DIAGNOSTICS && import.meta.env.DEV && (
        // Diagnostics strip — flag-gated, dev builds only (DCE'd in
        // production). Read-only except the capture button, so it never
        // interferes with scanning.
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 3,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '2px 10px',
            padding: '3px 6px',
            fontFamily: 'monospace',
            fontSize: 10,
            lineHeight: 1.5,
            textAlign: 'left',
            color: '#dfe6ee',
            background: 'rgba(8, 12, 18, 0.65)',
            pointerEvents: 'none',
          }}
        >
          <span>{`cámara: ${diag.camera} · wasm: ${diag.wasm}`}</span>
          <span>
            {`intentos: ${diag.ticks} · lecturas: ${diag.decodes} · resultados: ${diag.lastResultCount} · último error: ${diag.lastError ?? '—'}`}
          </span>
          <button
            type="button"
            onClick={() => captureFrameRef.current?.()}
            style={{
              pointerEvents: 'auto',
              marginLeft: 'auto',
              padding: '1px 6px',
              font: 'inherit',
              color: 'inherit',
              background: 'rgba(255, 255, 255, 0.14)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Guardar fotograma
          </button>
        </div>
      )}
    </div>
  );
}
