/**
 * Grinder (GDD §7): a housing on a wall with two toothed counter-rotating rollers on its face.
 * Parts that rest on the roller face over the mouth (slower than grabMaxSpeed) are GRABBED (dragged into the jaw, ground),
 * then SWALLOWED one at a time at `chewRate` kg/s. A swallowed part's blood is converted 100 %
 * to litres over `convertTime` (~1.5 s) — the best yield in the game, but slow.
 * Too much meat in the mouth at once (> clogMass kg) JAMS the rollers: nothing is swallowed and
 * nothing new is grabbed until a SLAM clears it (the jam is then crunched at a boosted rate).
 *
 * spec: { type: 'grinder', wall, at, width?, z: [z0, z1] }
 *
 * view (drum-local, updated in place):
 *   { kind: 'grinder', wall, n, t, at, width, housing, z0, z1,
 *     x, y,              // centre of the roller face (housing top), drum-local
 *     angle,             // roller rotation (rad) — the two rollers counter-rotate (+angle / -angle)
 *     clogged,           // bool: jammed, needs a slam
 *     held,              // number of parts in the jaw
 *     heldMass,          // kg in the jaw (jams above clogMass)
 *     chewing,           // bool: currently swallowing something
 *     boost }            // 0..1 post-clear boost remaining
 * load: 0..1 (audioState().grinderLoad): 0 idle, ~0.4–1 chewing, 1 jammed.
 * Events: hazard:contact {hazard:'grinder', intensity} (throttled), grinder:clog {heldMass},
 *         grinder:clear {bySlam}, extension grinder:swallow {id, part, liters} (a part went in).
 * Blood in transit (swallowed, not yet converted) is tracked in ctx.blood.pending.
 */
import { wallFrame, wallPoint, heightAboveWall, addVelocity } from '../physics.js';
import { damagePart, severPart, removePart } from '../donor.js';
import { releaseBlood } from '../blood.js';
import { hitProps } from './common.js';

