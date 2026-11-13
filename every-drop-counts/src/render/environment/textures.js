/**
 * Procedural canvas textures (ART owns). No image files: every tile, sign, stencil and decal is
 * drawn here once at load. Palette: ./palette.js (no reds — blood is the only red in the game).
 */
import { CSS, makeRng } from './palette.js';

/** Bundled UI font (@fontsource-variable/nunito, imported by src/ui) first; system fallbacks only until it loads. */
export const FONT_FAMILY = 'Nunito Variable';
export const FONT = `"${FONT_FAMILY}", "Nunito", "Trebuchet MS", "Segoe UI", "DejaVu Sans", Verdana, Arial, sans-serif`;

/**
 * Call `cb` once the bundled font face is loaded (canvases are drawn immediately with the fallback,
 * then redrawn by the callback so signage looks identical on every OS). No-op without FontFaceSet.
 */
export function onFontsReady(cb) {
  try {
    const fs = typeof document !== 'undefined' && document.fonts;
    if (!fs || !fs.load) return;
    const fam = `"${FONT_FAMILY}"`;
    Promise.all([fs.load(`700 48px ${fam}`), fs.load(`800 48px ${fam}`), fs.load(`900 48px ${fam}`)])
      .then((res) => { if (res.some((r) => r && r.length)) cb(); })
      .catch(() => { /* keep the fallback drawing */ });
  } catch { /* keep the fallback drawing */ }
}
export const FONT_COND = '"Arial Narrow", "Roboto Condensed", "DejaVu Sans Condensed", "Trebuchet MS", Arial, sans-serif';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTexture(THREE, c, { repeat = false, srgb = true, aniso = 4, mips = true } = {}) {
  const tex = new THREE.CanvasTexture(c);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  if (!mips) { tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; }
  return tex;
}

// ---------------------------------------------------------------------------------------------
// colour helpers
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Glazed tiles with per-tile tone jitter, bevel light/shadow and a soft glaze highlight. */
function drawTiles(g, x0, y0, w, h, tw, th, base, grout, rng, { jitter = 0.035, accent = null, accentEvery = 0, bevel = 1 } = {}) {
  g.fillStyle = grout; g.fillRect(x0, y0, w, h);
  const nx = Math.ceil(w / tw); const ny = Math.ceil(h / th);
  const gp = Math.max(1, Math.round(tw * 0.045));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * tw; const y = y0 + j * th;
      const useAccent = accent && accentEvery && ((i * 7 + j * 13) % accentEvery === 0);
      const k = (rng() - 0.5) * 2 * jitter;
      g.fillStyle = shade(useAccent ? accent : base, k);
      const ww = Math.min(tw, x0 + w - x) - gp * 2; const hh = Math.min(th, y0 + h - y) - gp * 2;
      if (ww <= 0 || hh <= 0) continue;
      g.fillRect(x + gp, y + gp, ww, hh);
      if (bevel) {
        const b = Math.max(1, Math.round(tw * 0.05));
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x + gp, y + gp, ww, b); g.fillRect(x + gp, y + gp, b, hh);
        g.fillStyle = 'rgba(40,60,55,0.12)';
        g.fillRect(x + gp, y + gp + hh - b, ww, b); g.fillRect(x + gp + ww - b, y + gp, b, hh);
        const gr = g.createLinearGradient(x, y, x + ww, y + hh);
        gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x + gp, y + gp, ww, hh);
      }
    }
  }
}

