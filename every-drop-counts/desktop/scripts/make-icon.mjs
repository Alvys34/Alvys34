#!/usr/bin/env node
// Procedurally generates the app icon: a glossy red blood drop on a mint/cream tile.
// No external art, no dependencies: a tiny SDF rasteriser + PNG/ICO encoders (node:zlib).
//
// Output (desktop/resources/icons/):
//   icon.ico              Windows (16..256, BMP entries <256, PNG entry at 256)
//   icon.png              512x512 master (Linux window icon, Steam client icon source)
//   <n>x<n>.png           16 24 32 48 64 128 256 512 (Linux hicolor sizes)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'resources', 'icons');

// ---------------------------------------------------------------- math helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// Rounded-rectangle SDF (centered, half-size b, corner radius r).
function sdRoundRect(x, y, b, r) {
  const qx = Math.abs(x) - b + r, qy = Math.abs(y) - b + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

// Teardrop SDF: circle (center 0,cy radius R) unioned with the tangent cone up to apex (0, ay).
// Exact for the union of the disc and the kite formed by apex + both tangent points.
function makeDrop(cy, R, ay) {
  const d = cy - ay;                       // apex-to-center distance
  const sinA = R / d;                      // half-angle of the cone
  const cosA = Math.sqrt(1 - sinA * sinA);
  const tl = d * cosA;                     // apex-to-tangent length
  // tangent points; triangle (apex, T1, T2) U disc == teardrop (the chord T1T2 lies inside the disc)
  const tx = tl * sinA, ty = ay + tl * cosA;
  const tri = [[0, ay], [tx, ty], [-tx, ty]];
  return (x, y) => smin(Math.hypot(x, y - cy) - R, sdTriangle(x, y, tri), 0.22);
}

// Polynomial smooth minimum (blends disc and cone without a crease).
function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k); return mix(b, a, h) - k * h * (1 - h); }

// Signed distance to a triangle (negative inside).
function sdTriangle(x, y, v) {
  let d = Infinity, s = 1;
  for (let i = 0, j = 2; i < 3; j = i, i++) {
    const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
    const wx = x - v[i][0], wy = y - v[i][1];
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey));
    d = Math.min(d, Math.hypot(wx - ex * h, wy - ey * h));
    const c1 = y >= v[i][1], c2 = y < v[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * d;
}

// ---------------------------------------------------------------- renderer
function renderIcon(size) {
  const SS = size <= 32 ? 6 : size <= 64 ? 4 : 3;   // supersampling per axis
  const px = new Float32Array(size * size * 4);
  const mintTop = hex('#fbf3e2');   // cream
  const mintBot = hex('#a8e3cb');   // mint
  const rim = hex('#7cc9aa');
  const redLit = hex('#ff3b3b');
  const redMid = hex('#d10a14');
  const redDark = hex('#5e0006');
  const drop = makeDrop(0.12, 0.43, -0.80);       // in tile units, tile spans -1..1
  const L = norm([-0.55, -0.65, 0.75]);           // light from upper-left, toward viewer
  const H = norm([L[0], L[1], L[2] + 1]);         // Blinn half vector (viewer = +z)
  const eps = 0.004;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const x = ((i + (si + 0.5) / SS) / size) * 2 - 1;
          const y = ((j + (sj + 0.5) / SS) / size) * 2 - 1;
          const c = shade(x, y);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = SS * SS, o = (j * size + i) * 4;
      px[o + 3] = a / n;
      if (a > 0) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; }
    }
  }
  return toRGBA8(px, size);

  function shade(x, y) {
    // 1) tile background
    const tile = sdRoundRect(x, y, 0.94, 0.30);
    if (tile > 0) return [0, 0, 0, 0];
    let col = mix3(mintTop, mintBot, smooth(-1, 1, y));
    col = mix3(col, rim, smooth(-0.05, 0, tile) * 0.85);              // soft rim
    // soft contact shadow under the drop
    const sh = Math.hypot((x - 0.04) / 0.52, (y - 0.70) / 0.14);
    col = mix3(col, hex('#5fae90'), (1 - smooth(0.4, 1.0, sh)) * 0.45);
    // 2) drop
    const d = drop(x, y);
    if (d < 0) {
      // fake height field from the SDF -> normal
      const hgt = (dd) => { const t = clamp(-dd / 0.34); return Math.sqrt(t * (2 - t)); };
      const h0 = hgt(d);
      const hx = hgt(drop(x + eps, y)) - hgt(drop(x - eps, y));
      const hy = hgt(drop(x, y + eps)) - hgt(drop(x, y - eps));
      const N = norm([-hx / (2 * eps) * 0.35, -hy / (2 * eps) * 0.35, 1]);
      const diff = clamp(dot(N, L));
      const spec = Math.pow(clamp(dot(N, H)), 60);
      let c = mix3(redDark, redMid, smooth(0.0, 0.55, diff));
      c = mix3(c, redLit, smooth(0.55, 1.0, diff) * 0.8);
      // rim darkening + bottom bounce light (glossy liquid look)
      c = mix3(c, redDark, (1 - smooth(0.0, 0.35, h0)) * 0.55);
      c = mix3(c, hex('#ff6f6f'), smooth(0.25, 0.75, y) * (1 - smooth(0, 0.25, h0)) * 0.35);
      c = [c[0] + spec * 0.9, c[1] + spec * 0.9, c[2] + spec * 0.9];
      // painted highlight streak (classic icon gloss)
      const hx2 = (x + 0.20) * Math.cos(0.5) - (y - 0.02) * Math.sin(0.5);
      const hy2 = (x + 0.20) * Math.sin(0.5) + (y - 0.02) * Math.cos(0.5);
      const streak = Math.hypot(hx2 / 0.075, hy2 / 0.20);
      c = mix3(c, [1, 1, 1], (1 - smooth(0.75, 1.0, streak)) * 0.85);
      const dotHl = Math.hypot((x + 0.03) / 0.045, (y + 0.36) / 0.045);
      c = mix3(c, [1, 1, 1], (1 - smooth(0.7, 1.0, dotHl)) * 0.8);
      col = c.map((v) => clamp(v));
    } else {
      // thin dark outline just outside the drop for readability at small sizes
      col = mix3(col, redDark, (1 - smooth(0.0, 0.03, d)) * 0.6);
    }
    return [col[0], col[1], col[2], 1];
  }
}

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function toRGBA8(px, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let k = 0; k < px.length; k++) out[k] = Math.round(clamp(px[k]) * 255);
  return out;
}

