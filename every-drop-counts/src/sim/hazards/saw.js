/**
 * Saw (GDD §7): a spinning gang of discs mounted on a wall, covering PART of the depth.
 * Cuts the part it touches (cut damage -> sever), flings parts tangentially, slows under load.
 *
 * spec: { type: 'saw', wall, at, z: [z0, z1], radius?, offset?, dir?: 1|-1 }
 *   at: tangent coordinate along the wall; offset: centre distance from the wall surface (m)
 *   dir: +1 spins counter-clockwise (in drum-local view), -1 clockwise
 *
 * view: { kind: 'saw', wall, x, y, z0, z1, radius, dir, angle, spin, n }
 */
import { wallFrame, wallPoint } from '../physics.js';
import { sawCut } from './common.js';

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

    const inst = {
      load: 0,
      _contactCd: 0,
      view: { kind: 'saw', wall: spec.wall, x: cx, y: cy, z0, z1, radius, dir, angle: 0, spin: H.spin, n: f.n },
      colliders: [collider],

      postStep(c2, dt) {
        inst._contactCd -= dt;
        const touching = sawCut(c2, inst, { cx, cy, z0, z1, radius, dir, H, dt, hazard: 'saw' });
        const target = Math.min(1, touching / 3);
        inst.load += (target - inst.load) * Math.min(1, dt * (target > inst.load ? 20 : 4));
        inst.view.spin = H.spin * (1 - 0.55 * inst.load);
        inst.view.angle += inst.view.spin * dir * dt;
      },
    };
    ctx.owners.set(collider.handle, { kind: 'hazard', hazard: inst });
    return inst;
  },
};
