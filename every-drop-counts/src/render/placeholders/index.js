/**
 * PLACEHOLDER visuals for CONTENT's sim kinds (owner: CONTENT). ART replaces them.
 *
 *  - Hazard builders for 'railSaw', 'grinder', 'crusher' are registered into HAZARD_BUILDERS
 *    (src/render/donors/hazards.js) ONLY if no builder for that kind exists yet — so as soon as ART
 *    adds a real builder there, these are ignored.
 *  - createPropViews(ctx): a render piece that draws `state.props` by `prop.view.kind` using
 *    PROP_BUILDERS (exported: ART can register real builders here or replace the piece).
 *      PROP_BUILDERS[kind] = (ctx, view, mats) => ({ group, update(view, alpha, dt) })
 *  - Inspector hard hats (donor.look.accessory === 'hardhat') as one instanced mesh, unless
 *    ART's donor view sets ctx.donorAccessoriesHandled = true.
 *
 * Everything here reads sim state only (see src/sim/README.md "Snapshot fields for new kinds").
 */
import { HAZARD_BUILDERS } from '../donors/hazards.js';

const WALL_PLANE = (view, hw = 8, hh = 5) => ({ floor: -hh, ceiling: hh, left: -hw, right: hw }[view.wall]);
const basisAngle = (n) => Math.atan2(-n[0], n[1]); // rotation about z mapping local +y to the wall normal n

function addIfMissing(kind, fn) { if (!HAZARD_BUILDERS[kind]) HAZARD_BUILDERS[kind] = fn; }

// ------------------------------------------------------------------------------- hazards ----
addIfMissing('railSaw', (ctx, view, kit) => {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const depth = view.z1 - view.z0;
  const zc = (view.z0 + view.z1) / 2;
  // rail: a striped bar along the wall between the two ends
  const [ax, ay] = view.railA; const [bx, by] = view.railB;
  const len = Math.hypot(bx - ax, by - ay) + view.radius * 2;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, 0.35), kit.stripes);
  const plane = WALL_PLANE(view);
  const [nx, ny] = view.n;
  const rx = nx !== 0 ? plane + nx * 0.11 : (ax + bx) / 2;
  const ry = nx !== 0 ? (ay + by) / 2 : plane + ny * 0.11;
  rail.position.set(rx, ry, zc - depth / 2 + 0.2);
  rail.rotation.z = nx !== 0 ? Math.PI / 2 : 0;
  group.add(rail);
  const rail2 = rail.clone(); rail2.position.z = zc + depth / 2 - 0.2; group.add(rail2);
  // carriage + blades
  const car = new THREE.Group();
  const spin = new THREE.Group();
  car.add(spin);
  const n = Math.max(2, Math.round(depth / 0.5));
  const blade = new THREE.CylinderGeometry(view.radius, view.radius, 0.05, 24);
  blade.rotateX(Math.PI / 2);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(blade, kit.steel);
    m.position.z = view.z0 + (i + 0.5) * (depth / n);
    m.castShadow = true;
    spin.add(m);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(view.radius * 0.3, view.radius * 0.3, depth, 12), kit.yellow);
  hub.rotation.x = Math.PI / 2; hub.position.z = zc;
  spin.add(hub);
  // a notch so the spin reads
  const notch = new THREE.Mesh(new THREE.BoxGeometry(view.radius * 0.9, 0.08, depth * 1.01), kit.dark);
  notch.position.set(view.radius * 0.45, 0, zc); spin.add(notch);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, view.offset + 0.2, depth * 0.95), kit.yellow);
  arm.position.set(-nx * (view.offset / 2), -ny * (view.offset / 2), zc);
  arm.rotation.z = basisAngle(view.n);
  car.add(arm);
  group.add(car);
  return {
    group,
    update(v) { car.position.set(v.x, v.y, 0); spin.rotation.z = v.angle; },
  };
});

