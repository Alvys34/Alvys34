/**
 * Hazard visuals (ART owns). Built from each sim hazard's `view` (drum-local, plain data) when a
 * level loads; animated from the same view each frame. Unknown hazard kinds get a placeholder box
 * so CONTENT can add sim hazards before ART draws them.
 *
 * createHazardViews(ctx) -> { onLevel(state), update(dt, state, alpha), dispose() }
 * Builders: register more with `HAZARD_BUILDERS[kind] = (ctx, view, kit) => ({ group, update(view, dt) })`.
 */
import { stripeTexture } from '../environment/textures.js';

export const HAZARD_BUILDERS = {
  spikes: buildSpikes,
  saw: buildSaw,
};

export function createHazardViews(ctx) {
  const { THREE, drumGroup } = ctx;
  const root = new THREE.Group(); root.name = 'hazards';
  drumGroup.add(root);
  const kitDisposables = [];
  const kit = {
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.45, metalness: 0.15 }),
    stripes: new THREE.MeshStandardMaterial({ map: stripeTexture(THREE), roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xd8dee0, roughness: 0.22, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a4142, roughness: 0.5, metalness: 0.5 }),
    bloody: new THREE.MeshStandardMaterial({ color: 0xb00018, roughness: 0.3 }),
  };
  kitDisposables.push(...Object.values(kit), kit.stripes.map);
  let items = [];

  function clear() {
    for (const it of items) {
      root.remove(it.group);
      it.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    items = [];
  }

  return {
    onLevel(state) {
      clear();
      for (const h of state.hazards) {
        const b = HAZARD_BUILDERS[h.view.kind] || buildPlaceholder;
        const it = b(ctx, h.view, kit);
        it.hazard = h;
        root.add(it.group);
        items.push(it);
      }
    },
    update(dt) {
      for (const it of items) if (it.update) it.update(it.hazard.view, dt);
    },
    dispose() { clear(); drumGroup.remove(root); kitDisposables.forEach((d) => d.dispose()); },
  };
}

function wallBasis(view) {
  // returns rotation (about z) that maps local +y to the inward wall normal
  const [nx, ny] = view.n;
  return Math.atan2(-nx, ny);
}

function buildSpikes(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const len = view.to - view.from;
  const depth = view.z1 - view.z0;
  const h = view.height;
  // base strip
  const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, depth), kit.stripes);
  base.position.y = 0.07;
  base.receiveShadow = true; base.castShadow = true;
  group.add(base);
  // cones
  const spacing = 0.42;
  const nx = Math.max(1, Math.floor(len / spacing)); const nz = Math.max(1, Math.floor(depth / spacing));
  const cone = new THREE.ConeGeometry(0.11, h, 8);
  const cones = new THREE.InstancedMesh(cone, kit.steel, nx * nz);
  const m4 = new THREE.Matrix4();
  let i = 0;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      m4.makeTranslation(-len / 2 + (a + 0.5) * (len / nx), 0.14 + h / 2, -depth / 2 + (b + 0.5) * (depth / nz));
      cones.setMatrixAt(i++, m4);
    }
  }
  cones.castShadow = true;
  group.add(cones);
  // position on the wall
  const mid = (view.from + view.to) / 2;
  const [tx, ty] = view.t; const [nx2, ny2] = view.n;
  const plane = { floor: -5, ceiling: 5, left: -8, right: 8 }[view.wall];
  const px = nx2 !== 0 ? plane : mid * tx;
  const py = nx2 !== 0 ? mid * ty : plane;
  group.position.set(px, py, (view.z0 + view.z1) / 2);
  group.rotation.z = wallBasis(view);
  // (the strip is symmetric about its centre, so the tangent direction after rotation is irrelevant)
  return { group };
}

function buildSaw(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  group.position.set(view.x, view.y, 0);
  const spin = new THREE.Group();
  group.add(spin);
  const depth = view.z1 - view.z0;
  const n = Math.max(2, Math.round(depth / 0.45));
  const blade = sawBladeGeometry(THREE, view.radius, 28);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(blade, kit.steel);
    m.position.z = view.z0 + (i + 0.5) * (depth / n);
    m.castShadow = true;
    spin.add(m);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(view.radius * 0.35, view.radius * 0.35, depth, 20), kit.stripes);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = (view.z0 + view.z1) / 2;
  spin.add(hub);
  // mount bracket to the wall
  const plane = { floor: -5, ceiling: 5, left: -8, right: 8 }[view.wall];
  const [nx, ny] = view.n;
  const dist = nx !== 0 ? Math.abs(plane - view.x) : Math.abs(plane - view.y);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, dist + 0.2, depth * 0.9), kit.yellow);
  arm.position.set(-nx * (dist / 2), -ny * (dist / 2), (view.z0 + view.z1) / 2);
  arm.rotation.z = Math.atan2(-nx, ny);
  arm.castShadow = true;
  group.add(arm);
  return {
    group,
    update(v) { spin.rotation.z = v.angle; },
  };
}

function sawBladeGeometry(THREE, R, teeth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.6) / teeth) * Math.PI * 2;
    const r0 = R * 0.9;
    if (i === 0) shape.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
    else shape.lineTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
    shape.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, R * 0.12, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -0.025);
  return g;
}

function buildPlaceholder(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), kit.stripes);
  group.add(m);
  if (view.x != null) group.position.set(view.x, view.y, 0);
  return { group };
}
