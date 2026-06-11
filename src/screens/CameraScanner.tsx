// CameraScanner — live barcode reading through the device camera. The owner
// alternates between this and the physical (HID) scanner in Ajustes → "Modo de
// escaneo". Decoding is pure JS via @zxing/browser (no WASM/CDN fetches, so the
// offline PWA keeps working). Same onScanResult contract as the HID scanner.
import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import type { Product } from '@/types';
// Circular at module level only: detectBarcodeFormat is a hoisted function
// declaration and ScanResult is a type, so the Sale ↔ CameraScanner cycle is safe.
import { detectBarcodeFormat } from './Sale';
import type { ScanResult } from './Sale';

/** Identical frames stream continuously — ignore repeats inside this window. */
const DUPLICATE_READ_WINDOW_MS = 1500;
/** Brief LOCKED state so the cashier sees the read confirmation (matches HID). */
const LOCK_MS = 350;
/** ~7 decode attempts/s; the default 500ms reads as a dead scanner. */
const SCAN_ATTEMPT_INTERVAL_MS = 150;

// Without TRY_HARDER, ZXing's fast mode samples too few image rows to resolve
// retail EAN-13 bars from a live feed; restricting formats to what the store
// actually sells keeps each attempt's budget on the codes that matter.
const DECODE_HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.QR_CODE,
    ],
  ],
]);

// Browsers default to ~640×480, where EAN-13 modules fall below ZXing's
// resolving threshold at any distance the lens can focus. All values are
// `ideal`, so a front-only or 480p webcam still works instead of erroring.
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

type CameraState =
  | 'starting'
  | 'scanning'
  | 'locked'
  | 'denied'
  | 'unavailable';

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
    let controls: IScannerControls | null = null;
    const reader = new BrowserMultiFormatReader(DECODE_HINTS, {
      delayBetweenScanAttempts: SCAN_ATTEMPT_INTERVAL_MS,
    });

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

    const start = async () => {
      try {
        const c = await reader.decodeFromConstraints(
          CAMERA_CONSTRAINTS,
          videoRef.current ?? undefined,
          (result) => {
            if (cancelled || !result) return;
            handleDetection(result.getText());
          }
        );
        if (cancelled) {
          c.stop();
          return;
        }
        controls = c;
        setState('scanning');
      } catch (e) {
        if (cancelled) return;
        setState(
          (e as { name?: string })?.name === 'NotAllowedError'
            ? 'denied'
            : 'unavailable'
        );
      }
    };
    void start();

    return () => {
      cancelled = true;
      controls?.stop();
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
    </div>
  );
}
