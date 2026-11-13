/**
 * Pool liquid view (VFX owns). Baseline: a translucent prism = the sim's liquid polygon
 * (rotated-rectangle clip, src/sim/geom.js liquidPolygon) extruded through the drum depth, placed in
 * the drum group so its top face stays level in the world, plus a glossy surface sheet.
 *
 * createPoolView(ctx) -> { update(dt, state, alpha), dispose() }
 * Reads: state.pool.level/prevLevel (world height rel. drum centre), state.pool.fill, ctx.drumAngle.
 */
import { liquidPolygon } from '../../sim/geom.js';

const MAX_TRIS = 48;

export function createPoolView(ctx) {
  const { THREE, drumGroup } = ctx;
  const HD = 2.5 - 0.02;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_TRIS * 9);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9a0010, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.86,
    emissive: 0x2a0004, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  drumGroup.add(mesh);

  const surfGeo = new THREE.PlaneGeometry(1, 1);
  const surfMat = new THREE.MeshStandardMaterial({ color: 0xd0142a, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.9, emissive: 0x3a0006, side: THREE.DoubleSide, depthWrite: false });
  const surf = new THREE.Mesh(surfGeo, surfMat);
  surf.renderOrder = 6;
  drumGroup.add(surf);

  let n = 0;
  const tri = (a, b, c) => {
    if (n >= MAX_TRIS) return;
    pos.set(a, n * 9); pos.set(b, n * 9 + 3); pos.set(c, n * 9 + 6);
    n++;
  };

  return {
    update(dt, state, alpha) {
      const P = state.pool;
      if (!P || P.fill <= 0.0005) { mesh.visible = false; surf.visible = false; return; }
      mesh.visible = true;
      const level = P.prevLevel + (P.level - P.prevLevel) * alpha;
      const theta = ctx.drumAngle;
      const poly = liquidPolygon(theta, 8, 5, level);
      n = 0;
      if (poly.length >= 3) {
        for (let i = 1; i < poly.length - 1; i++) {
          tri([poly[0][0], poly[0][1], HD], [poly[i][0], poly[i][1], HD], [poly[i + 1][0], poly[i + 1][1], HD]);
          tri([poly[0][0], poly[0][1], -HD], [poly[i + 1][0], poly[i + 1][1], -HD], [poly[i][0], poly[i][1], -HD]);
        }
      }
      // surface edge: the polygon edge whose endpoints are both on the level line
      const ux = Math.sin(theta); const uy = Math.cos(theta);
      let sa = null; let sb = null;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]; const b = poly[(i + 1) % poly.length];
        const da = Math.abs(ux * a[0] + uy * a[1] - level); const db = Math.abs(ux * b[0] + uy * b[1] - level);
        if (da < 1e-3 && db < 1e-3) { sa = a; sb = b; }
      }
      geo.setDrawRange(0, n * 3);
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
      if (sa && sb) {
        surf.visible = true;
        const len = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
        surf.position.set((sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2, 0);
        // plane: local x along the edge, local y along depth (z) => rotate so normal = world up
        surf.rotation.set(0, 0, 0);
        surf.rotation.z = Math.atan2(sb[1] - sa[1], sb[0] - sa[0]);
        surf.rotateX(-Math.PI / 2);
        surf.scale.set(len, HD * 2, 1);
      } else {
        surf.visible = false;
      }
    },
    dispose() {
      drumGroup.remove(mesh); drumGroup.remove(surf);
      geo.dispose(); mat.dispose(); surfGeo.dispose(); surfMat.dispose();
    },
  };
}
