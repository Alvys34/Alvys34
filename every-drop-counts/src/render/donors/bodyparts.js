/**
 * Donor body-part geometry (ART owns). One geometry per physics role, authored in the part's local
 * frame at standard-humanoid size (src/sim/donors/humanoid.js): capsules along local y, the joint
 * to the parent at +y, +z = facing the camera at rest. Each vertex carries:
 *   aSlot  colour slot (see SLOT) resolved per instance in the donor shader
 *   aFace  (u, v, mask) face-atlas projection (head front only)
 * Hair: ALL styles live in one geometry with a per-vertex aStyle; the shader collapses the styles
 * an instance does not use (one draw call for every hairdo and hat).
 */
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const SLOT = { CLOTH: 0, SKIN: 1, TRIM: 2, FEET: 3, BAND: 4, HAIR: 5, ARM: 6, LEG: 7, LOWER: 8, ACCENT: 9 };
export const HEAD_SCALE = 1.12; // visual head is a little bigger than the physics ball (cute + readable)
export const HEAD_R = 0.13 * HEAD_SCALE;
export const HAIR = { NONE: 0, CROP: 1, BOB: 2, BUN: 3, CURLY: 4, PONY: 5, HARDHAT: 6, SCRUBCAP: 7, SIDE: 8 };

function piece(THREE, geo, slot, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], face = false, style = -1, warp = null } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  if (warp) { warp(g.attributes.position); g.computeVertexNormals(); }
  const n = g.attributes.position.count;
  g.setAttribute('aSlot', new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1));
  const f = new Float32Array(n * 3);
  if (face) {
    const p = g.attributes.position;
    for (let i = 0; i < n; i++) {
      const x = p.getX(i) / HEAD_R; const y = p.getY(i) / HEAD_R; const z = p.getZ(i) / HEAD_R;
      f[i * 3] = x * 0.5 + 0.5; f[i * 3 + 1] = y * 0.5 + 0.5;
      f[i * 3 + 2] = Math.max(0, Math.min(1, (z - 0.05) / 0.3));
    }
  }
  g.setAttribute('aFace', new THREE.BufferAttribute(f, 3));
  if (style >= 0) g.setAttribute('aStyle', new THREE.BufferAttribute(new Float32Array(n).fill(style), 1));
  return g;
}

const rbox = (THREE, w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);
/** capsule from y0 (bottom) to y1 (top) */
const cap = (THREE, r, y0, y1, rs = 10) => {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, y1 - y0 - 2 * r), 4, rs);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
};
const cyl = (THREE, r0, r1, y0, y1, rs = 12) => {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, rs, 1, true);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
};
const ring = (THREE, r, tube, y) => {
  const g = new THREE.TorusGeometry(r, tube, 5, 14);
  g.rotateX(Math.PI / 2); g.translate(0, y, 0);
  return g;
};
const taper = (fnX, fnZ = null) => (p) => {
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) * fnX(y));
    if (fnZ) p.setZ(i, p.getZ(i) * fnZ(y));
  }
};

function merge(list) {
  const g = mergeGeometries(list, false);
  for (const x of list) x.dispose();
  g.computeBoundingSphere();
  return g;
}