// ---------------------------------------------------------------- encoders
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePNG(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function encodeBMPIconEntry(rgba, s) {
  const hdr = Buffer.alloc(40);
  hdr.writeUInt32LE(40, 0); hdr.writeInt32LE(s, 4); hdr.writeInt32LE(s * 2, 8);
  hdr.writeUInt16LE(1, 12); hdr.writeUInt16LE(32, 14); hdr.writeUInt32LE(0, 16);
  const xor = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const src = ((s - 1 - y) * s + x) * 4, dst = (y * s + x) * 4;      // bottom-up BGRA
    xor[dst] = rgba[src + 2]; xor[dst + 1] = rgba[src + 1]; xor[dst + 2] = rgba[src]; xor[dst + 3] = rgba[src + 3];
  }
  const andRow = Math.ceil(s / 32) * 4;
  const and = Buffer.alloc(andRow * s);                               // all opaque; alpha channel rules
  hdr.writeUInt32LE(xor.length + and.length, 20);
  return Buffer.concat([hdr, xor, and]);
}
export function encodeICO(images /* [{size, rgba}] */) {
  const entries = images.map(({ size, rgba }) => ({ size, data: size >= 256 ? encodePNG(rgba, size, size) : encodeBMPIconEntry(rgba, size) }));
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach((e, k) => {
    const o = 6 + 16 * k;
    head[o] = e.size >= 256 ? 0 : e.size; head[o + 1] = e.size >= 256 ? 0 : e.size;
    head[o + 2] = 0; head[o + 3] = 0; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(e.data.length, o + 8); head.writeUInt32LE(off, o + 12);
    off += e.data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

// ---------------------------------------------------------------- main
export function generateIcons(outDir = OUT) {
  mkdirSync(outDir, { recursive: true });
  const cache = new Map();
  const img = (s) => { if (!cache.has(s)) cache.set(s, renderIcon(s)); return cache.get(s); };
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) writeFileSync(join(outDir, `${s}x${s}.png`), encodePNG(img(s), s, s));
  writeFileSync(join(outDir, 'icon.png'), encodePNG(img(512), 512, 512));
  writeFileSync(join(outDir, 'icon.ico'), encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, rgba: img(size) }))));
  return outDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const t = Date.now();
  const dir = generateIcons();
  console.log(`[icon] wrote icons to ${dir} in ${Date.now() - t} ms`);
}
