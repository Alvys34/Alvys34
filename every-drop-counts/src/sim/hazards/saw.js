/**
 * Saw (GDD §7): a spinning gang of discs mounted on a wall, covering PART of the depth.
 * Cuts the part it touches (cut damage -> sever), flings parts tangentially, slows under load.
 *
 * spec: { type: 'saw', wall, at, z: [z0, z1], radius?, offset?, dir?: 1|-1 }
 *   at: tangent coordinate along the wall; offset: centre distance from the wall surface (m)
 *   dir: +1 spins counter-clockwise (in drum-local view), -1 clockwise
 */
import { wallFrame, wallPoint } from '../physics.js';
import { damagePart } from '../donor.js';

export default {
  type: 'saw',
  create(ctx, spec) {
    const { R, world, T, drum } = ctx;
    const H = T.hazards.saw;
    const radius = spec.radius ?? H.radius;
    const offset = spec.offset ?? radius * 0.25;
    const f = wallFrame(drum, spec.wall);
    const [cx, cy] = wallPoint(drum, spec.wall, spec.at, offset);
    const z0 = spec.z ? spec.z[0] : -drum.hd; const z1 = spec.z ? spec.z[1] : drum.hd;
    const dir = spec.dir ?? 1;
    // solid hub slightly smaller than the cutting radius, so parts reach the teeth
    const hubR = radius - 0.18;
    const s = Math.SQRT1_2;
    const collider = world.createCollider(
      R.ColliderDesc.cylinder((z1 - z0) / 2, hubR).setTranslation(cx, cy, (z0 + z1) / 2)
        .setRotation({ x: s, y: 0, z: 0, w: s }).setFriction(0.2).setRestitution(0.1),
      ctx.drumBody,
    );
    let contactCooldown = 0;
    let busy = 0;

    const inst = {
      load: 0,
      view: { kind: 'saw', wall: spec.wall, x: cx, y: cy, z0, z1, radius, dir, angle: 0, spin: H.spin, n: f.n },
      colliders: [collider],

      postStep(c2, dt) {
        contactCooldown -= dt;
        let touching = 0;
        const reach = radius + H.contactMargin;
        for (const part of c2.parts) {
          if (part.removed) continue;
          if (part.z < z0 - part.thick || part.z > z1 + part.thick) continue;
          const dx = part.x - cx; const dy = part.y - cy;
          const dist = Math.hypot(dx, dy);
          if (dist > reach + part.thick || dist < 1e-4) continue;
          touching++;
          damagePart(c2, part, H.dps * dt, 'cut', 'cut');
          // fling tangentially (+ a little outward) — committed at the next force pass
          const tx = (-dy / dist) * dir; const ty = (dx / dist) * dir;
          const ox = dx / dist; const oy = dy / dist;
          const vt = part.vx * tx + part.vy * ty;
          const want = H.fling;
          if (vt < want) {
            const add = Math.min(want - vt, want * 0.35);
            part.vx += tx * add; part.vy += ty * add;
          }
          const vo = part.vx * ox + part.vy * oy;
          if (vo < 1.5) { part.vx += ox * 0.6; part.vy += oy * 0.6; }
          if (contactCooldown <= 0) {
            contactCooldown = 0.08;
            c2.emit('hazard:contact', { hazard: 'saw', intensity: Math.min(1, 0.4 + touching * 0.2) }, [part.x, part.y, part.z]);
          }
        }
        busy = touching;
        const target = Math.min(1, busy / 3);
        inst.load += (target - inst.load) * Math.min(1, dt * (target > inst.load ? 20 : 4));
        inst.view.spin = H.spin * (1 - 0.55 * inst.load);
        inst.view.angle += inst.view.spin * dir * dt;
      },
    };
    ctx.owners.set(collider.handle, { kind: 'hazard', hazard: inst });
    return inst;
  },
};
