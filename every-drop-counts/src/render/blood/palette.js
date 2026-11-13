/**
 * THE blood colour source (VFX owns). Everything that draws blood reads its colour from here, so
 * the "blood colour" setting (GDD §12: 'red' default / 'green' streamer-safe) recolours all of it
 * at once: droplets, mist, wall/glass stains, the pool, post-processing "keep the blood" accents.
 *
 *   import { bloodColors, bloodUniforms, setBloodColor, getBloodColor, onBloodColor } from '../blood/palette.js';
 *
 *   bloodColors.fresh / deep / dry / hi / foam / mist   THREE.Color (LINEAR working space), mutated in
 *                                                       place on change: hold the reference, never copy once.
 *   bloodColors.freshHex / deepHex / ...                 sRGB hex numbers (for CSS / canvas use)
 *   bloodUniforms.uBloodFresh ... uBloodKey             shared shader uniform objects: put them in a
 *                                                       ShaderMaterial's `uniforms` (or merge in
 *                                                       onBeforeCompile) and they follow the setting.
 *   setBloodColor('red'|'green')                        also reachable as view.setBloodColor(name)
 *   onBloodColor(fn) -> unsubscribe                     fn(name) after every change (e.g. ART's stump
 *                                                       caps: mat.color.copy(bloodColors.fresh))
 *
 * ART / UI: for a MeshStandardMaterial, simplest is `material.color = bloodColors.fresh` (same object,
 * so it updates automatically). CSS: `#${bloodColors.freshHex.toString(16).padStart(6, '0')}`.
 */
import * as THREE from 'three';

export const BLOOD_PALETTES = {
  // fresh: glossy candy red; deep: inside the pool / thick pools; dry: oxidised stains;
  // hi: specular tint on wet blood; foam: froth / meniscus; mist: fine spray
  red: { fresh: 0xd1001f, deep: 0x4d0008, dry: 0x5a0d0d, hi: 0xff8a8a, foam: 0xe8687a, mist: 0xa8001a },
  green: { fresh: 0x46d11a, deep: 0x0e3d06, dry: 0x2f4a12, hi: 0xd8ffb0, foam: 0x9be27a, mist: 0x2f9a10 },
};

const KEYS = ['fresh', 'deep', 'dry', 'hi', 'foam', 'mist'];

export const bloodColors = {
  name: 'red',
  fresh: new THREE.Color(), deep: new THREE.Color(), dry: new THREE.Color(),
  hi: new THREE.Color(), foam: new THREE.Color(), mist: new THREE.Color(),
  freshHex: 0, deepHex: 0, dryHex: 0, hiHex: 0, foamHex: 0, mistHex: 0,
};

export const bloodUniforms = {
  uBloodFresh: { value: bloodColors.fresh },
  uBloodDeep: { value: bloodColors.deep },
  uBloodDry: { value: bloodColors.dry },
  uBloodHi: { value: bloodColors.hi },
  uBloodFoam: { value: bloodColors.foam },
  uBloodMist: { value: bloodColors.mist },
  /** normalised linear-RGB direction of fresh blood: post uses dot(normalize(c), key) to find "blood" pixels */
  uBloodKey: { value: new THREE.Vector3(1, 0, 0) },
};

const listeners = new Set();

export function setBloodColor(name) {
  const p = BLOOD_PALETTES[name] ? name : 'red';
  const pal = BLOOD_PALETTES[p];
  for (const k of KEYS) {
    bloodColors[k].setHex(pal[k]);
    bloodColors[`${k}Hex`] = pal[k];
  }
  const f = bloodColors.fresh;
  bloodUniforms.uBloodKey.value.set(f.r, f.g, f.b).normalize();
  const changed = bloodColors.name !== p;
  bloodColors.name = p;
  if (changed) for (const fn of listeners) { try { fn(p); } catch (e) { console.warn('[edc] blood colour listener failed', e); } }
  return p;
}

export function getBloodColor() { return bloodColors.name; }

export function onBloodColor(fn) { listeners.add(fn); return () => listeners.delete(fn); }

setBloodColor('red');
