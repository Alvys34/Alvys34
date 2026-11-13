/**
 * Donor visuals (ART owns). One InstancedMesh per physics role (7) + one for every hairdo/hat +
 * stump caps + bone nubs — all donors of every type in ~10 draw calls (x2 with shadows), sharing
 * one shader (material.js) that resolves per-instance colour slots, painted faces, gown print,
 * wounds and paling. Props (oxygen tanks, safety spheres): props.js (its own render piece).
 *
 * createDonorViews(ctx) -> { update(dt, state, alpha), onLevel(state), setQuality(q, name), dispose() }
 * Reads: state.parts (Part: role, shape, pose px..pqw -> x..qw, hp/hpMax, blood/bloodMax, opened,
 *        broken, stumps, removed), part.donor (type, look, alive, blood, lastCauseTime, impaled,
 *        encased, sphere), state.drum.omega, state.time, state.props.
 * Faces: smile (sedated, blinks) / worried / hurt / drowning (puffed cheeks) / dead (X eyes, still smiling).
 */
import { HUMANOID } from '../../sim/donors/humanoid.js';
import { bloodColors } from '../blood/palette.js';
import { toTexture } from '../environment/textures.js';
import { faceAtlasCanvas, FACE } from './faces.js';
import { buildPartGeometries, buildHairGeometry, buildStumpGeometries } from './bodyparts.js';
import { createDonorMaterials } from './material.js';
import { resolveLook } from './looks.js';

const ROLES = ['head', 'chest', 'pelvis', 'upperArm', 'forearm', 'thigh', 'shin'];
const CAP = { head: 72, chest: 72, pelvis: 72, upperArm: 150, forearm: 150, thigh: 150, shin: 150 };
const MAX_STUMPS = 256;

