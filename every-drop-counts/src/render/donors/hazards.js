/**
 * Hazard visuals (ART owns). Built from each sim hazard's `view` (drum-local plain data) when the
 * hazard list changes; animated from the same view every frame. All hazards share the hazard
 * language: chrome/steel cutting parts, hazard-yellow/black striping where they meet the wall.
 *
 *   spikes   { wall, from, to, z0, z1, height, n, t, impaled }        striped base + steel cones (instanced), tips stain with blood
 *   saw      { wall, x, y, z0, z1, radius, angle, spin, n, dir }        toothed gang emerging from a striped wall slot, motion blur, staining
 *   railSaw  { wall, n, t, from, to, offset, railA, railB, x, y, z0, z1, radius, angle, spin, u, vel }
 *   grinder  { wall, n, t, at, width, housing, z0, z1, x, y, angle, clogged, held, chewing, boost }
 *   crusher  { wall, n, t, at, width, plate, z0, z1, span, reach, x, y, ext, state, warn }
 *
 * createHazardViews(ctx) -> { onLevel(state), update(dt, state, alpha), setQuality(q, name), dispose() }
 * Builders: HAZARD_BUILDERS[kind] = (ctx, view, kit) => ({ group, update(view, dt, state), dispose? })
 */
import { PAL, sharedMaterials } from '../environment/palette.js';
import { bloodColors } from '../blood/palette.js';
import { builder, rbox, cylZ, atlasPlane } from '../environment/geo.js';
import { stripeTexture, sawBlurCanvas, toTexture } from '../environment/textures.js';
import { getSigns } from '../environment/index.js';

export const HAZARD_BUILDERS = {
  spikes: buildSpikes,
  saw: buildSaw,
  railSaw: buildRailSaw,
  'rail-saw': buildRailSaw,
  grinder: buildGrinder,
  crusher: buildCrusher,
};

const HW = 8; const HH = 5;

