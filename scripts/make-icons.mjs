/**
 * Generates the application icons.
 *
 * They are drawn here rather than committed as opaque binaries so that the
 * shape is reviewable: an icon is the one asset nobody can diff. Run
 * `node scripts/make-icons.mjs` after changing anything below.
 *
 * The Boka Signal mark joins a radio pulse and two sea waves. It uses no DVD
 * or SZS emblem, emergency number or official insignia. The SVG masthead and
 * raster launcher icons depict the same original symbol.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const NAVY = [7, 30, 42];
const AQUA = [107, 214, 210];
const WHITE = [255, 255, 255];

/** Coverage of one shape at a point, sampled 4x4 for a smooth edge. */
function coverage(x, y, size, inside) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      const u = (x + (sx + 0.5) / 4) / size;
      const v = (y + (sy + 0.5) / 4) / size;
      if (inside(u, v)) hits += 1;
    }
  }
  return hits / 16;
}

const inCircle = (u, v, cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;

/** Rounded square, so the icon has a shape of its own on a plain background. */
function inRoundedSquare(u, v, radius) {
  const dx = Math.max(radius - u, 0, u - (1 - radius));
  const dy = Math.max(radius - v, 0, v - (1 - radius));
  if (dx === 0 || dy === 0) return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * A signal above the waves stays legible at phone icon sizes. Maskable launchers
 * pull all strokes into the safe zone, so neither the pulse nor the waves crop.
 */
function signal(u, v, shrink) {
  const x = 0.5 + (u - 0.5) / shrink;
  const y = 0.5 + (v - 0.5) / shrink;
  const radius = Math.hypot(x - 0.5, y - 0.43);
  const arc = y <= 0.43 &&
    (Math.abs(radius - 0.12) <= 0.019 || Math.abs(radius - 0.23) <= 0.019);
  const waves = x >= 0.21 && x <= 0.79 && [0.65, 0.76].some((level) =>
    Math.abs(y - (level + 0.035 * Math.sin(2 * Math.PI * (x - 0.21) / 0.58))) <= 0.022);
  return { aqua: arc || waves, white: inCircle(x, y, 0.5, 0.438, 0.05) };
}

function render(size, { maskable = false, transparent = false } = {}) {
  // Maskable icons keep the mark inside the safe zone; a plain icon may use
  // the full square and gets rounded corners of its own.
  const scale = maskable ? 0.7 : 1;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;

      const plate = maskable
        ? 1
        : coverage(x, y, size, (u, v) => inRoundedSquare(u, v, 0.22));
      const aqua = coverage(x, y, size, (u, v) => signal(u, v, scale).aqua);
      const white = coverage(x, y, size, (u, v) => signal(u, v, scale).white);

      const alpha = transparent ? plate : 1;
      const base = transparent && plate === 0 ? [0, 0, 0] : NAVY;
      const withSignal = base.map((c, i) =>
        (c * (1 - aqua) + AQUA[i] * aqua) * (1 - white) + WHITE[i] * white);

      pixels[offset] = Math.round(withSignal[0]);
      pixels[offset + 1] = Math.round(withSignal[1]);
      pixels[offset + 2] = Math.round(withSignal[2]);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

// --- PNG container ---------------------------------------------------------

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  // Each scanline is prefixed with its filter type; 0 means none.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputs = [
  ['public/icons/icon-192.png', 192, {}],
  ['public/icons/icon-512.png', 512, {}],
  ['public/icons/icon-maskable-512.png', 512, { maskable: true }],
  ['public/icons/apple-touch-icon.png', 180, {}],
  ['public/icons/favicon-32.png', 32, { transparent: true }],
];

for (const [path, size, options] of outputs) {
  const file = resolve(process.cwd(), path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(size, render(size, options)));
  console.log(`wrote ${path} (${size}x${size})`);
}