export function createDonorViews(ctx) {
  const { THREE, drumGroup } = ctx;
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // Geometry is authored at these FIXED reference sizes (the original standard humanoid); each
  // instance is scaled per axis from the part's actual sim shape, so any donor scaling in the sim
  // (types, global body scale) carries through to visuals automatically.
  const REF = {
    head: { type: 'ball', r: 0.13 }, chest: { type: 'box', hx: 0.19, hy: 0.2, hz: 0.11 }, pelvis: { type: 'box', hx: 0.16, hy: 0.09, hz: 0.1 },
    upperArm: { type: 'capsule', hh: 0.1, r: 0.055 }, forearm: { type: 'capsule', hh: 0.085, r: 0.05 },
    thigh: { type: 'capsule', hh: 0.13, r: 0.075 }, shin: { type: 'capsule', hh: 0.14, r: 0.06 },
  };
  void HUMANOID;
  /** per-axis scale of shape s vs the reference -> out vec3 (x radial, y length, z radial/depth) */
  function shapeScale(role, s, out) {
    const b = REF[role];
    if (!b || !s) return out.set(1, 1, 1);
    if (s.type === 'box' && b.type === 'box') return out.set(s.hx / b.hx, s.hy / b.hy, s.hz / b.hz);
    if (s.type === 'capsule' && b.type === 'capsule') { const r = s.r / b.r; return out.set(r, (s.hh + s.r) / (b.hh + b.r), r); }
    const r = (s.r ?? s.hx ?? b.r) / (b.r ?? b.hx);
    return out.set(r, r, r);
  }
  const ss = new THREE.Vector3();

  const faceTex = track(toTexture(THREE, faceAtlasCanvas(), { aniso: 4 }));
  const mats = createDonorMaterials(THREE, faceTex);
  track(mats.body); track(mats.outline);
  const geos = buildPartGeometries(THREE);
  const hairGeos = buildHairGeometry(THREE);

  const meshes = {};
  const attrs = {};
  const mkInst = (key, geo, mat, cap) => {
    track(geo);
    const A = {};
    for (const name of ['aColA', 'aColB', 'aColC', 'aState']) {
      A[name] = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      A[name].setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, A[name]);
    }
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    m.name = `donor-${key}`;
    drumGroup.add(m);
    meshes[key] = m; attrs[key] = A; m.userData.key = key;
    // inverted-hull outline sharing geometry + instance matrices (silhouette against pale tiles)
    const o = new THREE.InstancedMesh(geo, mats.outline, cap);
    o.instanceMatrix = m.instanceMatrix;
    o.frustumCulled = false; o.count = 0; o.castShadow = false; o.receiveShadow = false;
    o.name = `donor-${key}-outline`;
    drumGroup.add(o);
    outlines[key] = o;
    return m;
  };
  const outlines = {};
  for (const role of ROLES) mkInst(role, geos[role], mats.body, CAP[role]);
  const hairMeshes = {}; // style id -> InstancedMesh (body material, slot HAIR)
  for (const st of Object.keys(hairGeos)) hairMeshes[st] = mkInst(`hair${st}`, hairGeos[st], mats.body, 40);

  // stump caps (blood tint) + bone nubs
  const stumpGeos = buildStumpGeometries(THREE);
  track(stumpGeos.capGeo); track(stumpGeos.bone);
  const capMat = track(new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.05 }));
  capMat.color = bloodColors.fresh; // VFX's shared blood colour object: follows red / streamer-green
  const boneMat = track(new THREE.MeshStandardMaterial({ color: 0xf4ecd8, roughness: 0.5 }));
  const caps = new THREE.InstancedMesh(stumpGeos.capGeo, capMat, MAX_STUMPS);
  const bones = new THREE.InstancedMesh(stumpGeos.bone, boneMat, MAX_STUMPS);
  for (const m of [caps, bones]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0; m.castShadow = false;
    drumGroup.add(m);
  }

  ctx.donorAccessoriesHandled = true; // hats/hair are ours (placeholder hats off)
  const looks = new WeakMap();
  const info = new WeakMap(); // per donor: { face, worriedUntil }

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3(); const scl = new THREE.Vector3(); const off = new THREE.Vector3();
  const qa = new THREE.Quaternion(); const qb = new THREE.Quaternion(); const qc = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0); const dir = new THREE.Vector3();
  let time = 0;

  function lookOf(d) {
    let L = looks.get(d);
    if (!L) { L = resolveLook(d); looks.set(d, L); }
    return L;
  }

  function faceOf(d, state) {
    let I = info.get(d);
    if (!I) { I = { face: 0, worriedUntil: -1 }; info.set(d, I); }
    const t = state.time;
    if (!d.alive) { I.face = FACE.DEAD; return I.face; }
    const head = d.parts && d.parts.head;
    if (head && !head.removed && !d.encased && head.sub > 0.45) { I.face = FACE.DROWN; return I.face; }
    if (t - (d.lastCauseTime ?? -99) < 0.8 || d.impaled > 0) { I.face = FACE.HURT; return I.face; }
    const sp = head && !head.removed ? Math.hypot(head.vx || 0, head.vy || 0) : 0;
    const cracked = d.sphere && d.sphere.view && d.sphere.view.cracks > 0;
    if (sp > 6.5 || Math.abs(state.drum.omega) > 1.5 || d.blood < d.bloodMax * 0.8 || cracked) I.worriedUntil = t + 0.9;
    if (t < I.worriedUntil) { I.face = FACE.WORRIED; return I.face; }
    const L = lookOf(d);
    const ph = (time * 0.9 + L.blink) % 4.2;
    I.face = ph < 0.13 ? FACE.BLINK : FACE.SMILE;
    return I.face;
  }

  function writeInst(key, i, L, damage, face, drained) {
    const A = attrs[key];
    const c = L.cols; const o = i * 4;
    A.aColA.array[o] = c[0]; A.aColA.array[o + 1] = c[1]; A.aColA.array[o + 2] = c[2]; A.aColA.array[o + 3] = c[3];
    A.aColB.array[o] = c[4]; A.aColB.array[o + 1] = c[5]; A.aColB.array[o + 2] = c[6]; A.aColB.array[o + 3] = c[7];
    A.aColC.array[o] = c[8]; A.aColC.array[o + 1] = c[9]; A.aColC.array[o + 2] = c[10]; A.aColC.array[o + 3] = c[11];
    A.aState.array[o] = damage; A.aState.array[o + 1] = face; A.aState.array[o + 2] = drained; A.aState.array[o + 3] = L.seed;
  }

  return {
    update(dt, state, alpha) {
      time += dt;
      for (const k in meshes) meshes[k].count = 0;
      let ns = 0;
      for (const p of state.parts) {
        if (p.removed) continue;
        const key = p.role;
        const mesh = meshes[key];
        if (!mesh || mesh.count >= CAP[key] || !CAP[key]) continue;
        const d = p.donor;
        const L = lookOf(d);
        pos.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
        qa.set(p.pqx, p.pqy, p.pqz, p.pqw); qb.set(p.qx, p.qy, p.qz, p.qw);
        qa.slerp(qb, alpha);
        const s = p.shape;
        shapeScale(key, s, ss);
        const k = ss.x; // radial scale (stumps)
        if (key === 'head') scl.copy(ss).multiplyScalar(L.headScale);
        else { const g = L.girth[key] || 1; scl.set(ss.x * g, ss.y, ss.z * g); }
        m4.compose(pos, qa, scl);
        const i = mesh.count++;
        mesh.setMatrixAt(i, m4);
        const face = faceOf(d, state);
        let dmg = p.hpMax > 0 ? Math.max(0, Math.min(1, 1 - p.hp / p.hpMax)) : 0;
        if (p.broken) dmg = Math.max(dmg, 0.55);
        if (p.impaled) dmg = Math.max(dmg, 0.45);
        const opened = p.opened || p.severed || p.impaled || (p.wound > 0.05 && dmg > 0.2);
        const dDrain = d.bloodMax > 0 ? Math.max(0, Math.min(1, (1 - d.blood / d.bloodMax) / 0.65)) : 0;
        const pDrain = p.bloodMax > 0 ? 1 - p.blood / p.bloodMax : 0;
        writeInst(key, i, L, dmg + (opened ? 2 : 0), face, Math.max(dDrain, pDrain * 0.85));
        if (key === 'head') {
          const hm = hairMeshes[L.hairStyle];
          if (hm && hm.count < 40) {
            const hi = hm.count++;
            hm.setMatrixAt(hi, m4);
            writeInst(hm.userData.key, hi, L, 0, face, 0);
          }
        }
        // severed stumps: flat blood cap + bone nub aligned with the joint direction
        const st = p.stumps;
        for (let j = 0; j < st.length && ns < MAX_STUMPS; j++) {
          const a = st[j];
          dir.set(a[0], a[1], a[2]);
          const len = dir.length();
          if (len < 1e-4) dir.set(0, 1, 0); else dir.multiplyScalar(1 / len);
          qc.setFromUnitVectors(Y, dir).premultiply(qa);
          off.set(a[0], a[1], a[2]).multiplyScalar(0.94).applyQuaternion(qa).add(pos);
          const r = stumpRadius(key, a) * k * (key === 'head' ? 1 : (L.girth[key] || 1));
          m4.compose(off, qc, scl.set(r, r, r));
          caps.setMatrixAt(ns, m4);
          const br = r * (key === 'chest' || key === 'pelvis' ? 0.55 : 0.8);
          m4.compose(off, qc, scl.set(br, br, br));
          bones.setMatrixAt(ns, m4);
          ns++;
        }
      }
      for (const k in meshes) {
        const m = meshes[k];
        m.visible = m.count > 0;
        const o = outlines[k]; o.count = m.count; o.visible = m.count > 0;
        m.instanceMatrix.needsUpdate = true;
        const A = attrs[k];
        A.aColA.needsUpdate = true; A.aColB.needsUpdate = true; A.aColC.needsUpdate = true; A.aState.needsUpdate = true;
      }
      caps.count = ns; caps.instanceMatrix.needsUpdate = true;
      bones.count = ns; bones.instanceMatrix.needsUpdate = true;
    },
    onLevel() {},
    setQuality(q, name) {
      for (const k in meshes) meshes[k].castShadow = !!q.shadows;
    },
    dispose() {
      for (const k in meshes) { drumGroup.remove(meshes[k]); meshes[k].dispose(); }
      for (const k in outlines) drumGroup.remove(outlines[k]);
      drumGroup.remove(caps); drumGroup.remove(bones); caps.dispose(); bones.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

function stumpRadius(role, a) {
  switch (role) {
    case 'chest': return Math.abs(a[0]) > 0.1 ? 0.062 : (a[1] > 0 ? 0.066 : 0.15);
    case 'pelvis': return Math.abs(a[0]) > 0.05 ? 0.088 : 0.15;
    case 'head': return 0.066;
    case 'upperArm': return a[1] > 0 ? 0.07 : 0.05;
    case 'forearm': return 0.048;
    case 'thigh': return a[1] > 0 ? 0.09 : 0.066;
    case 'shin': return 0.058;
    default: return 0.06;
  }
}