addIfMissing('grinder', (ctx, view, kit) => {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const depth = view.z1 - view.z0;
  const zc = (view.z0 + view.z1) / 2;
  const plane = WALL_PLANE(view);
  const [nx, ny] = view.n;
  // housing box from the wall to the roller face
  const housing = new THREE.Mesh(new THREE.BoxGeometry(view.width + 0.5, view.housing, depth + 0.2), kit.stripes);
  const hx = nx !== 0 ? plane + nx * view.housing / 2 : view.at;
  const hy = nx !== 0 ? view.at : plane + ny * view.housing / 2;
  housing.position.set(hx, hy, zc);
  housing.rotation.z = basisAngle(view.n);
  housing.receiveShadow = true;
  group.add(housing);
  // two toothed rollers on the face (cylinders along z)
  const rollerMat = new THREE.MeshStandardMaterial({ color: 0x9aa3a6, roughness: 0.35, metalness: 0.4, emissive: 0x000000 });
  const rg = new THREE.CylinderGeometry(0.32, 0.32, depth, 10, 1);
  rg.rotateX(Math.PI / 2);
  const rollers = [];
  const tx = view.t[0]; const ty = view.t[1];
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(rg, rollerMat);
    r.position.set(view.x + tx * s * 0.38 - nx * 0.12, view.y + ty * s * 0.38 - ny * 0.12, zc);
    r.castShadow = true;
    group.add(r);
    rollers.push({ r, s });
  }
  return {
    group,
    update(v) {
      for (const { r, s } of rollers) r.rotation.z = v.angle * s;
      rollerMat.emissive.setHex(v.clogged ? 0x662200 : 0x000000);
    },
  };
});

addIfMissing('crusher', (ctx, view, kit) => {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const depth = view.z1 - view.z0;
  const zc = (view.z0 + view.z1) / 2;
  const [nx, ny] = view.n;
  const rot = basisAngle(view.n);
  // base housing on the wall
  const baseM = new THREE.Mesh(new THREE.BoxGeometry(view.width + 0.4, 0.3, depth), kit.dark);
  baseM.position.set(view.x + nx * 0.15, view.y + ny * 0.15, zc);
  baseM.rotation.z = rot;
  group.add(baseM);
  // plate + rod
  const plate = new THREE.Mesh(new THREE.BoxGeometry(view.width, view.plate, depth), kit.stripes);
  plate.rotation.z = rot; plate.castShadow = true;
  group.add(plate);
  const rod = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1, 0.35), kit.steel);
  rod.rotation.z = rot;
  group.add(rod);
  // warning light
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0x000000, roughness: 0.4 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), lampMat);
  const tx = view.t[0]; const ty = view.t[1];
  lamp.position.set(view.x + tx * (view.width / 2 + 0.45) + nx * 0.25, view.y + ty * (view.width / 2 + 0.45) + ny * 0.25, view.z1 - 0.4);
  group.add(lamp);
  return {
    group,
    update(v) {
      const e = v.ext;
      plate.position.set(v.x + nx * (e - v.plate / 2), v.y + ny * (e - v.plate / 2), zc);
      const len = Math.max(0.01, e - v.plate);
      rod.scale.y = len;
      rod.position.set(v.x + nx * (len / 2), v.y + ny * (len / 2), zc);
      const on = v.state === 'telegraph' ? (Math.sin(v.warn * 30) > 0 ? 1 : 0.2) : (v.state === 'extend' || v.state === 'hold' ? 1 : 0);
      lampMat.emissive.setRGB(on, on * 0.45, 0);
    },
  };
});

// --------------------------------------------------------------------------------- props ----
export const PROP_BUILDERS = {
  oxygenTank(ctx, view, mats) {
    const { THREE } = ctx;
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(view.radius, view.halfLength * 2, 4, 12), mats.tank);
    body.castShadow = true;
    group.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(view.radius * 0.45, view.radius * 0.6, 0.18, 10), mats.steel);
    cap.position.y = view.halfLength + view.radius + 0.05;
    group.add(cap);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(view.radius * 0.8, 0.9, 10), mats.flame);
    flame.position.y = -(view.halfLength + view.radius + 0.45);
    flame.rotation.x = Math.PI;
    flame.visible = false;
    group.add(flame);
    return {
      group,
      update(v, alpha, dt, t) {
        flame.visible = v.state === 'punctured';
        if (flame.visible) flame.scale.setScalar(0.7 + 0.3 * Math.sin(t * 60));
      },
    };
  },
  safetySphere(ctx, view, mats) {
    const { THREE } = ctx;
    const group = new THREE.Group();
    const mat = mats.sphere.clone();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(view.radius, 24, 16), mat);
    ball.renderOrder = 2;
    group.add(ball);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(view.radius * 0.995, 0.03, 6, 32), mats.ring);
    group.add(ring);
    return {
      group,
      update(v) {
        mat.opacity = 0.16 + v.cracks * 0.3;
        mat.color.setHex(v.cracks > 0.6 ? 0xffd9a0 : v.cracks > 0.3 ? 0xf2f6ff : 0xd8f4ff);
      },
      dispose() { mat.dispose(); },
    };
  },
};