export default {
  type: 'grinder',
  create(ctx, spec) {
    const { R, world, T, drum } = ctx;
    const S = T.donor.scale ?? 1;
    const H = { ...T.hazards.grinder };
    H.clogMass *= S; H.chewRate *= S; // donor mass scales with donorScale: same donors-per-jam / time
    const f = wallFrame(drum, spec.wall);
    const width = spec.width ?? H.width;
    const housing = spec.housing ?? H.housing;
    const z0 = spec.z ? spec.z[0] : -drum.hd + 0.3; const z1 = spec.z ? spec.z[1] : drum.hd - 0.3;
    const mid = spec.at;
    const half = width / 2;
    // housing box: from inside the wall up to the roller face
    const c = wallPoint(drum, spec.wall, mid, (housing - 0.3) / 2);
    const thick = (housing + 0.3) / 2;
    const ex = f.t[0] !== 0 ? half + 0.25 : thick;
    const ey = f.t[0] !== 0 ? thick : half + 0.25;
    const collider = world.createCollider(
      R.ColliderDesc.cuboid(ex, ey, (z1 - z0) / 2 + 0.1).setTranslation(c[0], c[1], (z0 + z1) / 2)
        .setFriction(1.2).setRestitution(0),
      ctx.drumBody,
    );
    const face = wallPoint(drum, spec.wall, mid, housing);
    const held = [];          // { part, mass }
    const converting = [];    // { left, rate }
    let progress = 0;         // kg of the current chew
    let clogged = false;
    let boost = 0;
    let contactCd = 0;
    let propCd = 0;

    const inst = {
      load: 0,
      view: {
        kind: 'grinder', wall: spec.wall, n: f.n, t: f.t, at: mid, width, housing, z0, z1,
        x: face[0], y: face[1], angle: 0, clogged: false, held: 0, heldMass: 0, chewing: false, boost: 0,
      },
      colliders: [collider],

      postStep(c2, dt) {
        contactCd -= dt; propCd -= dt;
        boost = Math.max(0, boost - dt);
        // 1) release held parts that were knocked away / removed
        for (let i = held.length - 1; i >= 0; i--) {
          const p = held[i].part;
          if (p.removed || gap(p) > 0.9 || !overMouth(p, 0.5)) { if (!p.removed) p.grinding = false; held.splice(i, 1); }
        }
        // 2) grab new parts touching the face
        if (!clogged) {
          for (const part of c2.parts) {
            if (held.length >= H.maxHeld) break;
            if (part.removed || part.encased || part.grinding) continue;
            if (!overMouth(part, 0.05) || gap(part) > H.grabMargin) continue;
            // the rollers catch what LIES on them: bodies flung / sliding across the pit pass over
            if (part.vx * part.vx + part.vy * part.vy + part.vz * part.vz > H.grabMaxSpeed * H.grabMaxSpeed) continue;
            part.grinding = true;
            held.push({ part, mass: part.mass });
          }
        }
        let heldMass = 0;
        for (const h of held) heldMass += h.mass;
        if (!clogged && boost <= 0 && heldMass > H.clogMass && held.length > 1) {
          clogged = true;
          c2.emit('grinder:clog', { heldMass: Math.round(heldMass) }, [face[0], face[1], (z0 + z1) / 2]);
        }
        // 3) drag held parts into the jaw, grind them
        for (const h of held) {
          const p = h.part;
          const tc = f.t[0] * p.x + f.t[1] * p.y;
          const tcl = Math.max(mid - half + 0.2, Math.min(mid + half - 0.2, tc));
          const zc = Math.max(z0 + 0.2, Math.min(z1 - 0.2, p.z));
          const tx = wallPoint(drum, spec.wall, tcl, housing + p.thick * 0.6);
          let vx = (tx[0] - p.x) * H.pull; let vy = (tx[1] - p.y) * H.pull; let vz = (zc - p.z) * H.pull;
          const sp = Math.hypot(vx, vy, vz);
          if (sp > H.pullMax) { vx *= H.pullMax / sp; vy *= H.pullMax / sp; vz *= H.pullMax / sp; }
          addVelocity(p, (vx - p.vx) * 0.4, (vy - p.vy) * 0.4, (vz - p.vz) * 0.4);
          if (!clogged) damagePart(c2, p, H.dps * dt, 'grind', 'grind');
        }
        // 4) swallow (FIFO), unless jammed
        const chewing = !clogged && held.length > 0;
        if (chewing) {
          const h = held[0];
          progress += H.chewRate * (boost > 0 ? H.clearBoost : 1) * dt;
          if (progress >= h.mass) {
            progress = 0;
            held.shift();
            swallow(c2, h.part);
          }
          if (contactCd <= 0) {
            contactCd = 0.12;
            c2.emit('hazard:contact', { hazard: 'grinder', intensity: Math.min(1, 0.45 + heldMass / H.clogMass * 0.5) }, [face[0], face[1], h.part.z]);
          }
        } else {
          progress = Math.max(0, progress - dt * H.chewRate);
        }
        if (clogged && held.length === 0) clear(c2, false);
        // 5) convert swallowed blood (100 % yield over convertTime)
        for (let i = converting.length - 1; i >= 0; i--) {
          const cv = converting[i];
          const amt = Math.min(cv.left, cv.rate * dt);
          cv.left -= amt;
          c2.blood.pending -= amt;
          releaseBlood(c2, null, amt);
          if (cv.left <= 1e-9) { c2.blood.pending -= cv.left; converting.splice(i, 1); }
        }
        // props: tanks get punctured, spheres crack (throttled)
        if (propCd <= 0) {
          let hit = false;
          hitProps(c2, 'grinder', (d) => {
            const tc = f.t[0] * d.x + f.t[1] * d.y;
            if (Math.abs(tc - mid) > half + d.radius * 0.5 || d.z < z0 - d.radius || d.z > z1 + d.radius) return 0;
            const g = heightAboveWall(drum, spec.wall, d.x, d.y) - housing - d.radius;
            if (g < H.grabMargin + 0.05) { hit = true; return 1; }
            return 0;
          });
          if (hit) propCd = 0.6;
        }
        // load + view
        let target = 0;
        if (clogged) target = 1;
        else if (chewing) target = Math.min(1, 0.4 + 0.6 * heldMass / H.clogMass);
        else if (converting.length) target = 0.25;
        inst.load += (target - inst.load) * Math.min(1, dt * (target > inst.load ? 12 : 3));
        const v = inst.view;
        v.clogged = clogged; v.held = held.length; v.heldMass = Math.round(heldMass * 10) / 10; v.chewing = chewing;
        v.boost = boost / H.clearBoostTime;
        v.angle += (clogged ? 0 : (chewing ? 7 : 4)) * dt;
      },

      onSlam(c2) {
        // keep the jam in the jaw (cancel the slam on held parts) and crunch it
        const dv = c2.T.slam.deltaV;
        for (const h of held) addVelocity(h.part, -c2.drum.ux * dv * h.part.slamScale, -c2.drum.uy * dv * h.part.slamScale, 0);
        if (clogged) clear(c2, true);
      },
    };

    function gap(p) { return heightAboveWall(drum, spec.wall, p.x, p.y) - p.thick - housing; }
    function overMouth(p, m) {
      const tc = f.t[0] * p.x + f.t[1] * p.y;
      return Math.abs(tc - mid) < half + m && p.z > z0 - m && p.z < z1 + m;
    }
    function clear(c2, bySlam) {
      clogged = false;
      if (bySlam) boost = H.clearBoostTime;
      c2.emit('grinder:clear', { bySlam }, [face[0], face[1], (z0 + z1) / 2]);
    }
    function swallow(c2, part) {
      // detach from neighbours first (stumps on what stays outside), then convert everything
      if (!part.severed) severPart(c2, part);
      for (const j of part.donor.joints) if (j.parent === part && !j.severed && !j.removed) severPart(c2, j.child);
      const amt = part.blood;
      if (amt > 0) {
        part.blood = 0;
        part.donor.blood -= amt;
        c2.blood.pending += amt;
        converting.push({ left: amt, rate: amt / H.convertTime });
      }
      part.grinding = false;
      c2.lastRemoveCause = 'grind';
      removePart(c2, part, { release: false });
      c2.lastRemoveCause = null;
      c2.emit('grinder:swallow', { id: part.donor.id, part: part.name, liters: Math.round(amt * 100) / 100 }, [part.x, part.y, part.z]);
    }

    ctx.owners.set(collider.handle, { kind: 'hazard', hazard: inst });
    return inst;
  },
};