/** Soft grime blotches + speckle (olive/grey only — never red/brown-red). */
function grime(g, x0, y0, w, h, rng, { blots = 30, alpha = 0.06, speck = 400, color = '#5d6650' } = {}) {
  for (let i = 0; i < blots; i++) {
    const x = x0 + rng() * w; const y = y0 + rng() * h; const r = (0.02 + rng() * 0.08) * Math.max(w, h);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(color, alpha * (0.4 + rng()))); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rng()), rng() * 3, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < speck; i++) {
    g.fillStyle = rgba(color, 0.05 + rng() * 0.12);
    g.fillRect(x0 + rng() * w, y0 + rng() * h, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
}

/** Darken toward the given edges (ambient-occlusion feel baked into the canvas). */
function edgeAO(g, x0, y0, w, h, size, { top = 0, bottom = 0, left = 0, right = 0 } = {}, color = '#1f3a33') {
  const band = (x, y, ww, hh, gx0, gy0, gx1, gy1, a) => {
    if (!a) return;
    const gr = g.createLinearGradient(gx0, gy0, gx1, gy1);
    gr.addColorStop(0, rgba(color, a)); gr.addColorStop(0.35, rgba(color, a * 0.45)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(x, y, ww, hh);
  };
  band(x0, y0, w, size, 0, y0, 0, y0 + size, top);
  band(x0, y0 + h - size, w, size, 0, y0 + h, 0, y0 + h - size, bottom);
  band(x0, y0, size, h, x0, 0, x0 + size, 0, left);
  band(x0 + w - size, y0, size, h, x0 + w, 0, x0 + w - size, 0, right);
}

/** Painted stencil text (slightly worn: random erase speckles). */
function stencil(g, text, x, y, size, color, rng, { align = 'center', alpha = 0.85, font = FONT, weight = 800, maxW = 0, wear = 0.25 } = {}) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = align; g.textBaseline = 'middle';
  if (maxW) g.fillText(text, x, y, maxW); else g.fillText(text, x, y);
  const mw = g.measureText(text).width;
  g.restore();
  if (wear > 0) {
    const tw = maxW ? Math.min(maxW, mw) : mw;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const n = Math.round(tw * size * 0.004 * wear * 10);
    const left = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(0,0,0,${0.3 + rng() * 0.5})`;
      g.fillRect(left + rng() * tw, y - size / 2 + rng() * size, 1 + rng() * 3, 1 + rng() * 2);
    }
    g.restore();
  }
}

function arrow(g, cx, cy, s, color, alpha = 0.85) {
  g.save(); g.globalAlpha = alpha; g.fillStyle = color;
  g.beginPath();
  g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.75, cy - s * 0.15); g.lineTo(cx + s * 0.28, cy - s * 0.15);
  g.lineTo(cx + s * 0.28, cy + s); g.lineTo(cx - s * 0.28, cy + s); g.lineTo(cx - s * 0.28, cy - s * 0.15);
  g.lineTo(cx - s * 0.75, cy - s * 0.15); g.closePath(); g.fill();
  g.restore();
}

/** Friendly drop mascot / logo (MINT — the brand drop is never red). */
export function dropLogo(g, cx, cy, s, fill = CSS.mint3, face = true) {
  g.save();
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(cx, cy - s);
  g.bezierCurveTo(cx + s * 0.25, cy - s * 0.55, cx + s * 0.72, cy - s * 0.1, cx + s * 0.72, cy + s * 0.3);
  g.arc(cx, cy + s * 0.3, s * 0.72, 0, Math.PI, false);
  g.bezierCurveTo(cx - s * 0.72, cy - s * 0.1, cx - s * 0.25, cy - s * 0.55, cx, cy - s);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.ellipse(cx - s * 0.32, cy + s * 0.05, s * 0.1, s * 0.22, 0.4, 0, Math.PI * 2); g.fill();
  if (face) {
    g.fillStyle = CSS.ink; g.strokeStyle = CSS.ink; g.lineWidth = Math.max(2, s * 0.07); g.lineCap = 'round';
    for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * s * 0.22, cy + s * 0.22, s * 0.06, s * 0.09, 0, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.arc(cx, cy + s * 0.38, s * 0.2, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Baseline-compatible helpers (kept: other pieces may import them)
export function tileTexture(THREE, { base = '#eeeeee', grout = '#cccccc', tiles = 8, accent = '#ffffff', size = 256 } = {}) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  drawTiles(g, 0, 0, size, size, size / tiles, size / tiles, base, grout, makeRng(7), { accent, accentEvery: 11 });
  return toTexture(THREE, c, { repeat: true });
}

export function stripeTexture(THREE, { a = CSS.hazard, b = CSS.black, stripes = 4, size = 128, wear = true } = {}) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, size, size);
  g.fillStyle = b;
  const w = size / stripes;
  for (let i = -stripes; i < stripes * 2; i += 2) {
    g.beginPath();
    g.moveTo(i * w, 0); g.lineTo(i * w + w, 0); g.lineTo(i * w + w + size, size); g.lineTo(i * w + size, size);
    g.closePath(); g.fill();
  }
  if (wear) {
    const rng = makeRng(31);
    grime(g, 0, 0, size, size, rng, { blots: 6, alpha: 0.1, speck: 120, color: '#3a3a30' });
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, size, size * 0.12);
  }
  return toTexture(THREE, c, { repeat: true });
}

export function signTexture(THREE, text, fg = CSS.mint4, bg = '#ffffff') {
  const c = makeCanvas(1024, 128);
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.font = `bold 64px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 4, c.width - 40);
  return toTexture(THREE, c);
}

// ---------------------------------------------------------------------------------------------
// Drum interior
/**
 * Back wall of the drum chamber (16 x 10 m), unique canvas so AO/grime/stencils are baked.
 * Upper part cream enamel tiles, lower 40 % mint "wainscot" band => "down" reads even upside-down.
 */
export function drumBackCanvas(scale = 1) {
  const PPM = Math.round(128 * scale); // pixels per metre
  const W = 16 * PPM; const H = 10 * PPM;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const rng = makeRng(1234);
  const tile = PPM * 0.5;
  const bandY = Math.round(H * 0.6); // y = -1 m (drum-local)
  drawTiles(g, 0, 0, W, bandY, tile, tile, CSS.cream0, '#d8d0bb', rng, { accent: '#eef6f1', accentEvery: 17 });
  drawTiles(g, 0, bandY + tile * 0.5, W, H - bandY, tile, tile, '#bfe2d1', '#93c2ae', rng, { accent: '#cdeadc', accentEvery: 9 });
  drawTiles(g, 0, bandY, W, tile * 0.5, tile, tile * 0.5, CSS.mint4, '#2f6556', rng, { jitter: 0.02 });
  // stencils
  stencil(g, 'THIS SIDE UP', W / 2, PPM * 0.62, PPM * 0.42, CSS.mint4, rng, { alpha: 0.78 });
  arrow(g, W / 2 - PPM * 2.15, PPM * 0.62, PPM * 0.3, CSS.mint4, 0.78);
  arrow(g, W / 2 + PPM * 2.15, PPM * 0.62, PPM * 0.3, CSS.mint4, 0.78);
  stencil(g, 'CHAMBER A', PPM * 0.55, PPM * 1.45, PPM * 0.26, CSS.steelDark, rng, { align: 'left', alpha: 0.7 });
  stencil(g, 'MAX LOAD: 25 DONORS', PPM * 0.55, bandY + PPM * 0.75, PPM * 0.2, CSS.mint4, rng, { align: 'left', alpha: 0.7 });
  stencil(g, 'PLEASE KEEP ARMS AND LEGS', W - PPM * 0.55, bandY + PPM * 0.68, PPM * 0.17, CSS.mint4, rng, { align: 'right', alpha: 0.7 });
  stencil(g, 'INSIDE THE DRUM AT ALL TIMES', W - PPM * 0.55, bandY + PPM * 0.94, PPM * 0.17, CSS.mint4, rng, { align: 'right', alpha: 0.7 });
  dropLogo(g, W - PPM * 1.3, PPM * 1.15, PPM * 0.5, CSS.mint3, true);
  stencil(g, 'DRAINWELL', W - PPM * 1.3, PPM * 1.95, PPM * 0.2, CSS.mint4, rng, { alpha: 0.7 });
  // corner IDs (asymmetric: helps reading the rotation)
  stencil(g, '1', PPM * 0.35, PPM * 9.55, PPM * 0.3, CSS.ink, rng, { alpha: 0.45 });
  stencil(g, '2', W - PPM * 0.35, PPM * 9.55, PPM * 0.3, CSS.ink, rng, { alpha: 0.45 });
  // grime: heavier low, drips from the top tile rows
  grime(g, 0, 0, W, H, rng, { blots: 60, alpha: 0.05, speck: 3000 });
  grime(g, 0, H * 0.55, W, H * 0.45, rng, { blots: 40, alpha: 0.07, speck: 1200, color: '#4f6a5c' });
  for (let i = 0; i < 26; i++) {
    const x = rng() * W; const y0 = rng() * H * 0.4; const len = PPM * (0.4 + rng() * 1.6);
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, 'rgba(90,100,80,0.12)'); gr.addColorStop(1, 'rgba(90,100,80,0)');
    g.fillStyle = gr; g.fillRect(x, y0, 1.5 + rng() * 2.5, len);
  }
  edgeAO(g, 0, 0, W, H, PPM * 0.9, { top: 0.42, bottom: 0.42, left: 0.42, right: 0.42 });
  return c;
}

