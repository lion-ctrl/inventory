// Generates the PWA PNG icons (solid brand-green square + white barcode mark with a
// soft scan line — same motif as logo-mark.svg). Pure node, no dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

function png(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  draw((x, y, r, g, b, a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }, size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const GREEN = [0x1f, 0x8a, 0x5b];
const SOFT = [0xdd, 0xef, 0xe3];
const WHITE = [255, 255, 255];
const BARS = [[12, 3], [18, 2], [23, 4], [30, 2], [35, 2]];

function drawIcon(set, size) {
  const u = size / 48;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = GREEN;
      const gx = x / u, gy = y / u;
      if (gy >= 14 && gy < 34) {
        for (const [bx, bw] of BARS) if (gx >= bx && gx < bx + bw) { c = WHITE; break; }
      }
      if (gy >= 23 && gy < 25 && gx >= 8 && gx < 40) c = SOFT;
      set(x, y, c[0], c[1], c[2]);
    }
  }
}

mkdirSync(join(root, 'public'), { recursive: true });
for (const s of [192, 512]) writeFileSync(join(root, 'public', `pwa-${s}.png`), png(s, drawIcon));
console.log('PWA icons written: public/pwa-192.png, public/pwa-512.png');
