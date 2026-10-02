/**
 * Generates the application icons.
 *
 * They are drawn here rather than committed as opaque binaries so that the
 * shape is reviewable: an icon is the one asset nobody can diff. Run
 * `node scripts/make-icons.mjs` after changing anything below.
 *
 * The FireNexa mark combines F/N initials and a signal accent. It uses no DVD
 * or SZS emblem, emergency number or official insignia. The SVG masthead and
 * raster launcher icons depict the same original symbol.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const NAVY = [7, 30, 42];
const AQUA = [107, 214, 210];
const WHITE = [255, 255, 255];
const AMBER = [255, 182, 104];
const F = [[120, 148], [238, 148], [238, 190], [162, 190], [162, 238],
  [224, 238], [224, 280], [162, 280], [162, 364], [120, 364]];
const N = [[254, 148], [294, 148], [350, 276], [350, 148], [392, 148],
  [392, 364], [352, 364], [296, 236], [296, 364], [254, 364]];
const PULSE = [[120, 108], [196, 108], [196, 120], [120, 120]];

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

function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Rounded square, so the icon has a shape of its own on a plain background. */
function inRoundedSquare(u, v, radius) {
  const dx = Math.max(radius - u, 0, u - (1 - radius));
  const dy = Math.max(radius - v, 0, v - (1 - radius));
  if (dx === 0 || dy === 0) return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Block initials stay legible at phone icon sizes. Maskable launchers keep
 * the complete symbol inside the central safe circle.
 */
function signal(u, v, shrink) {
  const x = (0.5 + (u - 0.5) / shrink) * 512;
  const y = (0.5 + (v - 0.5) / shrink) * 512;
  return { aqua: inPolygon(x, y, F), white: inPolygon(x, y, N), amber: inPolygon(x, y, PULSE) };
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
      const amber = coverage(x, y, size, (u, v) => signal(u, v, scale).amber);

      const alpha = transparent ? plate : 1;
      const base = transparent && plate === 0 ? [0, 0, 0] : NAVY;
      const withSignal = base.map((c, i) =>
        ((c * (1 - aqua) + AQUA[i] * aqua) * (1 - white) + WHITE[i] * white) * (1 - amber) + AMBER[i] * amber);

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

// SVG and PNG share the same coordinates; neither asset is edited separately.
const polygon = (points, colour) =>
  `  <polygon points="${points.map((point) => point.join(',')).join(' ')}" fill="${colour}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="FireNexa">\n` +
  `  <rect width="512" height="512" rx="112" fill="#071e2a"/>\n` +
  [polygon(F, '#6bd6d2'), polygon(N, '#ffffff'), polygon(PULSE, '#ffb668')].join('\n') + '\n</svg>\n';
for (const path of ['public/icons/firenexa.svg', 'site/assets/firenexa.svg']) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), svg);
}

for (const [path, size, options] of outputs) {
  const file = resolve(process.cwd(), path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png(size, render(size, options)));
  console.log(`wrote ${path} (${size}x${size})`);
}
