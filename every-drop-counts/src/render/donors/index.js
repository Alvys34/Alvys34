/**
 * Donor visuals (ART owns). Baseline: one InstancedMesh per body-part role (few draw calls),
 * per-instance colours (gown / skin), painted face on the head (alive smile / dead X-eyes),
 * red stump caps where limbs were severed.
 *
 * createDonorViews(ctx) -> { update(dt, state, alpha), setQuality(q), dispose() }
 * Reads: state.parts (Part records, drum-local poses px..pqw -> x..qw, interpolated by alpha),
 *        part.donor.look { gown, skin }, part.donor.alive, part.blood/bloodMax, part.stumps.
 */
import { faceTexture } from './faces.js';
import { HUMANOID } from '../../sim/donors/humanoid.js';

const MAX = { pelvis: 96, chest: 96, head: 96, upperArm: 192, forearm: 192, thigh: 192, shin: 192 };
const GOWN_ROLES = new Set(['pelvis', 'chest', 'upperArm', 'thigh']);

export function createDonorViews(ctx) {
  const { THREE, drumGroup } = ctx;
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // per-role geometry at standard-humanoid size; other donor types scale uniformly
  const base = {};
  for (const p of HUMANOID.parts) if (!base[p.role]) base[p.role] = p.shape;
  const geoFor = (shape) => {
    if (shape.type === 'box') return track(roundedBox(THREE, shape.hx * 2, shape.hy * 2, shape.hz * 2, Math.min(shape.hx, shape.hy, shape.hz) * 0.6));
    if (shape.type === 'capsule') return track(new THREE.CapsuleGeometry(shape.r, shape.hh * 2, 4, 10));
    return track(new THREE.SphereGeometry(shape.r, 20, 14));
  };
  const geos = {};
  for (const role of Object.keys(base)) geos[role] = geoFor(base[role]);
  const sizeOf = (s) => (s.type === 'box' ? s.hx : s.r);
  const bodyMat = track(new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.0 }));
  const aliveFace = track(faceTexture(THREE, false));
  const deadFace = track(faceTexture(THREE, true));
  const headAliveMat = track(new THREE.MeshStandardMaterial({ map: aliveFace, roughness: 0.6 }));
  const headDeadMat = track(new THREE.MeshStandardMaterial({ map: deadFace, roughness: 0.6 }));

  const meshes = {};
  const mk = (key, geo, mat, max) => {
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    drumGroup.add(m);
    meshes[key] = m;
  };
  for (const role of ['pelvis', 'chest', 'upperArm', 'forearm', 'thigh', 'shin']) mk(role, geos[role], bodyMat, MAX[role]);
  mk('headAlive', geos.head, headAliveMat, MAX.head);
  mk('headDead', geos.head, headDeadMat, MAX.head);

  const stumpMat = track(new THREE.MeshStandardMaterial({ color: 0xc8001a, roughness: 0.25, emissive: 0x300000 }));
  const stumpGeo = track(new THREE.SphereGeometry(1, 10, 8));
  const stumps = new THREE.InstancedMesh(stumpGeo, stumpMat, 512);
  stumps.frustumCulled = false; stumps.count = 0;
  drumGroup.add(stumps);
  const boneMat = track(new THREE.MeshStandardMaterial({ color: 0xf5efe0, roughness: 0.5 }));
  const bones = new THREE.InstancedMesh(stumpGeo, boneMat, 512);
  bones.frustumCulled = false; bones.count = 0;
  drumGroup.add(bones);

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3(); const scl = new THREE.Vector3();
  const qa = new THREE.Quaternion(); const qb = new THREE.Quaternion();
  const col = new THREE.Color(); const pale = new THREE.Color(0xe9e4dc); const grey = new THREE.Color(0xb9b4ad);
  const off = new THREE.Vector3();

  return {
    update(dt, state, alpha) {
      for (const k in meshes) meshes[k].count = 0;
      let ns = 0; let nb = 0;
      for (const p of state.parts) {
        if (p.removed) continue;
        let key = p.role;
        if (key === 'head') key = p.donor.alive ? 'headAlive' : 'headDead';
        const mesh = meshes[key];
        if (!mesh || mesh.count >= mesh.instanceMatrix.count) continue;
        pos.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
        qa.set(p.pqx, p.pqy, p.pqz, p.pqw); qb.set(p.qx, p.qy, p.qz, p.qw);
        qa.slerp(qb, alpha);
        const s = p.shape;
        const k = base[p.role] ? sizeOf(s) / sizeOf(base[p.role]) : 1;
        m4.compose(pos, qa, scl.set(k, k, k));
        const i = mesh.count++;
        mesh.setMatrixAt(i, m4);
        const look = p.donor.look;
        col.setHex(GOWN_ROLES.has(p.role) ? look.gown : look.skin);
        const drained = p.bloodMax > 0 ? 1 - p.blood / p.bloodMax : 0;
        if (!GOWN_ROLES.has(p.role)) col.lerp(pale, drained * 0.6);
        if (!p.donor.alive) col.lerp(grey, 0.18);
        mesh.setColorAt(i, col);
        // stump caps (red disc + bone nub) at severed joint anchors
        for (const st of p.stumps) {
          if (ns >= 512) break;
          off.set(st[0], st[1], st[2]).applyQuaternion(qa);
          const r = Math.max(0.045, (s.r || Math.min(s.hx || 0.1, s.hz || 0.1)) * 0.95);
          m4.compose(off.clone().add(pos), qa, scl.set(r, r * 0.55, r));
          stumps.setMatrixAt(ns++, m4);
          if (nb < 512) {
            off.multiplyScalar(1.08);
            m4.compose(off.add(pos), qa, scl.set(r * 0.35, r * 0.35, r * 0.35));
            bones.setMatrixAt(nb++, m4);
          }
        }
      }
      for (const k in meshes) {
        meshes[k].instanceMatrix.needsUpdate = true;
        if (meshes[k].instanceColor) meshes[k].instanceColor.needsUpdate = true;
      }
      stumps.count = ns; stumps.instanceMatrix.needsUpdate = true;
      bones.count = nb; bones.instanceMatrix.needsUpdate = true;
    },
    setQuality(q) {
      for (const k in meshes) meshes[k].castShadow = !!q.shadows;
    },
    dispose() {
      for (const k in meshes) { drumGroup.remove(meshes[k]); meshes[k].dispose(); }
      drumGroup.remove(stumps); drumGroup.remove(bones);
      for (const d of disposables) d.dispose();
    },
  };
}

/** Unit rounded box (size 1) built from a box with bevelled normals — cheap and soft-looking. */
function roundedBox(THREE, w, h, d, r) {
  const g = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const p = g.attributes.position;
  const v = new THREE.Vector3(); const inner = new THREE.Vector3();
  const hx = w / 2 - r; const hy = h / 2 - r; const hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    const dir = v.clone().sub(inner);
    if (dir.lengthSq() > 1e-8) { dir.normalize().multiplyScalar(r); v.copy(inner).add(dir); }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
