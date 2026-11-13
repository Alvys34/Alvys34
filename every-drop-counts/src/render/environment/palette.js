/**
 * EVERY DROP COUNTS — art palette + shared materials (ART owns).
 *
 * Rule: blood is the ONLY saturated red in the game. Nothing in this palette is red; anything
 * blood-coloured (stump caps, wound centres, the collection-tank gauge, the Thin-Blood band)
 * reads its colour through `bloodColor(ctx)` so it follows the shared tint (red / streamer green).
 *
 *   import { PAL, CSS, sharedMaterials, bloodColor } from './palette.js';
 *   const M = sharedMaterials(ctx);    // cached on ctx — every ART piece shares one set
 */

/** Hex palette (three.js colours). Limited on purpose: mint, cream, chrome, hazard, a few pastels. */
export const PAL = {
  // facility mint family
  mint0: 0xeaf6f0, mint1: 0xcde9dc, mint2: 0xa6d6c2, mint3: 0x6fb39c, mint4: 0x3d7f6d, ink: 0x22403a,
  // cream / enamel
  cream0: 0xfcf9f0, cream1: 0xf3ead4, cream2: 0xe2d6b8, cream3: 0xc4b48e,
  // metal
  chrome: 0xe9eef0, steel: 0xb7c2c5, steelDark: 0x7f8c90, gunmetal: 0x4b5659, iron: 0x2c3336,
  // machine paint
  hazard: 0xf6c416, hazardDeep: 0xd9a400, black: 0x1d2123, enamel: 0xd9ebe4, enamelDeep: 0x9fc9ba,
  // accents (lights / signage) — amber is the warmest colour allowed outside blood
  amber: 0xffb02e, sky: 0x9ccbe8, lavender: 0xc6b6e6, butter: 0xf6e08e, glassTint: 0xdff6f4,
  // emergency light colour reached at fill = 1 (a LIGHT colour, not a surface colour)
  emergency: 0xff3a2a,
};

/** CSS strings for canvas drawing (same palette). */
export const CSS = {
  mint0: '#eaf6f0', mint1: '#cde9dc', mint2: '#a6d6c2', mint3: '#6fb39c', mint4: '#3d7f6d', ink: '#22403a',
  cream0: '#fcf9f0', cream1: '#f3ead4', cream2: '#e2d6b8', cream3: '#c4b48e',
  chrome: '#e9eef0', steel: '#b7c2c5', steelDark: '#7f8c90', gunmetal: '#4b5659', iron: '#2c3336',
  hazard: '#f6c416', hazardDeep: '#d9a400', black: '#1d2123', white: '#ffffff',
  amber: '#ffb02e', sky: '#9ccbe8', lavender: '#c6b6e6', butter: '#f6e08e',
};

/** Donor palettes (render picks per donor from `look.seed`; sim colour hints are fallbacks). */
export const DONOR_PAL = {
  // mid-value pastels: bright against the cream drum, never red/pink
  gowns: [0x63c9a6, 0x6fb0ec, 0xf3a865, 0xa58be0, 0xf0cf4f, 0x55c3cc, 0x93cf6b, 0x8fa3f0],
  skins: [0xf7d9c4, 0xf0c3a0, 0xdca57a, 0xbb8558, 0x94633f, 0x6b462e, 0xe9c9ae],
  hair: [0x2a2220, 0x4a3426, 0x6e4a30, 0x9a6b42, 0xc9a36a, 0xe2cd94, 0xb8b4ac, 0xe9e5dc, 0x3b3a3f],
  socks: [0xfdfcf6, 0xcde9dc, 0xf6e08e, 0xc6b6e6, 0x9ccbe8],
  band: 0xf9fbfa,
  // types
  thinSkin: [0xf4ece6, 0xeee4dc, 0xf1e8e4],
  thinGown: [0xd8e6f2, 0xe4def0, 0xdcefe8],
  bigGown: [0x4fa88c, 0x5b8fd6, 0xd98d4a, 0x8a70c8],
  suit: 0x3c4a5c, suitDark: 0x2c3644, shirt: 0xf4f6f8, tie: 0x2d6d8a, hardhat: 0xff9a1f, shoe: 0x2a2a2e,
  staff: [0x2f8f7c, 0x3a9c88, 0x2c7f9e], staffCap: 0x7fd0bd, staffShoe: 0xeef2f0,
};

const BLOOD_FALLBACK = { red: 0xb4001c, green: 0x3fae2a };

/**
 * The single blood tint used by ART for anything blood-coloured. Reads (in order) the VFX-owned
 * shared tint if it exists (`ctx.bloodTint` THREE.Color, or `ctx.blood.tint` / `ctx.blood.color`),
 * else the settings' blood colour mode. Writes into `out` (a THREE.Color) — no allocation.
 */
export function bloodColor(ctx, out) {
  const b = ctx.blood;
  const t = ctx.bloodTint || (b && (b.tint || b.color || b.bloodColor));
  if (t && t.isColor) return out.copy(t);
  if (typeof t === 'number') return out.setHex(t);
  const mode = (ctx.settings && (ctx.settings.bloodColor || ctx.settings.blood)) || 'red';
  return out.setHex(BLOOD_FALLBACK[mode] ?? BLOOD_FALLBACK.red);
}

/** Small deterministic RNG (mulberry32) for procedural art. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shared materials (one set per renderer, cached on ctx.artMaterials). Metals rely on the
 * procedural environment map installed by lighting.js (scene.environment).
 */
export function sharedMaterials(ctx) {
  if (ctx.artMaterials) return ctx.artMaterials;
  const { THREE } = ctx;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    chrome: std({ color: PAL.chrome, metalness: 0.9, roughness: 0.22 }),
    steel: std({ color: PAL.steel, metalness: 0.75, roughness: 0.38 }),
    gunmetal: std({ color: PAL.gunmetal, metalness: 0.6, roughness: 0.45 }),
    iron: std({ color: PAL.iron, metalness: 0.4, roughness: 0.6 }),
    hazard: std({ color: PAL.hazard, metalness: 0.1, roughness: 0.42 }),
    black: std({ color: PAL.black, metalness: 0.1, roughness: 0.6 }),
    enamel: std({ color: PAL.enamel, metalness: 0.05, roughness: 0.35 }),
    cream: std({ color: PAL.cream1, metalness: 0.0, roughness: 0.6 }),
    rubber: std({ color: 0x2b2f31, metalness: 0.0, roughness: 0.85 }),
    // vertex-coloured painted props (one material => merged static geometry, few draw calls)
    painted: std({ vertexColors: true, metalness: 0.05, roughness: 0.55 }),
    paintedMetal: std({ vertexColors: true, metalness: 0.7, roughness: 0.32 }),
    blade: std({ color: 0xf1f5f6, metalness: 0.95, roughness: 0.16 }),
    bone: std({ color: 0xf4ecd8, roughness: 0.55 }),
  };
  ctx.artMaterials = M;
  return M;
}

/** Paint a BufferGeometry with a flat vertex colour (for merging into a vertexColors mesh). */
export function paint(THREE, geo, hex, shade = 1) {
  const n = geo.attributes.position.count;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r * shade; arr[i * 3 + 1] = c.g * shade; arr[i * 3 + 2] = c.b * shade; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