export function createHazardViews(ctx) {
  const { THREE, drumGroup, bus } = ctx;
  const root = new THREE.Group(); root.name = 'hazards';
  drumGroup.add(root);
  const M = sharedMaterials(ctx);
  const own = [];
  const track = (o) => { own.push(o); return o; };
  const stripeTex = track(stripeTexture(THREE, { stripes: 4 }));
  const blurTex = track(toTexture(THREE, sawBlurCanvas()));
  const kit = {
    M, track: (o) => o, // per-item geometry is disposed by clear() (traverse)
    stripes: track(new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.48, metalness: 0.1 })),
    blade: M.blade,
    blur: blurTex,
    signs: getSigns(ctx),
    blood: bloodColors.fresh, // VFX's shared blood colour (live object)
    contacts: [], // spike/saw stain hooks: (pos) => bool
  };
  let items = [];
  let lastHazards = null;
  const offs = [];
  if (bus) {
    offs.push(bus.on('hazard:contact', (p) => { if (p && p.pos) for (const fn of kit.contacts) fn(p); }));
  }

  function clear() {
    for (const it of items) {
      root.remove(it.group);
      if (it.dispose) it.dispose();
      it.group.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
    }
    items = [];
    kit.contacts.length = 0;
  }
  function build(state) {
    clear();
    lastHazards = state.hazards;
    for (const h of state.hazards) {
      if (!h.view) continue;
      const b = HAZARD_BUILDERS[h.view.kind] || HAZARD_BUILDERS[h.type] || buildPlaceholder;
      const it = b(ctx, h.view, kit);
      it.hazard = h;
      root.add(it.group);
      items.push(it);
    }
  }

  return {
    onLevel(state) { build(state); },
    update(dt, state) {
      if (state.hazards !== lastHazards) build(state);
      for (const it of items) if (it.update) it.update(it.hazard.view, dt, state);
    },
    setQuality() {},
    dispose() {
      clear();
      offs.forEach((o) => o());
      drumGroup.remove(root);
      for (const o of own) o.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// helpers
/** rotation about z that maps local +y to the inward wall normal n */
const wallRot = (n) => Math.atan2(-n[0], n[1]);
/** drum-local point on `wall` at tangent coord `at`, `off` metres inward */
function wallPt(view, at, off = 0) {
  const n = view.n; const t = view.t || (n[0] !== 0 ? [0, 1] : [1, 0]);
  const plane = { floor: -HH, ceiling: HH, left: -HW, right: HW }[view.wall];
  const bx = n[0] !== 0 ? plane : 0; const by = n[0] !== 0 ? 0 : plane;
  return [bx + t[0] * at + n[0] * off, by + t[1] * at + n[1] * off];
}
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
function mesh(THREE, geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

/** A gang of toothed discs along z (one merged geometry), plus a blur disc on the front blade. */
function sawGang(ctx, kit, radius, z0, z1) {
  const { THREE } = ctx;
  const depth = z1 - z0;
  const n = Math.max(2, Math.round(depth / 0.42));
  const teeth = 30;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2; const a1 = ((i + 0.55) / teeth) * Math.PI * 2; const a2 = ((i + 0.7) / teeth) * Math.PI * 2;
    const r0 = radius * 0.86;
    if (i === 0) shape.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0); else shape.lineTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
    shape.lineTo(Math.cos(a1) * radius, Math.sin(a1) * radius);
    shape.lineTo(Math.cos(a2) * radius * 0.9, Math.sin(a2) * radius * 0.9);
  }
  shape.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, radius * 0.1, 0, Math.PI * 2, true); shape.holes.push(hole);
  const B = builder(THREE, { colors: true });
  const C = builder(THREE, { colors: true });
  for (let i = 0; i < n; i++) {
    const z = z0 + (i + 0.5) * (depth / n);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 3 });
    B.add(g, { pos: [0, 0, z - 0.022], color: 0xffffff });
    // decorative ring + vent slots, slightly darker
    C.add(new THREE.RingGeometry(radius * 0.42, radius * 0.5, 20), { pos: [0, 0, z + 0.03], color: 0x9aa6aa });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      C.add(new THREE.CircleGeometry(radius * 0.07, 10), { pos: [Math.cos(a) * radius * 0.62, Math.sin(a) * radius * 0.62, z + 0.03], color: 0x3b4447 });
    }
  }
  // hub: drum through the gang + collars
  C.add(cylZ(THREE, radius * 0.24, radius * 0.24, depth + 0.04, 18), { pos: [0, 0, (z0 + z1) / 2], color: PAL.gunmetal });
  C.add(cylZ(THREE, radius * 0.12, radius * 0.12, depth + 0.12, 10), { pos: [0, 0, (z0 + z1) / 2], color: PAL.hazard });
  const bladeMat = kit.blade.clone();
  bladeMat.vertexColors = true;
  const blades = mesh(THREE, kit.track(B.build()), bladeMat);
  const hub = mesh(THREE, kit.track(C.build()), kit.M.paintedMetal);
  const spin = new THREE.Group();
  spin.add(blades, hub);
  const blurMat = new THREE.MeshBasicMaterial({ map: kit.blur, transparent: true, opacity: 0, depthWrite: false, color: 0xaab4b8 });
  const blurGeo = new THREE.PlaneGeometry(radius * 2.02, radius * 2.02);
  const blur = new THREE.Mesh(blurGeo, blurMat);
  blur.position.z = z1 + 0.03;
  blur.renderOrder = 3;
  const steel = new THREE.Color(0xc6ced2);
  let stain = 0;
  return {
    spin, blur, bladeMat,
    update(view, dt, stained = 0) {
      spin.rotation.z = view.angle || 0;
      const sp = Math.abs(view.spin || 0);
      blurMat.opacity = Math.min(0.5, Math.max(0, (sp - 6) / 30));
      blur.rotation.z = (view.angle || 0) * 0.05;
      stain = Math.min(0.65, stain + stained);
      bladeMat.color.copy(steel).lerp(kit.blood, stain);
      blurMat.color.setRGB(0.4, 0.45, 0.47).lerp(kit.blood, stain * 0.7);
    },
    dispose() { bladeMat.dispose(); blurMat.dispose(); blurGeo.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
function buildSpikes(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const len = view.to - view.from;
  const depth = view.z1 - view.z0;
  const h = view.height || 0.45;
  const mid = (view.from + view.to) / 2;
  const [px, py] = wallPt(view, mid, 0);
  group.position.set(px, py, (view.z0 + view.z1) / 2);
  group.rotation.z = wallRot(view.n);
  // base strip: striped rounded slab + dark edging
  const base = mesh(THREE, kit.track(scaleUV(rbox(THREE, len, 0.16, depth, 0.05, 2), len / 0.9, 1)), kit.stripes);
  base.position.y = 0.06;
  group.add(base);
  const E = builder(THREE, { colors: true });
  E.add(rbox(THREE, len + 0.12, 0.08, depth + 0.06, 0.03), { pos: [0, 0.01, 0], color: PAL.iron });
  E.add(rbox(THREE, len - 0.1, 0.05, depth - 0.18, 0.02), { pos: [0, 0.155, 0], color: PAL.gunmetal });
  group.add(mesh(THREE, kit.track(E.build()), kit.M.paintedMetal));
  // spikes (instanced): faceted cone with a collar
  const spacing = 0.4;
  const nx = Math.max(1, Math.floor(len / spacing)); const nz = Math.max(1, Math.floor(depth / spacing));
  const S = builder(THREE);
  S.add(new THREE.ConeGeometry(0.1, h, 6), { pos: [0, h / 2, 0] });
  S.add(new THREE.CylinderGeometry(0.12, 0.13, 0.05, 6), { pos: [0, 0.02, 0] });
  const spikeGeo = kit.track(S.build());
  const count = nx * nz;
  const cones = new THREE.InstancedMesh(spikeGeo, kit.blade, count);
  cones.castShadow = true; cones.receiveShadow = true;
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler(); const v = new THREE.Vector3(); const s = new THREE.Vector3();
  const local = [];
  let i = 0;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const x = -len / 2 + (a + 0.5) * (len / nx) + ((b % 2) - 0.5) * 0.08;
      const z = -depth / 2 + (b + 0.5) * (depth / nz);
      const k = 0.85 + ((a * 7 + b * 13) % 5) * 0.06;
      m4.compose(v.set(x, 0.17, z), q.setFromEuler(e.set(((a * 3 + b) % 5 - 2) * 0.03, a * 0.7, ((a + b * 3) % 5 - 2) * 0.03)), s.set(1, k, 1));
      cones.setMatrixAt(i++, m4);
      local.push([x, z, k]);
    }
  }
  group.add(cones);
  // blood-stained tips (instanced sleeves over the top of hit spikes)
  const tipGeo = kit.track(new THREE.ConeGeometry(0.068, h * 0.5, 6).translate(0, h * 0.75, 0));
  const tipMat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1 });
  tipMat.color = bloodColors.fresh;
  const tips = new THREE.InstancedMesh(tipGeo, tipMat, count);
  tips.count = 0;
  group.add(tips);
  const bloody = new Uint8Array(count);
  const widen = new THREE.Matrix4().makeScale(1.05, 1.0, 1.05);
  const inv = new THREE.Matrix4();
  const hitLocal = new THREE.Vector3();
  kit.contacts.push((p) => {
    if (p.hazard !== 'spike' && p.hazard !== 'spikes') return;
    group.updateMatrix();
    inv.copy(group.matrix).invert();
    hitLocal.set(p.pos[0], p.pos[1], p.pos[2]).applyMatrix4(inv);
    if (hitLocal.y > h + 1.2 || hitLocal.x < -len / 2 - 0.4 || hitLocal.x > len / 2 + 0.4) return;
    // stain the 1-3 nearest spikes
    for (let n = 0; n < 3; n++) {
      let best = -1; let bd = 0.55 * 0.55;
      for (let j = 0; j < count; j++) {
        if (bloody[j]) continue;
        const dx = local[j][0] - hitLocal.x; const dz = local[j][1] - hitLocal.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = j; }
      }
      if (best < 0) break;
      bloody[best] = 1;
      cones.getMatrixAt(best, m4);
      m4.multiply(widen);
      tips.setMatrixAt(tips.count++, m4);
      tips.instanceMatrix.needsUpdate = true;
    }
  });
  return {
    group,
    dispose() { tipMat.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
function slotPlate(ctx, kit, view, halfLen, z0, z1) {
  const { THREE } = ctx;
  const depth = z1 - z0;
  const g = new THREE.Group();
  const P = builder(THREE, { colors: true });
  P.add(rbox(THREE, halfLen * 2 + 0.3, 0.07, depth + 0.3, 0.03), { pos: [0, 0.02, 0], color: PAL.iron });
  P.add(new THREE.BoxGeometry(halfLen * 2, 0.02, 0.16), { pos: [0, 0.06, 0], color: 0x111416 });
  const plate = mesh(THREE, kit.track(P.build()), kit.M.paintedMetal);
  const st = builder(THREE);
  st.add(scaleUV(new THREE.BoxGeometry(halfLen * 2 + 0.3, 0.08, 0.14), (halfLen * 2 + 0.3) / 0.8, 1), { pos: [0, 0.03, -depth / 2 - 0.08] });
  st.add(scaleUV(new THREE.BoxGeometry(halfLen * 2 + 0.3, 0.08, 0.14), (halfLen * 2 + 0.3) / 0.8, 1), { pos: [0, 0.03, depth / 2 + 0.08] });
  const stripes = mesh(THREE, kit.track(st.build()), kit.stripes);
  g.add(plate, stripes);
  void view;
  return g;
}

function buildSaw(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const R = view.radius || 1.1;
  // slot plate on the wall where the blades emerge
  const [nx, ny] = view.n || [0, 1];
  const plane = { floor: -HH, ceiling: HH, left: -HW, right: HW }[view.wall];
  const off = nx !== 0 ? Math.abs(plane - view.x) : Math.abs(plane - view.y);
  const chord = Math.sqrt(Math.max(0.05, R * R - off * off));
  const wall = new THREE.Group();
  wall.position.set(view.x - nx * off, view.y - ny * off, (view.z0 + view.z1) / 2);
  wall.rotation.z = wallRot(view.n);
  wall.add(slotPlate(ctx, kit, view, chord + 0.15, view.z0, view.z1));
  // warning glyph next to the slot
  const r = kit.signs.rects.moving;
  const sign = mesh(THREE, kit.track(atlasPlane(THREE, 0.7, 0.7, r.uv)), kit.signs.material, { cast: false });
  sign.position.set(chord + 0.75, 0.08, 0);
  sign.rotation.x = -Math.PI / 2;
  wall.add(sign);
  group.add(wall);
  const gang = sawGang(ctx, kit, R, view.z0, view.z1);
  const holder = new THREE.Group();
  holder.position.set(view.x, view.y, 0);
  holder.add(gang.spin, gang.blur);
  group.add(holder);
  return {
    group,
    update(v, dt) { gang.update(v, dt, this.hazard && this.hazard.load ? this.hazard.load * dt * 0.06 : 0); },
    dispose() { gang.dispose(); },
  };
}

function buildRailSaw(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const R = view.radius || 0.95;
  const off = view.offset ?? R * 0.3;
  const lo = Math.min(view.from, view.to); const hi = Math.max(view.from, view.to);
  const mid = (lo + hi) / 2; const half = (hi - lo) / 2;
  const [wx, wy] = wallPt(view, mid, 0);
  const rail = new THREE.Group();
  rail.position.set(wx, wy, (view.z0 + view.z1) / 2);
  rail.rotation.z = wallRot(view.n);
  // flip so local +x follows the wall tangent
  const t = view.t || [1, 0];
  const lx = Math.cos(rail.rotation.z); const ly = Math.sin(rail.rotation.z);
  const sgn = Math.sign(lx * t[0] + ly * t[1]) || 1;
  const chord = Math.sqrt(Math.max(0.05, R * R - off * off));
  rail.add(slotPlate(ctx, kit, view, half + chord + 0.1, view.z0, view.z1));
  // twin chrome rails + end stops
  const B = builder(THREE, { colors: true });
  const depth = view.z1 - view.z0;
  for (const s of [-1, 1]) {
    B.add(rbox(THREE, (half + chord) * 2 + 0.6, 0.12, 0.12, 0.04), { pos: [0, 0.1, s * (depth / 2 + 0.28)], color: PAL.chrome });
    for (const e of [-1, 1]) B.add(rbox(THREE, 0.3, 0.35, 0.3, 0.06), { pos: [e * (half + chord + 0.35), 0.17, s * (depth / 2 + 0.28)], color: PAL.hazard });
  }
  rail.add(mesh(THREE, kit.track(B.build()), kit.M.paintedMetal));
  group.add(rail);
  // moving carriage: yellow trolleys on both rails + the blade gang
  const car = new THREE.Group();
  const C = builder(THREE, { colors: true });
  for (const s of [-1, 1]) {
    C.add(rbox(THREE, 0.9, 0.3, 0.3, 0.08), { pos: [0, 0.2, s * (depth / 2 + 0.28)], color: PAL.hazard });
    C.add(rbox(THREE, 0.2, off + 0.1, 0.12, 0.04), { pos: [0, (off + 0.1) / 2 + 0.1, s * (depth / 2 + 0.2)], color: PAL.gunmetal });
  }
  const carMesh = mesh(THREE, kit.track(C.build()), kit.M.paintedMetal);
  const carFrame = new THREE.Group();
  carFrame.rotation.z = rail.rotation.z;
  carFrame.add(carMesh);
  car.add(carFrame);
  const gang = sawGang(ctx, kit, R, view.z0, view.z1);
  car.add(gang.spin, gang.blur);
  group.add(car);
  void sgn;
  return {
    group,
    update(v, dt) {
      const [cx, cy] = [v.x, v.y];
      car.position.set(cx, cy, 0);
      // carriage frame sits on the wall: shift it back by the offset along -n
      carFrame.position.set(-v.n[0] * off, -v.n[1] * off, (v.z0 + v.z1) / 2);
      gang.update(v, dt, (this.hazard && this.hazard.load ? this.hazard.load * dt * 0.06 : 0));
    },
    dispose() { gang.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
function buildGrinder(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const W = view.width || 2.4; const Hh = view.housing || 0.55;
  const z0 = view.z0; const z1 = view.z1; const depth = z1 - z0;
  const [wx, wy] = wallPt(view, view.at, 0);
  group.position.set(wx, wy, (z0 + z1) / 2);
  group.rotation.z = wallRot(view.n);
  // housing: striped sides, gunmetal top frame with the jaw opening
  const sides = mesh(THREE, kit.track(scaleUV(rbox(THREE, W + 0.5, Hh + 0.02, depth + 0.2, 0.08, 2), (W + 0.5) / 0.8, 1)), kit.stripes);
  sides.position.y = Hh / 2 - 0.02;
  group.add(sides);
  const rr = Math.min(0.32, W * 0.13);
  const B = builder(THREE, { colors: true });
  const lip = 0.18;
  B.add(rbox(THREE, W + 0.62, 0.1, depth + 0.32, 0.04), { pos: [0, Hh + 0.0, 0], color: PAL.gunmetal });
  B.add(new THREE.BoxGeometry(rr * 4.2, 0.02, depth - 0.05), { pos: [0, Hh + 0.055, 0], color: 0x0d1011 });
  B.add(rbox(THREE, lip, 0.14, depth + 0.32, 0.04), { pos: [-(rr * 2.1 + lip / 2), Hh + 0.04, 0], color: PAL.hazard });
  B.add(rbox(THREE, lip, 0.14, depth + 0.32, 0.04), { pos: [rr * 2.1 + lip / 2, Hh + 0.04, 0], color: PAL.hazard });
  // bolts
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
    B.add(new THREE.SphereGeometry(0.045, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), { pos: [s * (W / 2 + 0.12), Hh + 0.05, -depth / 2 + (k + 0.5) * (depth / 5)], color: PAL.steel });
  }
  group.add(mesh(THREE, kit.track(B.build()), kit.M.paintedMetal));
  // label on the front (glass side) of the housing
  const r = kit.signs.rects.grinder;
  const lab = mesh(THREE, kit.track(atlasPlane(THREE, 1.4, 1.4 / r.aspect, r.uv)), kit.signs.material, { cast: false });
  lab.position.set(0, Hh * 0.5, depth / 2 + 0.105);
  group.add(lab);
  // rollers: toothed drums along z, counter-rotating
  const RB = builder(THREE, { colors: true });
  RB.add(cylZ(THREE, rr * 0.82, rr * 0.82, depth - 0.1, 14), { color: PAL.steel });
  const ridges = 10;
  for (let k = 0; k < ridges; k++) {
    const a = (k / ridges) * Math.PI * 2;
    RB.add(new THREE.BoxGeometry(rr * 0.32, rr * 0.36, depth - 0.12), { pos: [Math.cos(a) * rr * 0.86, Math.sin(a) * rr * 0.86, 0], rot: [0, 0, a + Math.PI / 4], color: PAL.chrome });
  }
  for (let k = 0; k < 4; k++) RB.add(cylZ(THREE, rr * 1.0, rr * 1.0, 0.05, 14), { pos: [0, 0, -depth / 2 + 0.25 + k * ((depth - 0.5) / 3)], color: PAL.gunmetal });
  const rollerGeo = kit.track(RB.build());
  rollerGeo.userData.shared = true;
  const rollers = [-1, 1].map((s) => {
    const m = mesh(THREE, rollerGeo, kit.M.paintedMetal);
    m.position.set(s * rr * 1.05, Hh - rr * 0.35, 0);
    group.add(m);
    return m;
  });
  // status lamps (amber blink when jammed, mint when chewing) at both ends of the lip
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xf6f2e6, emissive: PAL.amber, emissiveIntensity: 0, roughness: 0.3 });
  const lampGeo = new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(lampGeo, lampMat);
    l.position.set(s * (W / 2 + 0.05), Hh + 0.06, depth / 2 + 0.02);
    group.add(l);
  }
  const amber = new THREE.Color(PAL.amber); const mint = new THREE.Color(0x7fe0c2);
  let t = 0; let wob = 0;
  return {
    group,
    update(v, dt) {
      t += dt;
      const a = v.angle || 0;
      wob = v.clogged ? Math.sin(t * 40) * 0.03 : 0;
      rollers[0].rotation.z = a + wob;
      rollers[1].rotation.z = -a - wob;
      if (v.clogged) { lampMat.emissive.copy(amber); lampMat.emissiveIntensity = Math.sin(t * 12) > 0 ? 2.4 : 0.2; }
      else if (v.chewing || (v.held || 0) > 0) { lampMat.emissive.copy(mint); lampMat.emissiveIntensity = 1.4; }
      else { lampMat.emissive.copy(mint); lampMat.emissiveIntensity = 0.35; }
    },
    dispose() { lampMat.dispose(); lampGeo.dispose(); rollerGeo.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
function buildCrusher(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const W = view.width || 2.6; const P = view.plate || 0.35;
  const z0 = view.z0; const z1 = view.z1; const depth = z1 - z0;
  const [wx, wy] = wallPt(view, view.at, 0);
  group.position.set(wx, wy, (z0 + z1) / 2);
  group.rotation.z = wallRot(view.n);
  // fixed frame around the plate opening (on the wall surface) + warning lamps + label
  const F = builder(THREE, { colors: true });
  F.add(rbox(THREE, W + 0.5, 0.1, 0.22, 0.04), { pos: [0, 0.05, -depth / 2 - 0.14], color: PAL.gunmetal });
  F.add(rbox(THREE, W + 0.5, 0.1, 0.22, 0.04), { pos: [0, 0.05, depth / 2 + 0.14], color: PAL.gunmetal });
  F.add(rbox(THREE, 0.22, 0.1, depth + 0.5, 0.04), { pos: [-W / 2 - 0.14, 0.05, 0], color: PAL.gunmetal });
  F.add(rbox(THREE, 0.22, 0.1, depth + 0.5, 0.04), { pos: [W / 2 + 0.14, 0.05, 0], color: PAL.gunmetal });
  for (const s of [-1, 1]) F.add(rbox(THREE, 0.36, 0.16, 0.36, 0.06), { pos: [s * (W / 2 + 0.14), 0.1, depth / 2 + 0.14], color: PAL.iron });
  group.add(mesh(THREE, kit.track(F.build()), kit.M.paintedMetal));
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: PAL.amber, emissiveIntensity: 0, roughness: 0.25 });
  const lampGeo = new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(lampGeo, lampMat);
    l.position.set(s * (W / 2 + 0.14), 0.18, depth / 2 + 0.14);
    group.add(l);
  }
  const r = kit.signs.rects.crusher;
  const lab = mesh(THREE, kit.track(atlasPlane(THREE, 1.5, 1.5 / r.aspect, r.uv)), kit.signs.material, { cast: false });
  lab.rotation.x = -Math.PI / 2;
  lab.position.set(W / 2 + 1.25, 0.03, 0);
  group.add(lab);
  // moving plate: yellow body, striped face, rivets
  const plate = new THREE.Group();
  const PB = builder(THREE, { colors: true });
  PB.add(rbox(THREE, W, P * 0.75, depth, 0.07), { pos: [0, -P * 0.125, 0], color: PAL.hazard });
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) {
    PB.add(new THREE.SphereGeometry(0.05, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), { pos: [-W / 2 + 0.2 + k * ((W - 0.4) / 5), -P * 0.125, s * (depth / 2)], rot: [s * Math.PI / 2, 0, 0], color: PAL.steelDark });
  }
  plate.add(mesh(THREE, kit.track(PB.build()), kit.M.paintedMetal));
  const face = mesh(THREE, kit.track(scaleUV(rbox(THREE, W + 0.02, P * 0.3, depth + 0.02, 0.05), W / 0.8, depth / 0.8)), kit.stripes);
  face.position.y = P * 0.35;
  plate.add(face);
  const glowMat = new THREE.MeshBasicMaterial({ color: PAL.amber, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(W, depth), glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.y = P * 0.51;
  plate.add(glow);
  group.add(plate);
  // hydraulic rods (scale with extension)
  const rodGeo = new THREE.CylinderGeometry(0.11, 0.11, 1, 12); rodGeo.translate(0, 0.5, 0);
  const sleeveGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.5, 12); sleeveGeo.translate(0, 0.25, 0);
  const rods = [];
  for (const s of [-1, 1]) {
    const rod = mesh(THREE, rodGeo, kit.M.chrome);
    rod.position.set(s * W * 0.28, 0, 0);
    const sl = mesh(THREE, sleeveGeo, kit.M.gunmetal);
    sl.position.set(s * W * 0.28, -P / 2 - 0.5, 0);
    plate.add(sl);
    group.add(rod);
    rods.push({ rod, sl });
  }
  let t = 0;
  return {
    group,
    update(v, dt) {
      t += dt;
      const ext = Math.max(0, v.ext || 0);
      // face of the plate at `ext` from the wall; plate body behind it
      plate.position.y = ext - P / 2;
      for (const { rod, sl } of rods) {
        rod.scale.y = Math.max(0.001, ext - P * 0.5);
        rod.visible = ext > P * 0.55;
        sl.visible = ext > P + 0.1;
      }
      const warn = v.warn || 0;
      const telegraph = v.state === 'telegraph';
      const blink = telegraph ? (Math.sin(t * (8 + warn * 26)) > 0 ? 1 : 0.15) : 0;
      lampMat.emissiveIntensity = telegraph ? 0.4 + 2.6 * blink : (v.state === 'extend' || v.state === 'hold' ? 2.2 : 0.15);
      glowMat.opacity = telegraph ? 0.25 * blink * (0.4 + warn) : 0;
    },
    dispose() { lampMat.dispose(); lampGeo.dispose(); glowMat.dispose(); glow.geometry.dispose(); rodGeo.dispose(); sleeveGeo.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------
function buildPlaceholder(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), kit.stripes);
  group.add(m);
  if (view.x != null) group.position.set(view.x, view.y, 0);
  return { group };
}
