/**
 * Pure 2D geometry helpers for the drum cross-section (headless, no deps).
 *
 * Drum-local frame: origin at drum centre, +x right, +y up when drum angle theta = 0.
 * World = R(theta) * local. World "up" expressed in drum-local coords is u = (sin θ, cos θ),
 * so the WORLD height of a drum-local point p is simply dot(u, p).
 */

/** World-up direction in drum-local coordinates. */
export function upLocal(theta) { return [Math.sin(theta), Math.cos(theta)]; }

/** Drum-local (x,y) -> world (x,y). */
export function localToWorld(theta, x, y) {
  const c = Math.cos(theta); const s = Math.sin(theta);
  return [c * x - s * y, s * x + c * y];
}

/** World (x,y) -> drum-local (x,y). */
export function worldToLocal(theta, x, y) {
  const c = Math.cos(theta); const s = Math.sin(theta);
  return [c * x + s * y, -s * x + c * y];
}

/** Rectangle polygon (CCW) for half-extents hw, hh. */
export function rectPolygon(hw, hh) {
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
}

/**
 * Clip a convex polygon by the half-plane dot(n, p) <= s (Sutherland–Hodgman, one plane).
 * @returns {number[][]} clipped polygon (may be empty)
 */
export function clipHalfPlane(poly, nx, ny, s) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]; const b = poly[(i + 1) % n];
    const da = nx * a[0] + ny * a[1] - s;
    const db = nx * b[0] + ny * b[1] - s;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]; const q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) * 0.5;
}

/** Area of the rectangle (hw, hh) below world height s when the drum is at angle theta. */
export function areaBelow(theta, hw, hh, s) {
  const [ux, uy] = upLocal(theta);
  return polygonArea(clipHalfPlane(rectPolygon(hw, hh), ux, uy, s));
}

/** Range of world heights spanned by the rotated rectangle: [-m, m]. */
export function heightRange(theta, hw, hh) {
  const [ux, uy] = upLocal(theta);
  return Math.abs(ux) * hw + Math.abs(uy) * hh;
}

/**
 * Solve the level surface height s (world y, relative to drum centre) such that the liquid
 * area inside the rotated rectangle equals `area`. Monotone -> bisection (robust, ~40 iters).
 */
export function solveLevel(theta, hw, hh, area) {
  const m = heightRange(theta, hw, hh);
  const total = 4 * hw * hh;
  if (area <= 0) return -m;
  if (area >= total) return m;
  let lo = -m; let hi = m;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (areaBelow(theta, hw, hh, mid) < area) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Liquid polygon in drum-local coordinates (for rendering). */
export function liquidPolygon(theta, hw, hh, s) {
  const [ux, uy] = upLocal(theta);
  return clipHalfPlane(rectPolygon(hw, hh), ux, uy, s);
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Quaternion helpers on plain {x,y,z,w}. */
export function quatRotate(q, vx, vy, vz) {
  // v' = q * v * q^-1
  const { x, y, z, w } = q;
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

export function quatFromAxisAngle(ax, ay, az, angle) {
  const h = angle * 0.5; const s = Math.sin(h);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) };
}
