/**
 * Runners (VFX): blobs of blood that crawl along a drum surface under the CURRENT gravity (+
 * centrifugal) projected onto that surface, leaving streak stamps in the blood atlas. Because the
 * drum keeps turning, the streaks curve: the rotation history is written on the back wall and the
 * glass. On a surface that now faces down (gravity pulls away from it) a runner lets go and becomes
 * a falling droplet (ceiling drips). Stick-slip + a little meander make the trails read as liquid.
 *
 *   const runners = createRunners(atlas, dims, cap);
 *   runners.spawn(surf, a, b, vol);          // plane coords in metres (see atlas.js), vol ~0.1..1
 *   runners.update(dt, env, onDrip)          // onDrip(surf, a, b, vol)
 */
import { SURF } from './atlas.js';

export function createRunners(atlas, { HW, HH, HD }, cap) {
  const surf = new Uint8Array(cap);
  const A = new Float32Array(cap); const B = new Float32Array(cap);
  const LA = new Float32Array(cap); const LB = new Float32Array(cap);
  const vol = new Float32Array(cap); const sd = new Float32Array(cap); const age = new Float32Array(cap);
  const stall = new Float32Array(cap);
  let count = 0;
  let limit = cap;
  let rs = 99991;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  const REG = atlas.REG;

  function spawn(s, a, b, v) {
    if (count >= limit) return -1;
    if (s === SURF.GLASS && atlas.glassLoad > 0.9) return -1;
    const i = count++;
    surf[i] = s; A[i] = a; B[i] = b; LA[i] = a; LB[i] = b; vol[i] = Math.min(1.4, v); sd[i] = rnd(); age[i] = 0; stall[i] = 0;
    return i;
  }

  function kill(i) {
    const j = --count;
    if (i !== j) {
      surf[i] = surf[j]; A[i] = A[j]; B[i] = B[j]; LA[i] = LA[j]; LB[i] = LB[j];
      vol[i] = vol[j]; sd[i] = sd[j]; age[i] = age[j]; stall[i] = stall[j];
    }
  }

  const width = (v) => 0.022 + 0.05 * Math.sqrt(v);

  /** env: { g, ux, uy, w2, t } */
  function update(dt, env, onDrip) {
    const { g, ux, uy, w2, t } = env;
    let i = 0;
    while (i < count) {
      const s = surf[i]; let a = A[i]; let b = B[i];
      age[i] += dt;
      // drum-local position of the runner and the effective gravity there
      let x; let y;
      if (s <= 1) { x = a - HW; y = b - HH; } else if (s <= 3) { x = a - HW; y = s === SURF.FLOOR ? -HH : HH; } else { x = s === SURF.LEFT ? -HW : HW; y = a - HH; }
      const gx = -g * ux + w2 * x; const gy = -g * uy + w2 * y;
      let ga; let gb = 0; let gn = 0;
      if (s <= 1) { ga = gx; gb = gy; } else if (s === SURF.FLOOR) { ga = gx; gn = gy; } else if (s === SURF.CEIL) { ga = gx; gn = -gy; } else if (s === SURF.LEFT) { ga = gy; gn = gx; } else { ga = gy; gn = -gx; }
      const gm = Math.hypot(gx, gy) + 1e-6;
      if (gn > 0.4 * gm && vol[i] > 0.06) {
        // the surface faces down now: let go
        onDrip(s, a, b, vol[i]);
        kill(i); continue;
      }
      const gt = Math.hypot(ga, gb);
      const v = vol[i];
      const w = width(v);
      if (gt < 0.18 * gm) {
        // nothing pulls it along: it just sits and slowly soaks in
        vol[i] -= dt * 0.08;
      } else {
        // stick-slip crawl with meander
        const slip = 0.5 + 0.5 * Math.sin(t * (2.2 + sd[i] * 2.0) + sd[i] * 31.0);
        const go = slip > 0.35 ? 1 : 0.15;
        const sp = Math.min(1.7, 0.22 + v * 1.4) * (gt / gm) * go;
        const wob = 0.32 * Math.sin(t * 1.7 + sd[i] * 17.0) + 0.18 * Math.sin(t * 4.1 + sd[i] * 5.0);
        const da0 = ga / gt; const db0 = gb / gt;
        const cw = Math.cos(wob); const sw = Math.sin(wob);
        const da = da0 * cw - db0 * sw; const db = da0 * sw + db0 * cw;
        a += da * sp * dt; b += db * sp * dt;
        vol[i] -= sp * dt * (0.26 + w * 2.0);
        // lay down a streak segment once it moved about a width
        const sa = a - LA[i]; const sb = b - LB[i];
        const sl = Math.hypot(sa, sb);
        if (sl > w * 0.8) {
          atlas.stamp(s, (a + LA[i]) * 0.5, (b + LB[i]) * 0.5, sa / sl, sb / sl, sl * 0.5 + w * 0.5, w, 0.95, 1, 1, sd[i]);
          LA[i] = a; LB[i] = b;
        }
      }
      const r = REG[s];
      const out = a < 0.02 || b < 0.02 || a > r[2] - 0.02 || b > r[3] - 0.02;
      if (vol[i] <= 0.035 || out || age[i] > 14) {
        // final bead where it stopped
        if (!out) atlas.stamp(s, a, b, 1, 0, w * 1.5, w * 1.5, 1.4, 4, 1, sd[i]);
        kill(i); continue;
      }
      A[i] = a; B[i] = b;
      i++;
    }
  }

  return {
    spawn, update,
    clear() { count = 0; },
    setLimit(n) { limit = Math.max(8, Math.min(cap, n | 0)); if (count > limit) count = limit; },
    get count() { return count; },
  };
}
