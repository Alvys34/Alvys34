/**
 * Shared explosion: radial impulse + 'explode' damage (severs zeroed limbs) with linear falloff.
 * Props in range get `onExplosion(ctx, k, pos)` FIRST (spheres crack/shatter, tanks chain), so an
 * Inspector whose sphere shatters in the blast is then caught by it as a bare ragdoll.
 */
import { addVelocity } from '../physics.js';
import { damagePart } from '../donor.js';

export function explode(ctx, pos, { radius, damage, impulse, sphereHits = 2, source = null } = {}) {
  const [x, y, z] = pos;
  const R2 = radius * radius;
  for (const p of ctx.props.slice()) {
    if (p === source || p.removed || !p.onExplosion) continue;
    let best = 0;
    for (const d of p.dyns) {
      if (d.removed) continue;
      const dd = (d.x - x) ** 2 + (d.y - y) ** 2 + (d.z - z) ** 2;
      if (dd < (radius + d.radius) ** 2) best = Math.max(best, 1 - Math.sqrt(dd) / (radius + d.radius));
    }
    if (best > 0) p.onExplosion(ctx, best, pos, sphereHits);
  }
  const ux = ctx.drum.ux; const uy = ctx.drum.uy;
  let hit = 0;
  for (const part of ctx.parts) {
    if (part.removed || part.encased) continue;
    const dx = part.x - x; const dy = part.y - y; const dz = part.z - z;
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd > R2) continue;
    const dist = Math.sqrt(dd) || 1e-3;
    const k = 1 - dist / radius;
    const imp = impulse * k;
    addVelocity(part, (dx / dist) * imp + ux * imp * 0.35, (dy / dist) * imp + uy * imp * 0.35, (dz / dist) * imp * 0.5);
    damagePart(ctx, part, damage * k * (part.role === 'head' ? 1.2 : 1), 'explode', 'explode');
    hit++;
  }
  // loose props (tanks not yet punctured are handled above) still get shoved
  for (const p of ctx.props) {
    if (p.removed) continue;
    for (const d of p.dyns) {
      if (d.removed) continue;
      const dx = d.x - x; const dy = d.y - y; const dz = d.z - z;
      const dist = Math.hypot(dx, dy, dz) || 1e-3;
      if (dist > radius) continue;
      const imp = impulse * (1 - dist / radius) * 0.8;
      addVelocity(d, (dx / dist) * imp, (dy / dist) * imp, (dz / dist) * imp * 0.5);
    }
  }
  ctx.intensity = Math.min(1, (ctx.intensity || 0) + 0.5);
  ctx.emit('prop:explode', { radius, hits: hit }, pos);
}