export function buildPartGeometries(THREE) {
  const G = {};
  const S = SLOT;
  // ---- head: ball + ears + nose (face painted by the shader) ----
  G.head = merge([
    piece(THREE, new THREE.SphereGeometry(HEAD_R, 22, 16), S.SKIN, { face: true, scale: [1, 1.04, 0.98] }),
    piece(THREE, new THREE.SphereGeometry(0.03, 8, 6), S.SKIN, { pos: [HEAD_R * 0.98, -0.005, 0], scale: [0.6, 1, 1] }),
    piece(THREE, new THREE.SphereGeometry(0.03, 8, 6), S.SKIN, { pos: [-HEAD_R * 0.98, -0.005, 0], scale: [0.6, 1, 1] }),
    piece(THREE, new THREE.SphereGeometry(0.022, 8, 6), S.SKIN, { pos: [0, -0.02, HEAD_R * 0.97], scale: [1, 0.9, 0.8] }),
  ]);
  // ---- chest (box .38 x .40 x .22): tapered torso, shoulders, neck, collar, placket/tie ----
  G.chest = merge([
    piece(THREE, rbox(THREE, 0.39, 0.42, 0.23, 0.09), S.CLOTH, { pos: [0, -0.01, 0], warp: taper((y) => 0.86 + 0.2 * Math.max(0, Math.min(1, (y + 0.2) / 0.4)), (y) => 0.95 + 0.06 * Math.max(0, (y + 0.2) / 0.4)) }),
    piece(THREE, new THREE.SphereGeometry(0.08, 10, 8), S.CLOTH, { pos: [0.19, 0.14, 0], scale: [1, 0.85, 1.05] }),
    piece(THREE, new THREE.SphereGeometry(0.08, 10, 8), S.CLOTH, { pos: [-0.19, 0.14, 0], scale: [1, 0.85, 1.05] }),
    piece(THREE, cyl(THREE, 0.062, 0.056, 0.17, 0.275, 12), S.SKIN),
    piece(THREE, ring(THREE, 0.074, 0.024, 0.195), S.TRIM, { scale: [1, 1, 0.92] }),
    piece(THREE, rbox(THREE, 0.06, 0.25, 0.03, 0.012, 1), S.ACCENT, { pos: [0, 0.04, 0.118], warp: taper((y) => (y < -0.05 ? 0.75 : 1)) }),
  ]);
  // ---- pelvis (box .32 x .18 x .2): flared gown skirt / trousers ----
  G.pelvis = merge([
    piece(THREE, rbox(THREE, 0.35, 0.24, 0.23, 0.085), S.LOWER, { pos: [0, -0.01, 0], warp: taper((y) => 1.0 + Math.max(0, -y) * 0.6) }),
  ]);
  // ---- upper arm (capsule r .055, y ±.155): sleeve + trim + skin ----
  G.upperArm = merge([
    piece(THREE, cyl(THREE, 0.074, 0.07, -0.01, 0.16, 12), S.CLOTH),
    piece(THREE, new THREE.SphereGeometry(0.07, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), S.CLOTH, { pos: [0, 0.16, 0] }),
    piece(THREE, ring(THREE, 0.073, 0.014, -0.01), S.TRIM),
    piece(THREE, cap(THREE, 0.05, -0.165, 0.06, 10), S.ARM),
  ]);
  // ---- forearm (capsule r .05, y ±.135): arm + wristband + mitten hand ----
  G.forearm = merge([
    piece(THREE, cap(THREE, 0.046, -0.12, 0.145, 10), S.ARM, { warp: taper((y) => 0.85 + 0.15 * Math.max(0, Math.min(1, (y + 0.12) / 0.25))) }),
    piece(THREE, ring(THREE, 0.04, 0.017, -0.085), S.BAND),
    piece(THREE, new THREE.SphereGeometry(0.056, 10, 8), S.SKIN, { pos: [0, -0.16, 0.006], scale: [0.88, 1.18, 0.62] }),
    piece(THREE, new THREE.SphereGeometry(0.022, 6, 5), S.SKIN, { pos: [0, -0.135, 0.036], scale: [1, 1.4, 1] }),
  ]);
  // ---- thigh (capsule r .075, y ±.205): gown hem + trim + leg ----
  G.thigh = merge([
    piece(THREE, cyl(THREE, 0.092, 0.088, 0.02, 0.215, 12), S.LOWER),
    piece(THREE, ring(THREE, 0.091, 0.015, 0.02), S.TRIM),
    piece(THREE, cap(THREE, 0.068, -0.215, 0.1, 10), S.LEG, { warp: taper((y) => 0.88 + 0.12 * Math.max(0, Math.min(1, (y + 0.2) / 0.3))) }),
  ]);
  // ---- shin (capsule r .06, y ±.2): leg + grippy sock + foot ----
  G.shin = merge([
    piece(THREE, cap(THREE, 0.057, -0.15, 0.21, 10), S.LEG, { warp: taper((y) => 0.82 + 0.18 * Math.max(0, Math.min(1, (y + 0.15) / 0.3))) }),
    piece(THREE, cyl(THREE, 0.05, 0.052, -0.235, -0.11, 10), S.FEET),
    piece(THREE, rbox(THREE, 0.105, 0.075, 0.21, 0.034, 2), S.FEET, { pos: [0, -0.24, 0.045] }),
  ]);
  return G;
}