/**
 * Inner walls atlas (floor, ceiling, left, right — each wall x depth). Canvas top of each region
 * = the back edge (z = -HD, strongest AO), bottom = the glass edge.
 * Returns { canvas, regions: { floor:[x,y,w,h], ceiling, left, right } } in canvas pixels.
 */
export function drumSidesCanvas(scale = 1) {
  const W = Math.round(1024 * scale); const S = W / 16; // px per metre
  const hD = Math.round(5 * S);
  const H = Math.round(hD * 3);
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const rng = makeRng(99);
  const tile = S * 0.5;
  const regions = { floor: [0, 0, W, hD], ceiling: [0, hD, W, hD], left: [0, hD * 2, W / 2, hD], right: [W / 2, hD * 2, W / 2, hD] };
  // floor: mint band continues; ceiling: cream
  drawTiles(g, 0, 0, W, hD, tile, tile, '#bfe2d1', '#93c2ae', rng, { accent: '#cdeadc', accentEvery: 9 });
  drawTiles(g, 0, hD, W, hD, tile, tile, CSS.cream0, '#d8d0bb', rng, { accent: '#eef6f1', accentEvery: 17 });
  // side walls (10 m along x of their region, from drum-local y=-5 at x=0 to y=+5): lower 40 % mint
  for (const [rx, flip] of [[0, false], [W / 2, true]]) {
    const w = W / 2; const sp = w / 10;
    const band = sp * 4;
    // left region: canvas x grows with drum y (y=-5 at left); right region mirrored for continuity
    const mx = flip ? rx + w - band : rx;
    drawTiles(g, rx, hD * 2, w, hD, sp * 0.5, tile, CSS.cream0, '#d8d0bb', rng, { accent: '#eef6f1', accentEvery: 17 });
    drawTiles(g, mx, hD * 2, band, hD, sp * 0.5, tile, '#bfe2d1', '#93c2ae', rng, { accent: '#cdeadc', accentEvery: 9 });
    g.fillStyle = CSS.mint4; g.fillRect(flip ? mx - sp * 0.25 : mx + band, hD * 2, sp * 0.25, hD);
  }
  // floor drain stencil + grime
  stencil(g, 'DRAIN', W * 0.5, hD * 0.62, S * 0.3, CSS.mint4, rng, { alpha: 0.5 });
  grime(g, 0, 0, W, H, rng, { blots: 50, alpha: 0.06, speck: 2500 });
  for (const [x, y, w, h] of Object.values(regions)) edgeAO(g, x, y, w, h, S * 1.1, { top: 0.5, bottom: 0.12, left: 0.25, right: 0.25 });
  return { canvas: c, regions, W, H };
}

