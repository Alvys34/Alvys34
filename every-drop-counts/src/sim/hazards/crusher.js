/**
 * Crusher (GDD §7): a hydraulic press plate that shoots out of a wall on a fixed rhythm, telegraphed
 * by a warning light + hiss (`hazard:telegraph`). With the default stroke it closes to `gap` metres
 * of the OPPOSITE wall: anything caught in that closing gap is PRESSED (massive 'press' damage that
 * pops a big share of the part's blood instantly). Things struck mid-stroke get punched along.
 * Lesson: rhythm — rotate the crowd under the plate during the telegraph.
 *
 * spec: { type: 'crusher', wall, at, width?, z: [z0, z1], period?, phase? (s into the cycle),
 *         telegraph?, reach? (m; default = span - gap) }
 *
 * Cycle: idle -> telegraph -> extend -> hold -> retract -> idle (period s in total).
 * view (drum-local, updated in place):
 *   { kind: 'crusher', wall, n, t, at, width, plate, z0, z1, span, reach,
 *     x, y,                // base centre on the wall surface
 *     ext,                 // current plate-face distance from the wall (0 = retracted, reach = closed)
 *     state,               // 'idle' | 'telegraph' | 'extend' | 'hold' | 'retract'
 *     warn,                // 0..1 telegraph progress (1 = about to fire), 0 otherwise
 *     cycle }              // 0..1 position in the whole cycle
 * Events: hazard:telegraph {hazard:'crusher'}, hazard:contact {hazard:'crusher', intensity, pressed?}
 *         when it presses (pressed = donors caught this stroke so far) / punches something, extension crusher:stroke {} on every stroke (hydraulic thump).
 */
import { wallFrame, wallPoint, heightAboveWall, addVelocity } from '../physics.js';
import { damagePart } from '../donor.js';
import { releaseBlood } from '../blood.js';
import { hitProps } from './common.js';