/** Every hairdo / hat in one geometry (head-local, standard head). */
export function buildHairGeometry(THREE) {
  const R = HEAD_R; const H = HAIR; const S = SLOT.HAIR;
  const list = [];
  const sph = (r, ws, hs, phiS, phiL, thS, thL) => new THREE.SphereGeometry(r, ws, hs, phiS, phiL, thS, thL);
  // three.js sphere: phi around y starting at -x going toward +z? (phi=0 at +x? -> x = -cos(phi)sin(theta)); face is +z => phi = PI/2 .. -> we
  // use "back" coverage = phi in [PI, 2PI] (z <= 0) and full caps for the crown.
  const crown = (style, r = 1.07, th = 0.36) => list.push(piece(THREE, sph(R * r, 18, 8, 0, Math.PI * 2, 0, Math.PI * th), S, { style, pos: [0, R * 0.02, -R * 0.03] }));
  const backHalf = (style, r = 1.06, th = 0.62) => list.push(piece(THREE, sph(R * r, 14, 8, Math.PI, Math.PI, 0, Math.PI * th), S, { style }));
  // CROP
  crown(H.CROP); backHalf(H.CROP, 1.055, 0.6);
  // BOB: crown + longer back/sides (down past the ears)
  crown(H.BOB, 1.09, 0.4);
  list.push(piece(THREE, sph(R * 1.1, 16, 10, Math.PI * 0.82, Math.PI * 1.36, 0, Math.PI * 0.74), S, { style: H.BOB }));
  // BUN
  crown(H.BUN); backHalf(H.BUN, 1.055, 0.58);
  list.push(piece(THREE, sph(R * 0.48, 10, 8, 0, Math.PI * 2, 0, Math.PI), S, { style: H.BUN, pos: [0, R * 0.92, -R * 0.42] }));
  // CURLY: bumpy cloud
  const curls = [[0, 0.95, -0.1, 0.5], [0.55, 0.7, -0.15, 0.45], [-0.55, 0.7, -0.15, 0.45], [0.35, 0.8, 0.35, 0.38], [-0.35, 0.8, 0.35, 0.38],
    [0, 0.55, -0.7, 0.5], [0.65, 0.2, -0.45, 0.42], [-0.65, 0.2, -0.45, 0.42], [0, 0.85, 0.3, 0.36]];
  for (const [x, y, z, r] of curls) list.push(piece(THREE, sph(R * r, 9, 7, 0, Math.PI * 2, 0, Math.PI), S, { style: H.CURLY, pos: [x * R, y * R, z * R] }));
  // PONYTAIL
  crown(H.PONY); backHalf(H.PONY, 1.055, 0.55);
  list.push(piece(THREE, new THREE.CapsuleGeometry(R * 0.22, R * 0.9, 3, 8), S, { style: H.PONY, pos: [0, R * 0.15, -R * 1.12], rot: [0.35, 0, 0] }));
  // SIDE PART (swoop over one side of the forehead)
  crown(H.SIDE, 1.08, 0.38); backHalf(H.SIDE, 1.06, 0.6);
  list.push(piece(THREE, sph(R * 0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), S, { style: H.SIDE, pos: [R * 0.32, R * 0.62, R * 0.38], rot: [0.5, 0, -0.5], scale: [1.2, 0.5, 0.8] }));
  // HARD HAT: dome + brim + front peak + ridge
  list.push(piece(THREE, sph(R * 1.16, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), S, { style: H.HARDHAT, pos: [0, R * 0.12, 0] }));
  list.push(piece(THREE, new THREE.CylinderGeometry(R * 1.32, R * 1.36, R * 0.09, 20), S, { style: H.HARDHAT, pos: [0, R * 0.15, R * 0.06], scale: [1, 1, 1.08] }));
  list.push(piece(THREE, rbox(THREE, R * 0.28, R * 0.25, R * 2.2, R * 0.1, 2), S, { style: H.HARDHAT, pos: [0, R * 1.15, 0] }));
  // SCRUB CAP: smooth cap a bit lower at the back + a tie band
  list.push(piece(THREE, sph(R * 1.1, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), S, { style: H.SCRUBCAP, pos: [0, R * 0.02, -R * 0.04] }));
  list.push(piece(THREE, sph(R * 1.09, 14, 8, Math.PI, Math.PI, 0, Math.PI * 0.6), S, { style: H.SCRUBCAP }));
  const g = mergeGeometries(list, false);
  for (const x of list) x.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Severed-limb cap: flat glossy disc (blood tint) with a darker rim, normal along +y. */
export function buildStumpGeometries(THREE) {
  const capGeo = new THREE.CylinderGeometry(1, 0.96, 0.22, 14, 1);
  capGeo.translate(0, -0.06, 0);
  const bone = mergeGeometries([
    new THREE.CylinderGeometry(0.3, 0.34, 0.5, 8).translate(0, 0.2, 0),
    new THREE.SphereGeometry(0.4, 8, 6).translate(0, 0.48, 0),
  ].map((g) => { const n = g.toNonIndexed(); g.dispose(); n.deleteAttribute('uv'); return n; }), false);
  return { capGeo, bone };
}
