/**
 * Geometry helpers for code-generated art (ART owns). Everything here builds plain
 * BufferGeometries; merge() bakes many transformed pieces into ONE geometry so static scenery
 * costs one draw call per material.
 */
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { paint } from './palette.js';

const KEEP = new Set(['position', 'normal', 'uv', 'color']);

/**
 * Collects transformed (and optionally vertex-coloured) geometries and merges them.
 *   const b = builder(THREE, { colors: true });
 *   b.add(geo, { pos:[x,y,z], rot:[rx,ry,rz], scale:[sx,sy,sz], color: 0xffffff, shade: 1 });
 *   const merged = b.build();   // null if empty
 */
export function builder(THREE, { colors = false } = {}) {
  const list = [];
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
  const p = new THREE.Vector3(); const s = new THREE.Vector3();
  return {
    get count() { return list.length; },
    add(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], color = 0xffffff, shade = 1, matrix = null } = {}) {
      let g = geo.index ? geo.toNonIndexed() : geo.clone();
      geo.dispose();
      for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (colors) paint(THREE, g, color, shade); else if (g.attributes.color) g.deleteAttribute('color');
      if (matrix) m4.copy(matrix);
      else m4.compose(p.set(pos[0], pos[1], pos[2]), q.setFromEuler(e.set(rot[0], rot[1], rot[2])), s.set(scale[0], scale[1], scale[2]));
      g.applyMatrix4(m4);
      g.morphAttributes = {};
      list.push(g);
      return g;
    },
    build() {
      if (!list.length) return null;
      const out = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      list.length = 0;
      out.computeBoundingSphere();
      return out;
    },
  };
}

export function rbox(THREE, w, h, d, r = 0.05, seg = 2) {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  return new RoundedBoxGeometry(w, h, d, seg, Math.max(1e-3, rr));
}

/** Cylinder whose axis is +z (three's cylinders are along +y). */
export function cylZ(THREE, rTop, rBot, len, seg = 16, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Cylinder along +x. */
export function cylX(THREE, r, len, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** A pipe run through 3D points with rounded elbows (TubeGeometry over a polyline with fillets). */
export function pipe(THREE, pts, r, { bend = 0.6, seg = 10, tubular = 64 } = {}) {
  const path = new THREE.CurvePath();
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  let prev = V(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const cur = V(pts[i]);
    if (i < pts.length - 1) {
      const next = V(pts[i + 1]);
      const d0 = cur.clone().sub(prev); const d1 = next.clone().sub(cur);
      const b = Math.min(bend, d0.length() / 2, d1.length() / 2);
      const a = cur.clone().sub(d0.normalize().multiplyScalar(b));
      const c = cur.clone().add(d1.normalize().multiplyScalar(b));
      path.add(new THREE.LineCurve3(prev, a));
      path.add(new THREE.QuadraticBezierCurve3(a, cur, c));
      prev = c;
    } else {
      path.add(new THREE.LineCurve3(prev, cur));
    }
  }
  return new THREE.TubeGeometry(path, tubular, r, seg, false);
}

/** Flat plane with UVs mapped into an atlas rect [u0,v0,u1,v1] (v up). */
export function atlasPlane(THREE, w, h, rect) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
  }
  return g;
}

/** Subdivided plane with a per-vertex ambient-occlusion colour from fn(u,v) -> 0..1. */
export function aoPlane(THREE, w, h, sx, sy, fn) {
  const g = new THREE.PlaneGeometry(w, h, sx, sy);
  const uv = g.attributes.uv;
  const col = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) {
    const a = fn(uv.getX(i), uv.getY(i));
    col[i * 3] = a; col[i * 3 + 1] = a; col[i * 3 + 2] = a;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Smooth 0..1 occlusion falloff: 0 at the edge, 1 at distance `r` (in the same units). */
export function aoFall(d, r, strength = 0.45) {
  const t = Math.max(0, Math.min(1, d / r));
  const s = t * t * (3 - 2 * t);
  return 1 - strength * (1 - s);
}
