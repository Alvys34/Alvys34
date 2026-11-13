/**
 * Personal safety sphere (GDD §6 Inspector): a transparent ball that holds an Inspector.
 * While he is inside, his ragdoll bodies are DISABLED (part.encased = true, donor.encased = true)
 * and posed every step standing upright in the middle of the ball, so hazards cannot touch him.
 * The sphere rolls (he "walks" it), floats high in the pool, and takes HITS from hazards
 * (saw/spike/grinder/crusher contact, explosions, very hard impacts). After `hits` hits it SHATTERS:
 * the ball is removed and the Inspector becomes an ordinary (very killable) ragdoll.
 *
 * spec: { type: 'safetySphere', donor, pos: [x,y,z], vel? }   (created by the Inspector's onSpawn)
 *
 * view (render): {
 *   kind: 'safetySphere', dyn,     // pose from dyn (x..qw / px..pqw); ball of `radius`
 *   radius, hits, maxHits,
 *   cracks,                        // 0..1 = hits / maxHits (draw crack decals)
 *   shattered,                     // true once broken (the prop is then removed)
 *   donorId,
 * }
 * Events: sphere:crack {hits, maxHits, cause}, sphere:shatter {cause} (positional).
 */
import { makeDyn, addVelocity } from '../physics.js';

const UP_OFFSET = 0.92; // donor-plan height of the body's middle (feet at 0, head top ~1.83)

export default {
  type: 'safetySphere',
  create(ctx, spec) {
    const { R, world, T, rng } = ctx;
    const P = T.props.safetySphere;
    const donor = spec.donor;
    const [x, y, z] = spec.pos || [0, 0, 0];
    const v = spec.vel || [0, 0, 0];
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, Math.max(-1.3, Math.min(1.3, z)))
      .setLinvel(v[0], v[1], v[2]).setLinearDamping(0.05).setAngularDamping(0.3));
    const collider = world.createCollider(R.ColliderDesc.ball(P.radius).setMass(P.mass)
      .setFriction(P.friction).setRestitution(P.restitution)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(P.mass * 4 / T.sim.dt), body);
    let hits = 0; let cooldown = 0; let shattered = false;
    let walkDir = rng.sign(); let walkTimer = rng.range(3, 7); let stuck = 0;
    const inst = {
      dyns: [],
      donor,
      view: { kind: 'safetySphere', dyn: null, radius: P.radius, hits: 0, maxHits: P.hits, cracks: 0, shattered: false, donorId: donor ? donor.id : null },

      preStep(c2, dt) {
        cooldown -= dt;
        if (!donor || !donor.alive) return;
        // the Inspector walks his ball along world-horizontal (in drum-local coords)
        const d = inst.dyns[0];
        walkTimer -= dt;
        if (walkTimer <= 0) { walkTimer = c2.rng.range(3, 8); walkDir = -walkDir; }
        const rx = c2.drum.uy; const ry = -c2.drum.ux; // world-right in drum-local
        const vAlong = d.vx * rx + d.vy * ry;
        const want = walkDir * P.walkSpeed;
        if (Math.abs(vAlong) < 0.3) { stuck += dt; if (stuck > 1.2) { walkDir = -walkDir; stuck = 0; } } else stuck = 0;
        const dv = Math.max(-1, Math.min(1, want - vAlong)) * 3.0 * dt;
        if (d.sub < 0.9) addVelocity(d, rx * dv, ry * dv, -d.z * 0.4 * dt);
      },

      postStep() {
        if (!donor || shattered) return;
        poseInside(ctx, donor, inst.dyns[0]);
      },

      onHazard(c2, info) { hit(c2, info.hazard, info.intensity >= 3 ? 3 : 1); },
      onContact(c2, other, speed) { if (speed > P.impactCrack) hit(c2, 'impact', 1); },
      onExplosion(c2, k, pos, n = 2) { cooldown = 0; hit(c2, 'explosion', n); },
    };
    const dyn = makeDyn('prop', body, collider, { mass: P.mass, radius: P.radius, thick: P.radius, owner: inst });
    dyn.buoyancy = P.buoyancy;
    dyn.slamScale = P.slamScale ?? 0.35; // heavy: a slam barely lifts it (slam = the safe tool near him)
    inst.dyns.push(dyn);
    inst.view.dyn = dyn;
    ctx.dyns.push(dyn);
    ctx.owners.set(collider.handle, { kind: 'prop', prop: inst, dyn });
    if (donor) {
      donor.encased = true;
      donor.sphere = inst;
      for (const p of donor.partList) { p.encased = true; p.body.setEnabled(false); }
      poseInside(ctx, donor, dyn, true);
    }

    function hit(c2, cause, n) {
      if (shattered || cooldown > 0) return;
      cooldown = P.hitCooldown;
      hits = Math.min(P.hits, hits + n);
      inst.view.hits = hits; inst.view.cracks = hits / P.hits;
      if (hits >= P.hits) shatter(c2, cause);
      else c2.emit('sphere:crack', { hits, maxHits: P.hits, cause, donorId: inst.view.donorId }, [dyn.x, dyn.y, dyn.z]);
    }

    function shatter(c2, cause) {
      shattered = true;
      inst.view.shattered = true;
      const vx = dyn.vx; const vy = dyn.vy; const vz = dyn.vz;
      c2.emit('sphere:shatter', { cause, donorId: inst.view.donorId }, [dyn.x, dyn.y, dyn.z]);
      c2.owners.delete(collider.handle);
      c2.world.removeRigidBody(body);
      dyn.removed = true;
      inst.removed = true;
      c2.removedThisStep = true;
      if (donor) {
        donor.encased = false;
        donor.sphere = null;
        for (const p of donor.partList) {
          if (p.removed) continue;
          p.encased = false;
          p.body.setTranslation({ x: p.x, y: p.y, z: p.z }, false);
          p.body.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, false);
          p.body.setLinvel({ x: vx, y: vy, z: vz }, false);
          p.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
          p.body.setEnabled(true);
          p.vx = vx; p.vy = vy; p.vz = vz; p.pvx = vx; p.pvy = vy; p.pvz = vz;
          p.dirty = true;
        }
        if (donor.alive && donor.def.shatterLines) {
          const text = c2.rng.pick(donor.def.shatterLines);
          donor.speech = { text, t: c2.time };
          c2.emit('donor:speak', { id: donor.id, text }, [donor.parts.head.x, donor.parts.head.y, donor.parts.head.z]);
        }
      }
    }
    return inst;
  },
};

