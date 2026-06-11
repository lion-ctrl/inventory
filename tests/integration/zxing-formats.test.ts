// @vitest-environment node
// Integration contract for the camera scanner's decoder vocabulary.
//
// The CameraScanner component tests mock 'zxing-wasm/reader', so they pin the
// ReaderOptions the component SENDS but cannot prove the format names mean
// anything to the real engine: a misspelled format would be recorded happily
// by the mock and decode nothing on hardware. This suite runs the REAL wasm
// engine (the exact binary the app bundles) against a synthetic EAN-13 frame,
// so a vocabulary rename in a future zxing-wasm upgrade fails loudly here
// instead of silently in the field.
//
// Verified against zxing-wasm 3.1.0 (zxing-cpp ZX_BCF_LIST):
// - Canonical reader names are UNHYPHENATED: 'EAN13', 'EAN8', 'UPCA', 'UPCE',
//   'Code128', 'Code39', 'QRCode' (runtime export BARCODE_FORMATS).
// - Hyphenated HRI labels ('EAN-13', 'UPC-A', ...) are accepted aliases.
// - Invalid names DO NOT throw and DO NOT return []: readBarcodes resolves
//   with a single sentinel result { text: '', isValid: false, error: "This is
//   not a valid barcode format: ..." }. Downstream that is indistinguishable
//   from "no barcode found" unless `error` is inspected — a misspelling would
//   be completely silent (the scanner's dev overlay only records THROWN
//   errors, so not even "último error" would surface it).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  BARCODE_FORMATS,
  prepareZXingModule,
  readBarcodes,
} from 'zxing-wasm/reader';
import type { ReadInputBarcodeFormat, ReaderOptions } from 'zxing-wasm/reader';

// Mirrors READER_OPTIONS in src/screens/CameraScanner.tsx. The component is
// deliberately NOT imported: it drags in React, the Sale screen and a Vite
// `?url` wasm import that have no place in a Node integration test. Drift is
// still covered: tests/components/camera-scanner.test.tsx asserts the
// component sends exactly this configuration, and this suite proves the
// configuration decodes on the real engine.
const APP_FORMATS: ReadInputBarcodeFormat[] = [
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  'Code128',
  'Code39',
  'QRCode',
];
const APP_READER_OPTIONS: ReaderOptions = {
  formats: APP_FORMATS,
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

/** A real Venezuelan retail EAN-13 (valid checksum, first digit 7 → LGLGLG). */
const EAN13_TEXT = '7591473005249';

// --- Synthetic EAN-13 rendering (no image files, no extra dependencies) ----
// Spec recap: 95 modules = start guard 101 + six left digits (7 modules each,
// L or G code chosen by the first digit's parity pattern) + middle guard
// 01010 + six right digits (R codes) + end guard 101. G is the reversed
// bitwise complement of L; R is the bitwise complement of L.

/** L-codes (odd parity) for digits 0-9. */
const L_CODES = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
] as const;

/** First digit → parity pattern of the six left-half digits. */
const FIRST_DIGIT_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
] as const;

const complement = (bits: string): string =>
  bits
    .split('')
    .map((b) => (b === '0' ? '1' : '0'))
    .join('');
const gCode = (digit: number): string =>
  complement(L_CODES[digit]).split('').reverse().join('');
const rCode = (digit: number): string => complement(L_CODES[digit]);

/** Full 95-module bar pattern ('1' = black) for a 13-digit EAN-13 string. */
function ean13Modules(digits: string): string {
  const ds = digits.split('').map(Number);
  const parity = FIRST_DIGIT_PARITY[ds[0]];
  let modules = '101';
  for (let i = 1; i <= 6; i++) {
    modules += parity[i - 1] === 'L' ? L_CODES[ds[i]] : gCode(ds[i]);
  }
  modules += '01010';
  for (let i = 7; i <= 12; i++) modules += rCode(ds[i]);
  return modules + '101';
}

/**
 * Renders the barcode as the RGBA ImageData-shaped frame readBarcodes accepts:
 * black bars on white, 4 px per module, quiet zones of 12 modules (spec
 * minimum is ~10) on both sides.
 */
function renderEan13(
  digits: string,
  modulePx = 4,
  quietModules = 12,
  height = 160
): ImageData {
  const modules = ean13Modules(digits);
  const width = (modules.length + quietModules * 2) * modulePx;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] !== '1') continue;
    const x0 = (quietModules + i) * modulePx;
    for (let y = 0; y < height; y++) {
      for (let x = x0; x < x0 + modulePx; x++) {
        const offset = (y * width + x) * 4;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0; // alpha stays 255 from fill()
      }
    }
  }
  return { data, width, height, colorSpace: 'srgb' };
}

beforeAll(async () => {
  // zxing-wasm 3.1.0 ships no Node loader: the emscripten glue only wires
  // fetch-based loading in browser/worker/Bun scopes, and its default
  // locateFile points at the jsDelivr CDN. Instantiating from the package's
  // own binary keeps the test offline-safe and pins the EXACT engine version
  // the app bundles.
  const nodeRequire = createRequire(import.meta.url);
  const wasmBinary = readFileSync(
    nodeRequire.resolve('zxing-wasm/reader/zxing_reader.wasm')
  );
  await prepareZXingModule({
    overrides: {
      // Params annotated explicitly: EmscriptenModule lives in zxing-wasm's
      // own @types/emscripten dependency, which this project does not include.
      instantiateWasm(
        imports: WebAssembly.Imports,
        successCallback: (instance: WebAssembly.Instance) => void
      ) {
        void WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) =>
          successCallback(instance)
        );
        return {};
      },
    },
    fireImmediately: true,
  });
});

describe('zxing-wasm format vocabulary (real engine, no mocks)', () => {
  test('the synthetic EAN-13 fixture is structurally valid', () => {
    const modules = ean13Modules(EAN13_TEXT);
    expect(modules).toHaveLength(95);
    expect(modules.startsWith('101')).toBe(true);
    expect(modules.endsWith('101')).toBe(true);
    expect(modules.slice(45, 50)).toBe('01010');
  });

  test("the app's exact READER_OPTIONS decode a retail EAN-13", async () => {
    const results = await readBarcodes(
      renderEan13(EAN13_TEXT),
      APP_READER_OPTIONS
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      text: EAN13_TEXT,
      format: 'EAN13',
      isValid: true,
    });
  });

  test("'EAN13' (the unhyphenated spelling the app uses) is the canonical name", async () => {
    const results = await readBarcodes(renderEan13(EAN13_TEXT), {
      formats: ['EAN13'],
      tryHarder: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe(EAN13_TEXT);
  });

  test("the hyphenated HRI label 'EAN-13' is an accepted alias", async () => {
    const results = await readBarcodes(renderEan13(EAN13_TEXT), {
      formats: ['EAN-13'],
      tryHarder: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe(EAN13_TEXT);
  });

  test('every format the app requests exists in the installed engine vocabulary', () => {
    for (const format of APP_FORMATS) {
      expect(BARCODE_FORMATS).toContain(format);
    }
  });

  test('an unknown format name fails SILENTLY: sentinel error result, no throw', async () => {
    // Bypass the compile-time union on purpose: this documents what happens
    // at RUNTIME if a future upgrade renames a format out from under us.
    const bogus = 'EAN13Bogus' as unknown as ReadInputBarcodeFormat;
    const results = await readBarcodes(renderEan13(EAN13_TEXT), {
      formats: [bogus],
      tryHarder: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ text: '', isValid: false });
    expect(results[0].error).toMatch(/not a valid barcode format/i);
  });
});
