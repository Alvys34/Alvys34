/**
 * Shared hazard helpers (CONTENT).
 *
 *  - sawCut(): the analytic blade test used by `saw` and `railSaw` (cuts, flings, contact events,
 *    load), against donor parts AND props (tanks puncture, safety spheres crack).
 *  - hitProps(): let props react to a hazard. A prop opts in with
 *      prop.onHazard(ctx, { hazard, intensity, dyn, pos })
 *    and is responsible for its own throttling (a saw reports every step it touches).
 */
import { addVelocity } from '../physics.js';
import { damagePart } from '../donor.js';

/**
 * One step of a spinning blade centred at (cx, cy) covering z0..z1.
 * Returns the number of donor parts touching the blade.
 */
export function sawCut(ctx, inst, { cx, cy, z0, z1, radius, dir, H, dt, hazard = 'saw' }) {
  let touching = 0;
  const reach = radius + H.contactMargin;
  for (const part of ctx.parts) {
    if (part.removed || part.encased) continue;
    if (part.z < z0 - part.thick || part.z > z1 + part.thick) continue;
    const dx = part.x - cx; const dy = part.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > reach + part.thick || dist < 1e-4) continue;
    touching++;
    damagePart(ctx, part, H.dps * dt, 'cut', 'cut');
    // fling tangentially (+ a little outward) — committed at the next force pass
    const tx = (-dy / dist) * dir; const ty = (dx / dist) * dir;
    const ox = dx / dist; const oy = dy / dist;
    const vt = part.vx * tx + part.vy * ty;
    const want = H.fling;
    if (vt < want) {
      const add = Math.min(want - vt, want * 0.35);
      addVelocity(part, tx * add, ty * add);
    }
    const vo = part.vx * ox + part.vy * oy;
    if (vo < 1.5) addVelocity(part, ox * 0.6, oy * 0.6);
    if (inst._contactCd <= 0) {
      inst._contactCd = 0.08;
      ctx.emit('hazard:contact', { hazard, intensity: Math.min(1, 0.4 + touching * 0.2) }, [part.x, part.y, part.z]);
    }
  }
  hitProps(ctx, hazard, (d) => {
    if (d.z < z0 - d.radius || d.z > z1 + d.radius) return 0;
    const dist = Math.hypot(d.x - cx, d.y - cy);
    return dist < reach + d.radius ? 1 : 0;
  });
  return touching;
}

/** Ask every prop dyn `test(dyn) -> intensity (0 = no hit)`; call prop.onHazard on hits. */
export function hitProps(ctx, hazard, test) {
  for (const p of ctx.props) {
    if (p.removed || !p.onHazard) continue;
    for (const d of p.dyns) {
      if (d.removed) continue;
      const k = test(d);
      if (k > 0) p.onHazard(ctx, { hazard, intensity: k, dyn: d, pos: [d.x, d.y, d.z] });
    }
  }
}

/** Smoothstep 0..1. */
export function smooth(t) { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); }