/** Pose the encased donor standing upright (in WORLD terms) in the middle of the ball. */
function poseInside(ctx, donor, d, first = false) {
  const th = ctx.drum.theta;
  const c = Math.cos(-th); const s = Math.sin(-th);
  const sway = Math.sin(ctx.time * 3.1 + donor.id) * 0.08;
  const h = (-th + sway) / 2;
  const q = { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) };
  const cs = Math.cos(sway); const sn = Math.sin(sway);
  for (const pd of donor.def.plan.parts) {
    const p = donor.parts[pd.name];
    if (!p || p.removed) continue;
    // plan-local offset from the body middle, rotated by the sway then the drum
    let ox = pd.pos[0]; let oy = pd.pos[1] - UP_OFFSET * (donor.def.scale || 1);
    const sx = ox * cs - oy * sn; const sy = ox * sn + oy * cs;
    ox = sx * c - sy * s; oy = sx * s + sy * c;
    if (first) { p.px = d.x + ox; p.py = d.y + oy; p.pz = d.z + pd.pos[2]; p.pqx = q.x; p.pqy = q.y; p.pqz = q.z; p.pqw = q.w; } else {
      p.px = p.x; p.py = p.y; p.pz = p.z; p.pqx = p.qx; p.pqy = p.qy; p.pqz = p.qz; p.pqw = p.qw;
    }
    p.x = d.x + ox; p.y = d.y + oy; p.z = d.z + pd.pos[2];
    p.qx = q.x; p.qy = q.y; p.qz = q.z; p.qw = q.w;
    p.vx = d.vx; p.vy = d.vy; p.vz = d.vz;
  }
}