// ---------------------------------------------------------------------------------------------
// Facility
/** Facility back wall strip: 4 m wide (repeats in x) x 26 m tall, 64 px/m. Bottom = floor. */
export function facilityWallCanvas() {
  const PPM = 64; const W = 4 * PPM; const H = 26 * PPM;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const rng = makeRng(5);
  const y = (m) => H - m * PPM; // metres above floor -> canvas y
  const t = PPM * 0.3125;
  drawTiles(g, 0, 0, W, y(6.4), t, t, '#b7d8ca', '#9cc4b3', rng, { accent: '#c3e0d3', accentEvery: 13, jitter: 0.03 });
  g.fillStyle = CSS.mint4; g.fillRect(0, y(6.4), W, PPM * 0.4);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, y(6.4), W, 3);
  drawTiles(g, 0, y(6.0), W, PPM * 5.7, t, t, '#e4dac3', '#c6b999', rng, { accent: '#d8e3d8', accentEvery: 11, jitter: 0.03 });
  g.fillStyle = '#5c8f80'; g.fillRect(0, y(0.3), W, PPM * 0.3);
  g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(0, y(0.3), W, 2);
  grime(g, 0, 0, W, H, rng, { blots: 30, alpha: 0.035, speck: 600 });
  // ceiling darkening + floor contact AO
  const gr = g.createLinearGradient(0, 0, 0, PPM * 6);
  gr.addColorStop(0, 'rgba(30,60,52,0.38)'); gr.addColorStop(1, 'rgba(30,60,52,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, PPM * 6);
  const gf = g.createLinearGradient(0, H, 0, H - PPM * 1.2);
  gf.addColorStop(0, 'rgba(30,50,45,0.35)'); gf.addColorStop(1, 'rgba(30,50,45,0)');
  g.fillStyle = gf; g.fillRect(0, H - PPM * 1.2, W, PPM * 1.2);
  return c;
}

