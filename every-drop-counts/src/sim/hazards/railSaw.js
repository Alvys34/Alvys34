/**
 * Rail saw (GDD §7): a saw gang on a carriage that travels back and forth along a wall rail.
 * Lesson: timing. Same cutting rules as the fixed saw (src/sim/hazards/common.js sawCut).
 *
 * spec: { type: 'railSaw', wall, from, to, z: [z0, z1], radius?, offset?, period?, phase?, dir? }
 *   from/to: rail ends (tangent coordinate along the wall, of the blade CENTRE)
 *   period:  s for a full there-and-back sweep (sinusoidal: it lingers at the ends)
 *   phase:   0..1 start position in the cycle (0 = at `from`, 0.5 = at `to`)
 *
 * view (render/audio, drum-local, updated in place every step):
 *   { kind: 'railSaw', wall, n, t, from, to, offset, railA: [x,y], railB: [x,y],
 *     x, y,            // current blade centre
 *     z0, z1, radius, dir, angle, spin,
 *     u,               // 0..1 carriage position along the rail (0 = from, 1 = to)
 *     vel }            // m/s along the rail tangent (+ = toward `to`)
 * load: 0..1 (feeds audioState().sawLoad)
 */
import { wallFrame, wallPoint } from '../physics.js';
import { sawCut } from './common.js';

export default {
  type: 'railSaw',
  create(ctx, spec) {
    const { R, world, T, drum } = ctx;
    const H = { ...T.hazards.saw, ...T.hazards.railSaw };
    const radius = spec.radius ?? H.radius;
    const offset = spec.offset ?? radius * 0.3;
    const f = wallFrame(drum, spec.wall);
    const from = spec.from; const to = spec.to;
    const z0 = spec.z ? spec.z[0] : -drum.hd; const z1 = spec.z ? spec.z[1] : drum.hd;
    const dir = spec.dir ?? 1;
    const period = spec.period ?? H.period;
    const phase = spec.phase ?? 0;
    const at = (u) => wallPoint(drum, spec.wall, from + (to - from) * u, offset);
    const uAt = (time) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (time / period + phase));
    let u = uAt(0);
    let [cx, cy] = at(u);
    const hubR = radius - 0.18;
    const s = Math.SQRT1_2;
    const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, cy, (z0 + z1) / 2));
    const collider = world.createCollider(
      R.ColliderDesc.cylinder((z1 - z0) / 2, hubR).setRotation({ x: s, y: 0, z: 0, w: s }).setFriction(0.2).setRestitution(0.1),
      body,
    );
    const railA = wallPoint(drum, spec.wall, from, offset);
    const railB = wallPoint(drum, spec.wall, to, offset);

    const inst = {
      load: 0,
      _contactCd: 0,
      view: {
        kind: 'railSaw', wall: spec.wall, n: f.n, t: f.t, from, to, offset, railA, railB,
        x: cx, y: cy, z0, z1, radius, dir, angle: 0, spin: H.spin, u, vel: 0,
      },
      colliders: [collider],
      body,

      preStep(c2, dt) {
        const nu = uAt(c2.time + dt);
        const [nx, ny] = at(nu);
        inst.view.vel = ((nu - u) * (to - from)) / dt;
        u = nu; cx = nx; cy = ny;
        body.setNextKinematicTranslation({ x: cx, y: cy, z: (z0 + z1) / 2 });
      },

      postStep(c2, dt) {
        inst._contactCd -= dt;
        const touching = sawCut(c2, inst, { cx, cy, z0, z1, radius, dir, H, dt, hazard: 'saw' });
        const target = Math.min(1, touching / 3);
        inst.load += (target - inst.load) * Math.min(1, dt * (target > inst.load ? 20 : 4));
        const v = inst.view;
        v.x = cx; v.y = cy; v.u = u;
        v.spin = H.spin * (1 - 0.55 * inst.load);
        v.angle += v.spin * dir * dt;
      },

      dispose(c2) { try { c2.world.removeRigidBody(body); } catch { /* world gone */ } },
    };
    ctx.owners.set(collider.handle, { kind: 'hazard', hazard: inst });
    return inst;
  },
};
