/**
 * Spike strip (GDD §7): impact damage ∝ normal speed; fast bodies get IMPALED (pinned to the wall,
 * steady bleed) until a SLAM shakes them loose.
 *
 * spec: { type: 'spikes', wall: 'floor'|'ceiling'|'left'|'right', from, to, z: [z0, z1] }
 *   from/to: tangent coordinates along the wall (x for floor/ceiling, y for left/right)
 */
import { wallFrame, wallPoint, heightAboveWall } from '../physics.js';
import { damagePart } from '../donor.js';

export default {
  type: 'spikes',
  create(ctx, spec) {
    const { R, world, T, drum } = ctx;
    const H = T.hazards.spikes;
    const f = wallFrame(drum, spec.wall);
    const from = Math.max(-f.half, Math.min(spec.from, spec.to));
    const to = Math.min(f.half, Math.max(spec.from, spec.to));
    const z0 = spec.z ? spec.z[0] : -drum.hd; const z1 = spec.z ? spec.z[1] : drum.hd;
    const height = spec.height ?? H.height;
    const base = height * 0.55; // solid part: bodies rest on the spike tips region
    const mid = (from + to) / 2; const half = (to - from) / 2;
    const c = wallPoint(drum, spec.wall, mid, (base - 0.2) / 2);
    const thick = (base + 0.2) / 2;
    const ex = f.t[0] !== 0 ? half : thick;
    const ey = f.t[0] !== 0 ? thick : half;
    const collider = world.createCollider(
      R.ColliderDesc.cuboid(ex, ey, (z1 - z0) / 2).setTranslation(c[0], c[1], (z0 + z1) / 2)
        .setFriction(0.9).setRestitution(0),
      ctx.drumBody,
    );
    const inside = new Set();
    const impaled = [];
    let contactCooldown = 0;

    const inst = {
      load: 0,
      view: { kind: 'spikes', wall: spec.wall, from, to, z0, z1, height, n: f.n, t: f.t, impaled: 0 },
      colliders: [collider],

      postStep(c2, dt) {
        contactCooldown -= dt;
        let hits = 0;
        for (const part of c2.parts) {
          if (part.removed) continue;
          const h = heightAboveWall(drum, spec.wall, part.x, part.y) - part.thick;
          const tc = f.t[0] * part.x + f.t[1] * part.y;
          const inStrip = tc > from - 0.1 && tc < to + 0.1 && part.z > z0 - 0.1 && part.z < z1 + 0.1;
          const was = inside.has(part.uid);
          if (!inStrip || h > height + (was ? 0.35 : 0.12)) {
            if (was) inside.delete(part.uid);
            continue;
          }
          if (was) continue;
          inside.add(part.uid);
          // entering the spike zone: normal speed toward the wall (before the collision resolved it)
          const vn = Math.max(-(f.n[0] * part.pvx + f.n[1] * part.pvy), -(f.n[0] * part.vx + f.n[1] * part.vy));
          if (vn <= H.minSpeed) continue;
          const dmg = (vn - H.minSpeed) * H.damagePerSpeed * (part.role === 'head' ? 1.4 : 1);
          damagePart(c2, part, dmg, 'pierce', 'impale');
          part.wound = Math.min(c2.T.damage.maxWoundRate, part.wound + 0.05);
          hits++;
          if (vn > H.impaleSpeed && !part.impaled && H.impaleParts.includes(part.role) && impaled.length < H.maxImpaled) {
            impale(c2, part);
          }
          if (contactCooldown <= 0) {
            contactCooldown = 0.06;
            c2.emit('hazard:contact', { hazard: 'spike', intensity: Math.min(1, vn / 14) }, [part.x, part.y, part.z]);
          }
        }
        // drop records of removed parts
        for (let i = impaled.length - 1; i >= 0; i--) {
          if (impaled[i].part.removed) { impaled[i].part.donor.impaled--; impaled.splice(i, 1); }
        }
        inst.view.impaled = impaled.length;
        inst.load = Math.max(inst.load * Math.exp(-dt * 3), Math.min(1, hits / 2));
      },

      onSlam(c2) {
        if (!c2.T.slam.dislodgeImpaled) return;
        for (const rec of impaled) {
          if (!rec.part.removed && rec.joint.isValid()) c2.world.removeImpulseJoint(rec.joint, true);
          rec.part.impaled = null;
          rec.part.donor.impaled--;
          inside.delete(rec.part.uid);
        }
        impaled.length = 0;
      },
    };

    function impale(c2, part) {
      const R2 = c2.R;
      const j = c2.world.createImpulseJoint(
        R2.JointData.spherical({ x: part.x, y: part.y, z: part.z }, { x: 0, y: 0, z: 0 }),
        c2.drumBody, part.body, true,
      );
      j.setContactsEnabled(false);
      const rec = { part, joint: j };
      part.impaled = rec;
      part.donor.impaled++;
      part.wound = Math.min(c2.T.damage.maxWoundRate, part.wound + H.impaleBleed);
      impaled.push(rec);
    }

    ctx.owners.set(collider.handle, { kind: 'hazard', hazard: inst });
    return inst;
  },
};
