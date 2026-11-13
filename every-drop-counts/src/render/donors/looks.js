/**
 * Per-donor look (ART owns): resolved once per donor from donor.type + donor.look (seeded), then
 * cached. Colours come from the ART palette, never from red; the sim's colour hints are only used
 * for unknown donor types.
 *
 * look = { cols: Float32Array(12) packed hex per slot (see material.js), girth: {role: [sx,sz]},
 *          headScale, blink (phase), type }
 */
import { DONOR_PAL as D } from '../environment/palette.js';
import { HAIR } from './bodyparts.js';

const BLOOD = -1; // shader: negative colour = shared blood tint

function rng(seed) {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const lighten = (hex, k) => {
  const f = (v) => Math.round(v + (255 - v) * k);
  return (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
};
const darken = (hex, k) => {
  const f = (v) => Math.round(v * (1 - k));
  return (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
};

const HAIR_WEIGHTS = [[HAIR.CROP, 3], [HAIR.BOB, 2], [HAIR.BUN, 1.5], [HAIR.CURLY, 1.5], [HAIR.PONY, 1.2], [HAIR.SIDE, 2], [HAIR.NONE, 0.9]];
function pickHair(r) {
  let tot = 0; for (const [, w] of HAIR_WEIGHTS) tot += w;
  let x = r() * tot;
  for (const [s, w] of HAIR_WEIGHTS) { x -= w; if (x <= 0) return s; }
  return HAIR.CROP;
}

export function resolveLook(donor) {
  const L = donor.look || {};
  const seed = L.seed ?? donor.id * 7919;
  const r = rng(seed);
  const type = donor.type;
  const outfit = L.outfit || (type === 'inspector' ? 'suit' : 'gown');
  const staff = outfit === 'staff' || type === 'staff';
  let skin = pick(r, D.skins);
  let cloth = pick(r, D.gowns);
  let hairStyle = pickHair(r);
  let hairCol = pick(r, D.hair);
  if (skin === D.skins[5] || skin === D.skins[4]) hairCol = pick(r, [D.hair[0], D.hair[1], D.hair[8], D.hair[0]]);
  const socks = pick(r, D.socks);
  const pattern = r() < 0.55 ? 1 : 0;
  // proportions (visual only; physics shapes are fixed): girth + head size
  const girthTorso = 0.92 + r() * 0.2;
  const girthLimb = 0.92 + r() * 0.16;
  let headScale = 0.95 + r() * 0.1;
  let look = {
    cloth, skin, trim: 0xf7f8f4, feet: socks, band: D.band, hair: hairCol, arm: skin, leg: skin,
    lower: cloth, accent: cloth, hairStyle, pattern,
  };

  if (type === 'thinBlood') {
    skin = pick(r, D.thinSkin);
    cloth = pick(r, D.thinGown);
    look = { ...look, cloth, skin, arm: skin, leg: skin, lower: cloth, accent: cloth, band: BLOOD, hair: pick(r, [0xe2cd94, 0xc9a36a, 0xb8b4ac, 0x4a3426]) };
  } else if (type === 'bigGiver') {
    cloth = pick(r, D.bigGown);
    look = { ...look, cloth, lower: cloth, accent: cloth };
  } else if (type === 'inspector' || outfit === 'suit') {
    look = {
      ...look, cloth: D.suit, trim: D.shirt, accent: D.tie, arm: D.suit, leg: D.suitDark, lower: D.suitDark,
      feet: D.shoe, band: D.suit, hair: D.hardhat, hairStyle: HAIR.HARDHAT, pattern: 0,
    };
    headScale = 1.0;
  } else if (!(type in KNOWN)) {
    // unknown CONTENT type: honour the sim's hints (no reds by contract)
    if (typeof L.gown === 'number') look.cloth = look.lower = look.accent = L.gown;
    if (typeof L.skin === 'number') look.skin = look.arm = look.leg = L.skin;
  }
  if (staff && type !== 'inspector') {
    // shift 8 "Staff Appreciation Day": teal scrubs, white clogs, ID badge, some scrub caps
    // ART palette (darker teal than the level hint so scrubs read against the mint floor band)
    const scrub = pick(r, D.staff);
    look = {
      ...look, cloth: scrub, lower: scrub, leg: scrub, trim: darken(scrub, 0.18), accent: 0xf7f8f4,
      feet: D.staffShoe, band: 0xf7f8f4, pattern: 0,
    };
    if (r() < 0.55) { look.hairStyle = HAIR.SCRUBCAP; look.hair = pick(r, [D.staffCap, lighten(scrub, 0.35)]); }
  }
  if (L.accessory === 'hardhat') { look.hairStyle = HAIR.HARDHAT; look.hair = D.hardhat; }
  if (L.accessory === 'wristband' && type !== 'thinBlood') look.band = BLOOD;
  if (type === 'bigGiver') look.feet = pick(r, D.socks);

  const big = type === 'bigGiver';
  const cols = new Float32Array([
    look.cloth, look.skin, look.trim, look.feet,
    look.band, look.hair, look.arm, look.leg,
    look.lower, look.accent, look.hairStyle, look.pattern,
  ]);
  return {
    cols,
    girth: {
      chest: big ? 1.2 : girthTorso, pelvis: big ? 1.24 : girthTorso, upperArm: big ? 1.15 : girthLimb,
      forearm: big ? 1.1 : girthLimb, thigh: big ? 1.2 : girthLimb, shin: big ? 1.08 : 1,
    },
    headScale: big ? 0.92 : headScale,
    blink: r() * 10,
    seed: (seed % 97) + r(),
    type,
  };
}

const KNOWN = { standard: 1, bigGiver: 1, thinBlood: 1, inspector: 1, staff: 1 };
