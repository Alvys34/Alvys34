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
 * }
 * Per dyn it maintains `sub` (0..1 submerged fraction, sphere approximation) used by
 * applyFrameForces (buoyancy/drag), drowning (donor.js) and dissolve (here).
 */
import { solveLevel, heightRange } from './geom.js';
import { removePart } from './donor.js';

export function createPoolState(capacity) {
  return { volume: 0, capacity, fill: 0, level: -999, prevLevel: -999, area: 0 };
}

export function stepPool(ctx, dt) {
  const { T, drum, pool } = ctx;
  const P = T.pool;
  pool.fill = Math.max(0, Math.min(P.maxFill, pool.volume / pool.capacity));
  pool.area = pool.fill * 4 * drum.hw * drum.hh;
  pool.prevLevel = pool.level;
  pool.level = pool.fill > 0 ? solveLevel(drum.theta, drum.hw, drum.hh, pool.area) : -heightRange(drum.theta, drum.hw, drum.hh) - 0.01;
  if (pool.prevLevel < -900) pool.prevLevel = pool.level;

  const s = pool.level;
  const ux = drum.ux; const uy = drum.uy;
  const hasPool = pool.fill > 0.0005;
  for (const d of ctx.dyns) {
    if (d.removed) continue;
    d.prevSub = d.sub;
    if (!hasPool) { d.sub = 0; d.subTime = 0; continue; }
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