export default {
  type: 'crusher',
  create(ctx, spec) {
    const { R, world, T, drum } = ctx;
    const H = { ...T.hazards.crusher, ...(spec.tune || {}) };
    const f = wallFrame(drum, spec.wall);
    const width = spec.width ?? H.width;
    const half = width / 2;
    const plate = H.plate;
    const z0 = spec.z ? spec.z[0] : -drum.hd; const z1 = spec.z ? spec.z[1] : drum.hd;
    const span = f.n[0] !== 0 ? drum.hw * 2 : drum.hh * 2;
    const reach = spec.reach ?? span - H.gap;
    const pressing = span - reach < 1.0; // closes on the opposite wall
    const period = spec.period ?? H.period;
    const tel = spec.telegraph ?? H.telegraph;
    const tExt = H.extendTime * Math.max(0.6, reach / 6);
    const tHold = H.holdTime; const tRet = H.retractTime;
    const tIdle = Math.max(0.2, period - tel - tExt - tHold - tRet);
    const base = wallPoint(drum, spec.wall, spec.at, 0);
    const ex = f.t[0] !== 0 ? half : plate / 2;
    const ey = f.t[0] !== 0 ? plate / 2 : half;
    const centreAt = (e) => wallPoint(drum, spec.wall, spec.at, e - plate / 2);
    const c0 = centreAt(0);
    const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(c0[0], c0[1], (z0 + z1) / 2));
    const collider = world.createCollider(R.ColliderDesc.cuboid(ex, ey, (z1 - z0) / 2).setFriction(0.8).setRestitution(0), body);
    let state = 'idle';
    let ext = 0;
    const struck = new Set();
    let pressedThisStroke = false;
    const pressedDonors = new Set();
    let pressedReported = 0;

    const inst = {
      load: 0,
      view: {
        kind: 'crusher', wall: spec.wall, n: f.n, t: f.t, at: spec.at, width, plate, z0, z1, span, reach,
        x: base[0], y: base[1], ext: 0, state: 'idle', warn: 0, cycle: 0,
      },
      colliders: [collider],
      body,

      preStep(c2, dt) {
        const tc = (((c2.time + dt + (spec.phase ?? 0)) % period) + period) % period;
        let st; let e; let warn = 0;
        if (tc < tIdle) { st = 'idle'; e = 0; }
        else if (tc < tIdle + tel) { st = 'telegraph'; e = 0; warn = (tc - tIdle) / tel; }
        else if (tc < tIdle + tel + tExt) { st = 'extend'; const k = (tc - tIdle - tel) / tExt; e = reach * k * k; }
        else if (tc < tIdle + tel + tExt + tHold) { st = 'hold'; e = reach; }
        else { st = 'retract'; const k = (tc - tIdle - tel - tExt - tHold) / tRet; e = reach * (1 - k * k * (3 - 2 * k)); }
        if (st !== state) {
          if (st === 'telegraph') c2.emit('hazard:telegraph', { hazard: 'crusher' }, [base[0], base[1], (z0 + z1) / 2]);
          if (st === 'extend') { struck.clear(); pressedDonors.clear(); pressedReported = 0; pressedThisStroke = false; c2.emit('crusher:stroke', {}, [base[0], base[1], (z0 + z1) / 2]); }
          state = st;
        }
        ext = e;
        const c = centreAt(e);
        body.setNextKinematicTranslation({ x: c[0], y: c[1], z: (z0 + z1) / 2 });
        const v = inst.view;
        v.ext = e; v.state = st; v.warn = warn; v.cycle = tc / period;
      },

      postStep(c2, dt) {
        inst.load = Math.max(0, inst.load - dt * 2);
        if (state !== 'extend' && state !== 'hold') return;
        const closing = pressing && ext >= reach - 0.45;
        let hits = 0; let pressed = 0; let hx = base[0]; let hy = base[1]; let hz = 0;
        for (const part of c2.parts) {
          if (part.removed || part.encased) continue;
          const tcoord = f.t[0] * part.x + f.t[1] * part.y;
          if (Math.abs(tcoord - spec.at) > half + part.thick || part.z < z0 - part.thick || part.z > z1 + part.thick) continue;
          const h = heightAboveWall(drum, spec.wall, part.x, part.y);
          if (h - part.thick > ext + 0.06) continue; // still in front of the plate
          if (closing) {
            if (struck.has(-part.uid)) continue;
            struck.add(-part.uid);
            damagePart(c2, part, H.pressDamage, 'press', 'crush');
            pressedDonors.add(part.donor.id);
            releaseBlood(c2, part, part.blood * H.pressBurst, { burst: true, pos: [part.x, part.y, part.z], dir: [-f.t[0], -f.t[1], 0] });
            // squirt out sideways so the pile does not stay wedged under the plate
            const side = tcoord >= spec.at ? 1 : -1;
            addVelocity(part, f.t[0] * side * 5, f.t[1] * side * 5, (part.z >= (z0 + z1) / 2 ? 1 : -1) * 1.5);
            pressed++;
          } else if (state === 'extend' && !struck.has(part.uid)) {
            struck.add(part.uid);
            damagePart(c2, part, H.punchDamage, 'blunt', 'crush');
            const vn = f.n[0] * part.vx + f.n[1] * part.vy;
            if (vn < H.punch) addVelocity(part, f.n[0] * (H.punch - vn), f.n[1] * (H.punch - vn), 0);
            hits++;
          }
          hx = part.x; hy = part.y; hz = part.z;
        }
        hitProps(c2, 'crusher', (d) => {
          const tcoord = f.t[0] * d.x + f.t[1] * d.y;
          if (Math.abs(tcoord - spec.at) > half + d.radius * 0.5 || d.z < z0 - d.radius || d.z > z1 + d.radius) return 0;
          const h = heightAboveWall(drum, spec.wall, d.x, d.y);
          if (h - d.radius > ext + 0.1 || struck.has(1e9 + d.uid)) return 0;
          struck.add(1e9 + d.uid);
          return closing ? 3 : 1;
        });
        if (pressed || hits) {
          inst.load = 1;
          if (pressed && pressedDonors.size > pressedReported) {
            // first press of the stroke (+ again whenever more donors get caught): `pressed` = donors so far
            pressedReported = pressedDonors.size;
            pressedThisStroke = true;
            c2.emit('hazard:contact', { hazard: 'crusher', intensity: Math.min(1, 0.5 + pressed * 0.06), pressed: pressedDonors.size }, [hx, hy, hz]);
          } else if (hits && !pressed) {
            c2.emit('hazard:contact', { hazard: 'crusher', intensity: Math.min(1, 0.3 + hits * 0.05) }, [hx, hy, hz]);
          }
        }
      },

      dispose(c2) { try { c2.world.removeRigidBody(body); } catch { /* world gone */ } },
    };
    ctx.owners.set(collider.handle, { kind: 'hazard', hazard: inst });
    return inst;
  },
};