export function createPropViews(ctx) {
  const { THREE, drumGroup } = ctx;
  const root = new THREE.Group(); root.name = 'props';
  drumGroup.add(root);
  const mats = {
    tank: new THREE.MeshStandardMaterial({ color: 0xbfeee0, roughness: 0.35, metalness: 0.2 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xe4eaec, roughness: 0.3, metalness: 0.35 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.8 }),
    sphere: new THREE.MeshStandardMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.0, depthWrite: false }),
    ring: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.4 }),
  };
  const items = new Map();
  const qa = new THREE.Quaternion(); const qb = new THREE.Quaternion();
  let time = 0;

  function drop(id) {
    const it = items.get(id);
    if (!it) return;
    root.remove(it.group);
    it.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    if (it.dispose) it.dispose();
    items.delete(id);
  }
  function clear() { for (const id of [...items.keys()]) drop(id); }

  // Inspector hard hats (placeholder accessory)
  const hatGeo = new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const hatMat = new THREE.MeshStandardMaterial({ color: 0xff8a1c, roughness: 0.45 });
  const hats = new THREE.InstancedMesh(hatGeo, hatMat, 24);
  hats.frustumCulled = false; hats.count = 0; hats.castShadow = true;
  drumGroup.add(hats);
  const m4 = new THREE.Matrix4(); const pos = new THREE.Vector3(); const scl = new THREE.Vector3(); const off = new THREE.Vector3();

  return {
    onLevel() { clear(); },
    update(dt, state, alpha) {
      time += dt;
      const seen = new Set();
      for (const p of state.props || []) {
        if (p.removed || !p.view) continue;
        const b = PROP_BUILDERS[p.view.kind];
        if (!b) continue;
        seen.add(p.id);
        let it = items.get(p.id);
        if (!it) {
          it = b(ctx, p.view, mats);
          root.add(it.group);
          items.set(p.id, it);
        }
        const d = p.view.dyn;
        if (d) {
          it.group.position.set(d.px + (d.x - d.px) * alpha, d.py + (d.y - d.py) * alpha, d.pz + (d.z - d.pz) * alpha);
          qa.set(d.pqx, d.pqy, d.pqz, d.pqw); qb.set(d.qx, d.qy, d.qz, d.qw);
          it.group.quaternion.copy(qa.slerp(qb, alpha));
        }
        if (it.update) it.update(p.view, alpha, dt, time);
      }
      for (const id of [...items.keys()]) if (!seen.has(id)) drop(id);
      // hard hats
      let n = 0;
      if (!ctx.donorAccessoriesHandled) {
        for (const dn of state.donors || []) {
          if (n >= 24 || dn.look.accessory !== 'hardhat') continue;
          const h = dn.parts.head;
          if (!h || h.removed) continue;
          pos.set(h.px + (h.x - h.px) * alpha, h.py + (h.y - h.py) * alpha, h.pz + (h.z - h.pz) * alpha);
          qa.set(h.pqx, h.pqy, h.pqz, h.pqw); qb.set(h.qx, h.qy, h.qz, h.qw); qa.slerp(qb, alpha);
          off.set(0, 0.05, 0).applyQuaternion(qa);
          m4.compose(pos.add(off), qa, scl.set(1, 1, 1));
          hats.setMatrixAt(n++, m4);
        }
      }
      hats.count = n;
      hats.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      clear();
      drumGroup.remove(root); drumGroup.remove(hats);
      hats.dispose(); hatGeo.dispose(); hatMat.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
  };
}