/** Facility floor: large pale vinyl tiles with speckle (repeats). 2 x 2 m per canvas. */
export function floorCanvas() {
  const S = 256; const c = makeCanvas(S, S); const g = c.getContext('2d');
  const rng = makeRng(11);
  drawTiles(g, 0, 0, S, S, S / 4, S / 4, '#d9cfb6', '#b9ab8a', rng, { jitter: 0.025, accent: '#cbd8cb', accentEvery: 5 });
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(120,130,110,0.10)' : 'rgba(255,255,255,0.18)';
    g.fillRect(rng() * S, rng() * S, 1.2, 1.2);
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// Signage atlas: one canvas, many signs (one material + merged planes = 1 draw call)
export function signAtlas() {
  const W = 2048; const H = 2048;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const rng = makeRng(77);
  const rects = {};
  let cx = 0; let cy = 0; let rowH = 0;
  const place = (name, w, h, draw) => {
    if (cx + w > W) { cx = 0; cy += rowH + 4; rowH = 0; }
    const x = cx; const y = cy;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y);
    draw(g, w, h);
    g.restore();
    rects[name] = { uv: [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H], aspect: w / h };
    cx += w + 4; rowH = Math.max(rowH, h);
  };
  const panel = (gg, w, h, bg, border, r = 24) => {
    gg.fillStyle = border; roundRect(gg, 0, 0, w, h, r); gg.fill();
    gg.fillStyle = bg; roundRect(gg, 8, 8, w - 16, h - 16, r - 6); gg.fill();
    const gr = gg.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.06)');
    gg.fillStyle = gr; roundRect(gg, 8, 8, w - 16, h - 16, r - 6); gg.fill();
  };
  const text = (gg, s, x, y, size, color, weight = 800, align = 'center', maxW = 0, font = FONT) => {
    gg.fillStyle = color; gg.font = `${weight} ${size}px ${font}`; gg.textAlign = align; gg.textBaseline = 'middle';
    if (maxW) gg.fillText(s, x, y, maxW); else gg.fillText(s, x, y);
  };

  place('main', 1640, 330, (gg, w, h) => {
    panel(gg, w, h, CSS.cream0, CSS.mint4, 40);
    dropLogo(gg, 170, 170, 115, CSS.mint3, true);
    text(gg, 'DRAINWELL', 330, 128, 150, CSS.mint4, 900, 'left', 1100);
    text(gg, '™', 1320, 70, 50, CSS.mint4, 700, 'left');
    text(gg, 'Community Donation Center', 335, 248, 74, CSS.mint3, 700, 'left', 1240);
  });
  place('slogan', 1000, 200, (gg, w, h) => {
    panel(gg, w, h, CSS.mint3, CSS.mint4, 100);
    text(gg, 'Every Drop Counts.', w / 2, h / 2 + 4, 108, '#ffffff', 800, 'center', w - 90);
  });
  place('complaints', 380, 330, (gg, w, h) => {
    panel(gg, w, h, '#ffffff', CSS.steelDark, 20);
    text(gg, 'DAYS SINCE', w / 2, 52, 40, CSS.ink, 800, 'center', w - 50);
    text(gg, 'LAST COMPLAINT', w / 2, 96, 40, CSS.ink, 800, 'center', w - 50);
    gg.fillStyle = CSS.iron; roundRect(gg, 70, 130, w - 140, 150, 14); gg.fill();
    text(gg, '—', w / 2, 210, 140, CSS.butter, 900);
    text(gg, 'Management thanks you', w / 2, 305, 22, CSS.steelDark, 600);
  });
  place('sideUp', 640, 150, (gg, w, h) => {
    gg.fillStyle = CSS.hazard; roundRect(gg, 0, 0, w, h, 18); gg.fill();
    gg.strokeStyle = CSS.black; gg.lineWidth = 8; roundRect(gg, 10, 10, w - 20, h - 20, 12); gg.stroke();
    arrow(gg, 80, h / 2, 48, CSS.black, 1); arrow(gg, w - 80, h / 2, 48, CSS.black, 1);
    text(gg, 'THIS SIDE UP', w / 2, h / 2 + 3, 72, CSS.black, 900, 'center', w - 220);
  });
  place('serial', 520, 220, (gg, w, h) => {
    gg.fillStyle = '#dfe5e6'; roundRect(gg, 0, 0, w, h, 14); gg.fill();
    gg.strokeStyle = CSS.steelDark; gg.lineWidth = 5; roundRect(gg, 8, 8, w - 16, h - 16, 10); gg.stroke();
    for (const [x, y] of [[26, 26], [w - 26, 26], [26, h - 26], [w - 26, h - 26]]) { gg.fillStyle = CSS.steelDark; gg.beginPath(); gg.arc(x, y, 8, 0, 7); gg.fill(); }
    text(gg, 'DRAINWELL  DD-16', w / 2, 52, 44, CSS.ink, 900, 'center', w - 80);
    text(gg, 'ROTARY DONATION DRUM', w / 2, 100, 30, CSS.ink, 700, 'center', w - 80);
    text(gg, 'MAX LOAD 25 DONORS · 2.2 RAD/S', w / 2, 140, 24, CSS.steelDark, 700, 'center', w - 80);
    text(gg, 'DO NOT OPEN WHILE OCCUPIED', w / 2, 178, 24, CSS.steelDark, 700, 'center', w - 80);
  });
  place('intake', 420, 140, (gg, w, h) => {
    panel(gg, w, h, CSS.cream0, CSS.mint4, 20);
    text(gg, 'INTAKE', w / 2 - 30, h / 2 + 3, 76, CSS.mint4, 900);
    arrow(gg, w - 60, h / 2, 40, CSS.mint4, 1);
  });
  place('collected', 420, 160, (gg, w, h) => {
    panel(gg, w, h, '#ffffff', CSS.steelDark, 16);
    text(gg, 'COLLECTED', w / 2, 62, 66, CSS.ink, 900, 'center', w - 50);
    text(gg, 'product · keep sealed', w / 2, 118, 30, CSS.steelDark, 700);
  });
  place('poster', 360, 500, (gg, w, h) => {
    panel(gg, w, h, CSS.mint1, '#ffffff', 16);
    // sunburst
    gg.save(); gg.translate(w / 2, 210); gg.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 16; i++) { gg.rotate(Math.PI / 8); gg.beginPath(); gg.moveTo(0, 0); gg.lineTo(-30, -260); gg.lineTo(30, -260); gg.fill(); }
    gg.restore();
    dropLogo(gg, w / 2, 220, 120, CSS.mint3, true);
    text(gg, 'YOUR', w / 2, 380, 40, CSS.mint4, 900);
    text(gg, 'DONATION', w / 2, 422, 46, CSS.mint4, 900);
    text(gg, 'MATTERS', w / 2, 466, 40, CSS.mint4, 900);
  });
  place('wetFloor', 220, 330, (gg, w, h) => {
    gg.fillStyle = CSS.hazard; roundRect(gg, 0, 0, w, h, 20); gg.fill();
    gg.fillStyle = CSS.black; gg.beginPath(); gg.moveTo(w / 2, 40); gg.lineTo(w - 40, 170); gg.lineTo(40, 170); gg.closePath(); gg.fill();
    gg.fillStyle = CSS.hazard; gg.beginPath(); gg.moveTo(w / 2, 66); gg.lineTo(w - 62, 158); gg.lineTo(62, 158); gg.closePath(); gg.fill();
    text(gg, '!', w / 2, 122, 64, CSS.black, 900);
    text(gg, 'CAUTION', w / 2, 220, 40, CSS.black, 900, 'center', w - 20);
    text(gg, 'WET FLOOR', w / 2, 266, 34, CSS.black, 900, 'center', w - 20);
  });
  place('clock', 256, 256, (gg, w) => {
    gg.fillStyle = CSS.steelDark; gg.beginPath(); gg.arc(w / 2, w / 2, 126, 0, 7); gg.fill();
    gg.fillStyle = '#fbfbf7'; gg.beginPath(); gg.arc(w / 2, w / 2, 112, 0, 7); gg.fill();
    gg.fillStyle = CSS.ink;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      gg.save(); gg.translate(w / 2, w / 2); gg.rotate(a); gg.fillRect(-3, -102, 6, i % 3 ? 12 : 22); gg.restore();
    }
    gg.save(); gg.translate(w / 2, w / 2); gg.lineCap = 'round'; gg.strokeStyle = CSS.ink;
    gg.lineWidth = 9; gg.rotate(-0.55); gg.beginPath(); gg.moveTo(0, 0); gg.lineTo(0, -60); gg.stroke();
    gg.rotate(2.6); gg.lineWidth = 6; gg.beginPath(); gg.moveTo(0, 0); gg.lineTo(0, -88); gg.stroke();
    gg.restore();
    text(gg, 'DRAINWELL', w / 2, 170, 18, CSS.mint4, 800);
  });
  place('calm', 520, 120, (gg, w, h) => {
    panel(gg, w, h, '#ffffff', CSS.mint3, 18);
    text(gg, 'Please remain calm and seated.', w / 2, h / 2 + 2, 36, CSS.mint4, 800, 'center', w - 50);
  });
  place('moving', 260, 260, (gg, w) => {
    gg.fillStyle = CSS.black; gg.beginPath(); gg.moveTo(w / 2, 10); gg.lineTo(w - 6, w - 30); gg.lineTo(6, w - 30); gg.closePath(); gg.fill();
    gg.fillStyle = CSS.hazard; gg.beginPath(); gg.moveTo(w / 2, 34); gg.lineTo(w - 30, w - 44); gg.lineTo(30, w - 44); gg.closePath(); gg.fill();
    // gear glyph
    gg.save(); gg.translate(w / 2, 150); gg.fillStyle = CSS.black;
    for (let i = 0; i < 8; i++) { gg.rotate(Math.PI / 4); gg.fillRect(-9, -46, 18, 20); }
    gg.beginPath(); gg.arc(0, 0, 32, 0, 7); gg.fill(); gg.fillStyle = CSS.hazard; gg.beginPath(); gg.arc(0, 0, 13, 0, 7); gg.fill();
    gg.restore();
  });
  place('o2', 300, 140, (gg, w, h) => {
    gg.fillStyle = '#ffffff'; roundRect(gg, 0, 0, w, h, 14); gg.fill();
    gg.fillStyle = CSS.hazard; gg.fillRect(0, h - 34, w, 34);
    text(gg, 'O₂', 70, 60, 70, CSS.ink, 900);
    text(gg, 'OXYGEN', 190, 44, 34, CSS.ink, 900);
    text(gg, 'do not puncture', 190, 82, 22, CSS.steelDark, 700);
    text(gg, 'FLAMMABLE · PRESSURISED', w / 2, h - 17, 20, CSS.black, 900, 'center', w - 20);
  });
  place('cookies', 260, 120, (gg, w, h) => {
    panel(gg, w, h, '#ffffff', CSS.butter, 14);
    text(gg, 'Complimentary', w / 2, 44, 30, CSS.ink, 700);
    text(gg, 'cookie (1)', w / 2, 82, 34, CSS.mint4, 900);
  });
  place('gauge', 160, 160, (gg, w) => {
    gg.fillStyle = CSS.steelDark; gg.beginPath(); gg.arc(w / 2, w / 2, 78, 0, 7); gg.fill();
    gg.fillStyle = '#fbfbf7'; gg.beginPath(); gg.arc(w / 2, w / 2, 66, 0, 7); gg.fill();
    gg.strokeStyle = CSS.mint3; gg.lineWidth = 10; gg.beginPath(); gg.arc(w / 2, w / 2, 52, Math.PI * 0.8, Math.PI * 1.6); gg.stroke();
    gg.strokeStyle = CSS.hazard; gg.beginPath(); gg.arc(w / 2, w / 2, 52, Math.PI * 1.6, Math.PI * 2.2); gg.stroke();
    gg.save(); gg.translate(w / 2, w / 2); gg.rotate(0.9); gg.fillStyle = CSS.ink; gg.fillRect(-3, -54, 6, 58); gg.restore();
  });
  place('crusher', 300, 120, (gg, w, h) => {
    gg.fillStyle = CSS.black; roundRect(gg, 0, 0, w, h, 12); gg.fill();
    text(gg, 'STAND CLEAR', w / 2, 46, 44, CSS.hazard, 900, 'center', w - 30);
    text(gg, 'during compression', w / 2, 88, 26, '#ffffff', 700, 'center', w - 30);
  });
  place('grinder', 300, 120, (gg, w, h) => {
    gg.fillStyle = CSS.black; roundRect(gg, 0, 0, w, h, 12); gg.fill();
    text(gg, 'HIGH YIELD', w / 2, 46, 44, CSS.hazard, 900, 'center', w - 30);
    text(gg, 'processing unit', w / 2, 88, 26, '#ffffff', 700, 'center', w - 30);
  });
  place('staffOnly', 360, 110, (gg, w, h) => {
    panel(gg, w, h, CSS.cream0, CSS.mint4, 14);
    text(gg, 'OBSERVATION · STAFF ONLY', w / 2, h / 2 + 2, 28, CSS.mint4, 800, 'center', w - 40);
  });
  place('pump', 260, 100, (gg, w, h) => {
    panel(gg, w, h, '#ffffff', CSS.steelDark, 12);
    text(gg, 'DRIVE UNIT 2', w / 2, h / 2 + 2, 34, CSS.ink, 900, 'center', w - 30);
  });
  place('inspector', 200, 80, (gg, w, h) => {
    gg.fillStyle = '#ffffff'; roundRect(gg, 0, 0, w, h, 10); gg.fill();
    text(gg, 'INSPECTOR', w / 2, h / 2 + 2, 30, CSS.ink, 900, 'center', w - 20);
  });
  place('safety', 360, 120, (gg, w, h) => {
    gg.fillStyle = CSS.hazard; roundRect(gg, 0, 0, w, h, 60); gg.fill();
    text(gg, 'PERSONAL SAFETY SPHERE', w / 2, h / 2 + 2, 26, CSS.black, 900, 'center', w - 50);
  });
  return { canvas: c, rects };
}

