/**
 * The blood pool (GDD §8): fill -> liquid AREA of the drum cross-section; the surface is level in
 * the WORLD, so we solve the surface height for that area in the rotated rectangle every step.
 *
 * ctx.pool = {
 *   volume,        // L currently in the tank (shift mode: = collected; overtime: minus drain)
 *   capacity,      // L that would fill the whole cross-section (level data)
 *   fill,          // 0..maxFill = volume / capacity
 *   level, prevLevel   // surface height in WORLD y relative to drum centre (render interpolates)
 *   area           // liquid area (m^2) of the cross-section
 *   depth          // m from the lowest point of the drum up to the surface (drowning gate)
 *   curve          // shift mode: fill curve { k, fullLiters, maxFill, fill(L) } or null (linear)
 * }
 * Per dyn it maintains `sub` (0..1 submerged fraction, sphere approximation) used by
 * applyFrameForces (buoyancy/drag), drowning (donor.js) and dissolve (here).
 */
import { solveLevel, heightRange } from './geom.js';
import { removePart } from './donor.js';

export function createPoolState(capacity) {
  return { volume: 0, capacity, fill: 0, level: -999, prevLevel: -999, area: 0, depth: 0, curve: null };
}

/**
 * SHIFT FILL CURVE (fix round 2, PLAYTEST-1 M2): in shift mode the tide must move for the whole
 * shift. fill = maxFill * g(L / fullLiters), g(x) = (1 - e^(-k x)) / (1 - e^(-k)) (monotone,
 * concave, finite slope at 0), saturating at maxFill once `fullLiters` are collected.
 *   fullLiters = fullAt × q3        (default 1.15 × the 3-drop quota)
 *   k solved so that fill(q1) = atQ1 (default 0.38: a game-changing depth at the 1-drop quota)
 * Defaults: T.pool.curve. Per-level override: level.fillCurve = { atQ1?, fullAt?, fullLiters?, k? }
 * or level.fillCurve = false (legacy linear model: fill = volume / capacity).
 * Returns null for the linear model. Overtime never uses a curve (real tank volume).
 */
export function makeFillCurve(level, T) {
  const spec = level.fillCurve;
  if (spec === false || !level.quota) return null;
  const C = { ...(T.pool.curve || {}), ...(spec && typeof spec === 'object' ? spec : {}) };
  const maxFill = T.pool.maxFill;
  const q1 = level.quota[0]; const q3 = level.quota[2];
  const fullLiters = C.fullLiters ?? (C.fullAt ?? 1.15) * q3;
  if (!(fullLiters > 0) || !Number.isFinite(fullLiters)) return null;
  let k = C.k;
  if (k == null) {
    const x1 = Math.max(1e-3, Math.min(1, q1 / fullLiters));
    const r = Math.max(0, Math.min(1, (C.atQ1 ?? 0.38) / maxFill));
    const g = (kk, x) => (kk < 1e-6 ? x : (1 - Math.exp(-kk * x)) / (1 - Math.exp(-kk)));
    if (g(1e-6, x1) >= r) k = 0; // linear already reaches the target depth at q1
    else { // g(k, x1) rises with k: bisect
      let lo = 0; let hi = 40;
      for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (g(m, x1) < r) lo = m; else hi = m; }
      k = hi;
    }
  }
  const norm = k < 1e-6 ? 1 : 1 - Math.exp(-k);
  return {
    k, fullLiters, maxFill,
    fill(liters) {
      const x = Math.max(0, Math.min(1, liters / fullLiters));
      return maxFill * (k < 1e-6 ? x : (1 - Math.exp(-k * x)) / norm);
    },
  };
}

export function stepPool(ctx, dt) {
  const { T, drum, pool } = ctx;
  const P = T.pool;
  pool.fill = Math.max(0, Math.min(P.maxFill, pool.curve ? pool.curve.fill(pool.volume) : pool.volume / pool.capacity));
  pool.area = pool.fill * 4 * drum.hw * drum.hh;
  pool.prevLevel = pool.level;
  pool.level = pool.fill > 0 ? solveLevel(drum.theta, drum.hw, drum.hh, pool.area) : -heightRange(drum.theta, drum.hw, drum.hh) - 0.01;
  if (pool.prevLevel < -900) pool.prevLevel = pool.level;
  // depth of the deepest point (m): drowning only happens once the pool is deep (donor.js)
  pool.depth = pool.fill > 0 ? Math.max(0, pool.level + heightRange(drum.theta, drum.hw, drum.hh)) : 0;

  const s = pool.level;
  const ux = drum.ux; const uy = drum.uy;
  const hasPool = pool.fill > 0.0005;
  for (const d of ctx.dyns) {
    if (d.removed) continue;
    d.prevSub = d.sub;
    if (!hasPool || d.encased) { d.sub = 0; d.subTime = 0; continue; }
    const wy = ux * d.x + uy * d.y; // world height of the centre
    const r = Math.max(0.08, d.thick * 1.4);
    const depth = s - wy;
    const sub = Math.max(0, Math.min(1, (depth + r) / (2 * r)));
    d.sub = sub;
    if (sub > 0.5) d.subTime += dt; else d.subTime = 0;
    // splash when crossing the surface downward fast
    if (d.prevSub < 0.25 && sub >= 0.25) {
      const vDown = -(ux * d.vx + uy * d.vy);
      const vPrevDown = -(ux * d.pvx + uy * d.pvy);
      const speed = Math.max(vDown, vPrevDown);
      if (speed > P.splashMinSpeed && ctx.splashBudget > 0) {
        ctx.splashBudget--;
        ctx.emit('splash', { size: Math.min(1, (speed * d.mass) / 120) }, [d.x, d.y, d.z]);
      }
    }
  }

  // dissolve drained submerged parts (and long-submerged corpses, for performance)
  for (const part of ctx.parts) {
    if (part.removed) continue;
    const donor = part.donor;
    if (donor.alive && !part.severed) continue;
    const drained = part.blood <= 1e-3;
    if ((drained && part.subTime > P.dissolveDrainedAfter) || (!donor.alive && part.subTime > P.dissolveCorpseAfter)) {
      removePart(ctx, part, { release: false });
      ctx.emit('part:dissolve', { id: donor.id, part: part.name }, [part.x, part.y, part.z]);
    }
  }
}
