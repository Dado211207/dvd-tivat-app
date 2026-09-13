/**
 * Generates the application icons.
 *
 * They are drawn here rather than committed as opaque binaries so that the
 * shape is reviewable: an icon is the one asset nobody can diff. Run
 * `node scripts/make-icons.mjs` after changing anything below.
 *
 * The mark is an original bell on the project's teal. **No DVD Tivat logo or
 * emblem is used**, and the shape is deliberately not a fire-service cross or
 * anything that could be mistaken for an official insignia - this is a
 * prototype and must not dress itself as the society's own badge.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const TEAL = [7, 118, 135];
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

function inTriangle(u, v, [ax, ay], [bx, by], [cx, cy]) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = sign(u, v, ax, ay, bx, by);
  const d2 = sign(u, v, bx, by, cx, cy);
  const d3 = sign(u, v, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Rounded square, so the icon has a shape of its own on a plain background. */
function inRoundedSquare(u, v, radius) {
  const dx = Math.max(radius - u, 0, u - (1 - radius));
  const dy = Math.max(radius - v, 0, v - (1 - radius));
  if (dx === 0 || dy === 0) return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  return dx * dx + dy * dy <= radius * radius;
}

const inRect = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;

const inQuad = (u, v, a, b, c, d) => inTriangle(u, v, a, b, c) || inTriangle(u, v, a, c, d);

/**
 * The mark is a bell, not a flame.
 *
 * Two earlier attempts at a flame - a circle drawn up to a point - both read as
 * a droplet or a keyhole at icon size, which is what that silhouette actually
 * is. A bell survives 32 pixels, and it is the truer sign for this application:
 * the product is a CALL-OUT, not a fire. What it does is ring.
 *
 * `shrink` pulls the mark towards the centre for the maskable variant, where a
 * launcher may crop up to 20% off every edge.
 */
function bell(u, v, shrink) {
  const x = 0.5 + (u - 0.5) / shrink;
  const y = 0.5 + (v - 0.5) / shrink;
  return (
    // Crown, then the body flaring out to the rim.
    (inCircle(x, y, 0.5, 0.44, 0.2) && y <= 0.44) ||
    inQuad(x, y, [0.3, 0.42], [0.7, 0.42], [0.78, 0.65], [0.22, 0.65]) ||
    inRect(x, y, 0.17, 0.65, 0.83, 0.715) ||
    // The handle it hangs from, and the clapper swinging below.
    inCircle(x, y, 0.5, 0.225, 0.05) ||
    inCircle(x, y, 0.5, 0.79, 0.062)
  );
}

function render(size, { maskable = false, transparent = false } = {}) {
  // Maskable icons keep the mark inside the safe zone; a plain icon may use
  // the full square and gets rounded corners of its own.
  const scale = maskable ? 0.64 : 1;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;

      const plate = maskable
        ? 1
        : coverage(x, y, size, (u, v) => inRoundedSquare(u, v, 0.22));
      const mark = coverage(x, y, size, (u, v) => bell(u, v, scale));

      const alpha = transparent ? plate : 1;
      const base = transparent && plate === 0 ? [0, 0, 0] : TEAL;

      // A plain white silhouette. An attempt at shading inside the body only
      // added noise at the sizes this is actually seen at.
      const withBell = base.map((c, i) => c * (1 - mark) + WHITE[i] * mark);

      pixels[offset] = Math.round(withBell[0]);
      pixels[offset + 1] = Math.round(withBell[1]);
      pixels[offset + 2] = Math.round(withBell[2]);
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