/** Additive glass sheen: soft diagonal streaks + an edge highlight frame. */
export function glassCanvas() {
  const W = 512; const H = 320; const c = makeCanvas(W, H); const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const streak = (x, w, a) => {
    g.save(); g.translate(x, 0); g.transform(1, 0, -0.55, 1, 0, 0);
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, H);
    g.restore();
  };
  streak(150, 70, 0.22); streak(235, 22, 0.16); streak(430, 110, 0.10); streak(520, 30, 0.14);
  // top-left corner glow
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 260);
  gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // edge highlight
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3; g.strokeRect(4, 4, W - 8, H - 8);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 8; g.strokeRect(10, 10, W - 20, H - 20);
  return c;
}

/** Motion-blurred saw disc (alpha ring with concentric streaks) for fast spin. */
export function sawBlurCanvas() {
  const S = 256; const c = makeCanvas(S, S); const g = c.getContext('2d');
  const r = S / 2;
  const rng = makeRng(3);
  const gr = g.createRadialGradient(r, r, r * 0.3, r, r, r);
  gr.addColorStop(0, 'rgba(220,228,230,0.0)'); gr.addColorStop(0.5, 'rgba(225,232,234,0.25)');
  gr.addColorStop(0.8, 'rgba(240,244,246,0.6)'); gr.addColorStop(0.87, 'rgba(60,66,70,0.9)'); gr.addColorStop(0.95, 'rgba(235,240,242,0.7)'); gr.addColorStop(1, 'rgba(160,170,175,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(r, r, r, 0, 7); g.fill();
  for (let i = 0; i < 40; i++) {
    const rr = r * (0.45 + rng() * 0.5);
    g.strokeStyle = rng() < 0.5 ? 'rgba(255,255,255,0.25)' : 'rgba(90,100,105,0.18)';
    g.lineWidth = 1 + rng() * 2;
    const a0 = rng() * 6.28;
    g.beginPath(); g.arc(r, r, rr, a0, a0 + 1 + rng() * 3); g.stroke();
  }
  return c;
}
