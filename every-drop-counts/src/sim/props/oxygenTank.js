/**
 * Oxygen tank (GDD §6 Props): punctured by a saw / spike / grinder / crusher, a hard impact
 * (> punctureImpact m/s) or a nearby explosion → it ROCKETS along its own axis for ~2 s, then
 * EXPLODES (radial impulse + 'explode' damage that severs limbs; other tanks in range are
 * punctured with a short fuse = chain reaction; safety spheres take `sphereHits` hits).
 *
 * spec: { type: 'oxygenTank', pos: [x,y,z], vel?: [vx,vy,vz], at? (timed level prop) }
 *
 * view (render/audio): {
 *   kind: 'oxygenTank', dyn,            // pose from dyn: x,y,z,qx..qw (+ px..pqw previous) — capsule along local +y
 *   radius, halfLength,
 *   state: 'intact' | 'punctured' | 'exploded',
 *   fuse,                               // s until it explodes (while punctured)
 *   thrust,                             // 0..1 rocket exhaust strength (nozzle at local -y end)
 * }
 * Events: prop:puncture {cause}, prop:explode {radius}, both positional.
 */
import { makeDyn, addVelocity } from '../physics.js';
import { explode } from './explosion.js';

export default {
  type: 'oxygenTank',
  create(ctx, spec) {
    const { R, world, T, rng } = ctx;
    const P = T.props.oxygenTank;
    const [x, y, z] = spec.pos || [0, 0, 0];
    const v = spec.vel || [0, 0, 0];
    const a = rng.range(0, Math.PI * 2);
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z)
      .setRotation({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) })
      .setLinvel(v[0], v[1], v[2]).setLinearDamping(0.05).setAngularDamping(0.6));
    const collider = world.createCollider(R.ColliderDesc.capsule(P.halfLength, P.radius).setMass(P.mass)
      .setFriction(0.45).setRestitution(0.25)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(P.mass * 4 / T.sim.dt), body);
    let state = 'intact';
    let fuse = 0;
    let cause = null;
    const inst = {
      dyns: [],
      view: { kind: 'oxygenTank', dyn: null, radius: P.radius, halfLength: P.halfLength, state, fuse: 0, thrust: 0 },
      get state() { return state; },

      preStep(c2, dt) {
        if (state !== 'punctured') return;
        fuse -= dt;
        inst.view.fuse = Math.max(0, fuse);
        const d = inst.dyns[0];
        if (fuse <= 0) { blowUp(c2); return; }
        // thrust along the tank's local +y (exhaust out of the -y nozzle)
        const ax = 2 * (d.qx * d.qy - d.qw * d.qz);
        const ay = 1 - 2 * (d.qx * d.qx + d.qz * d.qz);
        const az = 2 * (d.qy * d.qz + d.qw * d.qx);
        const th = P.thrust * dt;
        addVelocity(d, ax * th, ay * th, az * th * 0.3);
        const w = P.wobble * dt;
        d.body.applyTorqueImpulse({ x: c2.rng.range(-w, w) * 0.3, y: c2.rng.range(-w, w) * 0.3, z: c2.rng.range(-w, w) }, true);
        inst.view.thrust = 1;
      },

      onHazard(c2, info) { puncture(c2, info.hazard, info.intensity >= 3 ? 0.02 : P.rocketTime); },
      // only a hard hit against the drum / machinery punctures (not bumping other props or donors:
      // otherwise slam-spamming a pile of tanks sets off free chain reactions)
      onContact(c2, other, speed) { if ((other.kind === 'wall' || other.kind === 'hazard') && speed > P.punctureImpact) puncture(c2, 'impact', P.rocketTime); },
      onExplosion(c2) { puncture(c2, 'explosion', P.chainFuse); },
    };
    const dyn = makeDyn('prop', body, collider, { mass: P.mass, radius: P.halfLength + P.radius, thick: P.radius, owner: inst });
    dyn.buoyancy = 1.3;
    dyn.dragScale = 0.6;
    dyn.slamScale = 0.6; // a slam lifts a tank ~2 m: you can't loft them into the machinery blind
    inst.dyns.push(dyn);
    inst.view.dyn = dyn;
    ctx.dyns.push(dyn);
    ctx.owners.set(collider.handle, { kind: 'prop', prop: inst, dyn });

    function puncture(c2, why, time) {
      if (state === 'exploded') return;
      if (state === 'punctured') { fuse = Math.min(fuse, time); return; }
      state = 'punctured';
      cause = why;
      fuse = time;
      inst.view.state = state; inst.view.fuse = fuse;
      c2.emit('prop:puncture', { cause: why, prop: 'oxygenTank' }, [dyn.x, dyn.y, dyn.z]);
    }

    function blowUp(c2) {
      if (state === 'exploded') return;
      state = 'exploded';
      inst.view.state = state; inst.view.thrust = 0;
      const pos = [dyn.x, dyn.y, dyn.z];
      // remove first so the blast does not hit itself
      c2.owners.delete(collider.handle);
      c2.world.removeRigidBody(body);
      dyn.removed = true;
      inst.removed = true;
      c2.removedThisStep = true;
      explode(c2, pos, { radius: P.radius_explosion, damage: P.damage, impulse: P.impulse, sphereHits: P.sphereHits, source: inst, cause });
    }
    return inst;
  },
};
