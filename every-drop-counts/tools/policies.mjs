/**
 * Bot policies for tools/simbot.mjs and tests. A policy is (simState, t, mem) -> { rotate, brake, slam }
 * using ONLY the player's verbs (rotate -1..1, brake, slam) — no sim mutation, no cheating.
 * Policies read sim state the way a player reads the screen (hazard positions, where the crowd is,
 * pool level, the crusher light, the grinder jam, the Inspector's sphere).
 *
 * Careless / mindless:
 *   idle         never touches anything
 *   spin         holds one direction forever (max speed -> centrifuge)
 *   rock         alternates full left/right every 1.6 s and slams whenever ready (button masher)
 *   rockR        the same, starting the other way (mashing from rest drifts the drum ~±2 rad, so
 *                the two variants cover opposite sides of the drum)
 * Exploit candidates (each one a "can I win without reading the level?" strategy):
 *   tumble       steady moderate spin (~1.1 rad/s cascade, the "washing machine")
 *   slamSpam     never rotates, slams on cooldown
 *   flipper      180° flips every 4 s at full speed, never aims (mindless "drop from height")
 *   rockAim      rocks around the angle that puts the nearest hazard down, slam-spams
 *   park         parks the best-yield hazard (grinder first) at the bottom forever, slams on cooldown
 * Intent:
 *   smart        picks a hazard, brings the crowd onto it with the right tactic (drop onto
 *                spikes, tilt into saws/grinder, wait under the crusher, waterline / slam-up when
 *                the pool is high), slams to free impaled donors / clear jams, steers away from
 *                the Inspector's sphere and from drowning.
 */
import { solveLevel } from '../src/sim/geom.js';

const TAU = Math.PI * 2;
const DEBUG = typeof process !== 'undefined' && process.env && process.env.EDC_BOT_DEBUG;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** angle at which drum-local direction (px,py) points world-DOWN */
export const angleDown = (px, py) => Math.atan2(-px, -py);

/** rotate input that drives the drum to angle `target` (shortest way unless `dir` given). */
export function steer(s, target, { maxW = 2.2, k = 3.2, dir = 0 } = {}) {
  const d = s.drum;
  let err = wrap(target - d.theta);
  if (dir > 0 && err < -0.3) err += TAU;
  if (dir < 0 && err > 0.3) err -= TAU;
  const want = clamp(err * k, -maxW, maxW);
  const rotate = clamp(-(want - d.omega) * 2.5, -1, 1);
  const brake = Math.abs(err) < 0.12 && Math.abs(d.omega) > 0.6;
  return { rotate: Math.abs(err) < 0.02 && Math.abs(d.omega) < 0.05 ? 0 : rotate, brake, err };
}

/** A drum-local point that represents where a hazard wants the crowd. */
export function hazardPoint(h) {
  const v = h.view; const hw = 8; const hh = 5;
  const wallXY = (wall, at, off = 0) => ({ floor: [at, -hh + off], ceiling: [at, hh - off], left: [-hw + off, at], right: [hw - off, at] }[wall]);
  switch (v.kind) {
    case 'spikes': return wallXY(v.wall, (v.from + v.to) / 2);
    case 'saw': return [v.x, v.y];
    case 'railSaw': return wallXY(v.wall, (v.from + v.to) / 2, v.offset);
    case 'grinder': return [v.x, v.y];
    case 'crusher': { // the crowd must lie on the OPPOSITE wall under the plate
      const opp = { floor: 'ceiling', ceiling: 'floor', left: 'right', right: 'left' }[v.wall];
      return wallXY(opp, v.at);
    }
    default: return [v.x || 0, v.y || 0];
  }
}

function product(s) {
  const out = [];
  for (const d of s.donors) {
    if (d.gone || d.mustSurvive) continue;
    if (!d.alive && d.blood < d.bloodMax * 0.25) continue;
    const c = d.parts.chest.removed ? d.parts.pelvis : d.parts.chest;
    if (!c || c.removed) continue;
    out.push(c);
  }
  return out;
}

const VALUE = { grinder: 3.2, saw: 2.6, railSaw: 2.4, crusher: 2.2, spikes: 1.6 };

export const POLICIES = {
  idle: () => ({ rotate: 0 }),
  spin: () => ({ rotate: 1 }),
  rock: (s, t) => {
    const phase = Math.floor(t / 1.6) % 2;
    return { rotate: phase ? 1 : -1, slam: s.drum.slamCooldown <= 0 && Math.floor(t * 10) % 25 === 0 };
  },
  /** mirror of rock (starts the other way): mindless mashing is judged by the better of the two */
  rockR: (s, t) => {
    const phase = Math.floor(t / 1.6) % 2;
    return { rotate: phase ? -1 : 1, slam: s.drum.slamCooldown <= 0 && Math.floor(t * 10) % 25 === 0 };
  },
  tumble: (s) => ({ rotate: clamp(-(1.1 - s.drum.omega) * 2.5, -1, 1) }),
  slamSpam: (s) => ({ rotate: 0, slam: s.drum.slamCooldown <= 0 }),
  flipper: (s, t, mem) => {
    if (mem.base == null) mem.base = s.drum.theta;
    const k = Math.floor(t / 4);
    return steer(s, mem.base + (k % 2) * Math.PI, { dir: 1 });
  },
  rockAim: (s, t, mem) => {
    if (mem.aim == null) {
      // the hazard closest to the current down direction
      let best = null; let bd = 9;
      for (const h of s.hazards) {
        const [x, y] = hazardPoint(h);
        const a = angleDown(x, y); const dd = Math.abs(wrap(a - s.drum.theta));
        if (dd < bd) { bd = dd; best = a; }
      }
      mem.aim = best ?? 0;
    }
    const phase = Math.floor(t / 1.2) % 2;
    const r = steer(s, mem.aim + (phase ? 0.9 : -0.9), { k: 6 });
    return { rotate: r.rotate, slam: s.drum.slamCooldown <= 0 };
  },
  park: (s, t, mem) => {
    if (!mem.h) {
      mem.h = [...s.hazards].sort((a, b) => (VALUE[b.type] || 1) - (VALUE[a.type] || 1))[0];
    }
    if (!mem.h) return { rotate: 0 };
    const [x, y] = hazardPoint(mem.h);
    const r = steer(s, angleDown(x, y));
    return { rotate: r.rotate, brake: r.brake, slam: s.drum.slamCooldown <= 0 };
  },
  smart: smartPolicy,
};

// ------------------------------------------------------------------------------------ smart --
function smartPolicy(s, t, mem) {
  const d = s.drum;
  const T = s.T;
  const fill = s.pool.fill;
  const crowd = product(s);
  const spheres = s.props.filter((p) => !p.removed && p.view && p.view.kind === 'safetySphere').map((p) => p.view.dyn);
  const bareInspectors = s.donors.filter((dn) => dn.alive && dn.mustSurvive && !dn.encased && !dn.gone).map((dn) => dn.parts.chest);
  const inspectors = [...spheres, ...bareInspectors.filter((c) => c && !c.removed)];
  let slam = false;

  // --- emergencies first
  if (d.slamCooldown <= 0) {
    if (s.donors.some((dn) => dn.alive && !dn.mustSurvive && dn.drownTimer > 2.5)) slam = true; // anti-drown
    if (s.hazards.some((h) => h.view.kind === 'grinder' && h.view.clogged)) slam = true; // clear the jam
  }

  // --- choose / keep a target hazard + tactic
  mem.until = mem.until || 0;
  if (!mem.plan || t > mem.until || (mem.plan.h && !s.hazards.includes(mem.plan.h))) {
    mem.plan = choosePlan(s, crowd, inspectors, mem);
    if (DEBUG) console.error(`t=${t.toFixed(1)} plan ${mem.plan.tactic} ${mem.plan.h ? mem.plan.h.type + '#' + mem.plan.h.id : ''} target=${(mem.plan.target ?? 0).toFixed(2)} theta=${s.drum.theta.toFixed(2)} crowd=${crowd.length} fill=${s.pool.fill.toFixed(2)}`);
    mem.until = t + mem.plan.duration;
    mem.phase = 0; mem.phaseT = t;
  }
  const plan = mem.plan;
  if (!crowd.length) {
    // nothing to process: settle level-ish and wait for the hatch (keeps floor down, cheap)
    const r = steer(s, plan.wait ?? d.theta, { maxW: 1.2 });
    return { rotate: r.rotate, brake: r.brake || Math.abs(d.omega) > 0.3, slam: false };
  }
  let out;
  switch (plan.tactic) {
    case 'drop': out = tacticDrop(s, t, mem, plan); break;
    case 'slamUp': out = tacticSlamUp(s, t, mem, plan, crowd); break;
    case 'press': out = tacticPress(s, t, mem, plan, crowd); break;
    case 'waterline': out = tacticWaterline(s, t, mem, plan, crowd); break;
    default: out = tacticTilt(s, t, mem, plan, crowd); break;
  }
  // impaled donors that are drained: shake them loose (re-drop); fresh ones keep bleeding
  if (d.slamCooldown <= 0 && !slam && plan.tactic !== 'slamUp') {
    let impaledDry = 0;
    for (const p of s.parts) if (p.impaled && p.blood < p.bloodMax * 0.15) impaledDry++;
    if (impaledDry >= 3) slam = true;
  }
  // never slam an encased Inspector into a hazard above him
  if ((out.slam || slam) && inspectors.length && plan.h) {
    const [hx, hy] = hazardPoint(plan.h);
    for (const q of inspectors) {
      const above = (hx - q.x) * d.ux + (hy - q.y) * d.uy;
      if (above > 0 && above < 7 && Math.hypot(hx - q.x, hy - q.y) < 4.5 && plan.tactic === 'slamUp') { out.slam = false; slam = false; }
    }
  }
  return { rotate: out.rotate, brake: !!out.brake, slam: !!(out.slam || slam) };
}

function choosePlan(s, crowd, inspectors, mem) {
  const d = s.drum;
  const fill = s.pool.fill;
  let best = null;
  for (const h of s.hazards) {
    const [x, y] = hazardPoint(h);
    let tactic = h.type === 'spikes' ? 'drop' : h.type === 'crusher' ? 'press' : 'tilt';
    let target = angleDown(x, y);
    let score = VALUE[h.type] || 1;
    // the pool: a hazard at the bottom is under the surface once the tank fills up
    const submerged = hazardSubmerged(s, x, y, target);
    if (submerged) {
      // the pool covers it at its own "down" angle: find an angle where it sits AT the waterline
      // (floaters drift into it), else use it from above (slam the floating crowd up into it)
      const wl = h.type === 'crusher' ? null : waterlineAngle(s, x, y);
      const head = headroomTo(s, x, y);
      if (wl != null) { tactic = 'waterline'; target = wl; score *= 1.0; }
      else if (head < 5.5) { tactic = 'slamUp'; target = wrap(target + Math.PI); score *= 1.1; } else score *= 0.25;
    }
    if (h.type === 'grinder' && h.view.clogged) score *= 1.5;
    if (h.type === 'crusher' && fill > 0.35) score *= 0.4;
    // the Inspector: never park him on a hazard
    for (const q of inspectors) {
      const dist = Math.hypot(q.x - x, q.y - y);
      if (dist < 4.5) score *= 0.15;
      // a tilt sends the sphere (it rolls fast) to the same low point as the hazard
      if (tactic === 'tilt' || tactic === 'drop') score *= 0.55;
    }
    // prefer hazards that need less rotation (time is product)
    score *= 1 - 0.18 * Math.abs(wrap(target - d.theta)) / Math.PI;
    // variety: don't hammer the same hazard forever
    if (mem.plan && mem.plan.h === h) score *= 0.8;
    score *= 0.9 + 0.2 * ((Math.sin(s.time * 7.3 + h.id * 13.1) + 1) / 2);
    if (!best || score > best.score) best = { h, tactic, target, score };
  }
  if (!best) return { tactic: 'none', duration: 2, wait: d.theta };
  best.inspector = inspectors.length > 0;
  const duration = { drop: 7, tilt: 8, press: 11, slamUp: 7, waterline: 6 }[best.tactic];
  return { ...best, duration, wait: best.target };
}

function hazardSubmerged(s, x, y, theta) {
  if (s.pool.fill < 0.08) return false;
  const level = solveLevel(theta, 8, 5, s.pool.fill * 160);
  const h = Math.sin(theta) * x + Math.cos(theta) * y;
  return h < level - 0.4;
}

/** drum angle (closest to the current one) that puts point (x,y) just above the pool surface. */
function waterlineAngle(s, x, y) {
  const area = s.pool.fill * 160;
  let best = null; let bestCost = 1e9;
  for (let i = 0; i < 64; i++) {
    const th = s.drum.theta + (i / 64) * TAU - Math.PI;
    const level = solveLevel(th, 8, 5, area);
    const h = Math.sin(th) * x + Math.cos(th) * y;
    const miss = Math.abs(h - level - 0.3);
    if (miss > 0.7) continue;
    const cost = miss + 0.25 * Math.abs(wrap(th - s.drum.theta));
    if (cost < bestCost) { bestCost = cost; best = wrap(th); }
  }
  return best;
}

/** distance (world) from the pool surface up to hazard point when the hazard is at the TOP. */
function headroomTo(s, x, y) {
  const th = angleDown(x, y) + Math.PI;
  const level = solveLevel(th, 8, 5, s.pool.fill * 160);
  const h = Math.sin(th) * x + Math.cos(th) * y;
  return h - level;
}

/** spikes: agitate with the bed down (falls + flings onto it); every few seconds a full flip drop. */
function tacticDrop(s, t, mem, plan) {
  if (mem.phase === 0) { // agitate around bed-down, slam to re-drop them onto it
    const ph = Math.floor((t - mem.phaseT) / 1.2) % 2;
    const r = steer(s, plan.target + (ph ? 0.6 : -0.6), { k: 6 });
    if (t - mem.phaseT > 5.5 && !plan.inspector) { mem.phase = 1; mem.phaseT = t; }
    return { ...r, slam: s.drum.slamCooldown <= 0 && Math.abs(wrap(plan.target - s.drum.theta)) < 0.8 };
  }
  if (mem.phase === 1) { // bring the bed up (crowd falls to the opposite wall)
    const r = steer(s, plan.target + Math.PI, { maxW: 2.2, k: 6 });
    if (Math.abs(r.err) < 0.25 && t - mem.phaseT > 0.8) { mem.phase = 2; mem.phaseT = t; mem.dir = (mem.dir || 1) * -1; }
    return r;
  }
  if (mem.phase === 2) { // flip at full speed: they come down from the full height of the drum
    const r = steer(s, plan.target, { k: 9, dir: mem.dir });
    if (Math.abs(r.err) < 0.2) { mem.phase = 0; mem.phaseT = t; }
    return r;
  }
  mem.phase = 0;
  return { rotate: 0 };
}

/**
 * saws / grinder / rail saw: put the hazard on the low side and AGITATE around that angle (sharp
 * swings throw the crowd through it again and again); slam when the crowd is piled next to it.
 * The grinder gets a gentler sway (feed it, don't jam it).
 */
function tacticTilt(s, t, mem, plan, crowd) {
  const grinder = plan.h.type === 'grinder';
  const amp = grinder ? 0.3 : 0.8;
  const period = grinder ? 3.0 : 2.4;
  const ph = Math.floor((t - mem.phaseT) / (period / 2)) % 2;
  const r = steer(s, plan.target + (ph ? amp : -amp), { k: grinder ? 3 : 6 });
  let slam = false;
  if (s.drum.slamCooldown <= 0 && !grinder) {
    const [hx, hy] = hazardPoint(plan.h);
    let near = 0;
    for (const c of crowd) if (Math.hypot(c.x - hx, c.y - hy) < 3.5) near++;
    if (near >= 1) slam = true;
  }
  return { ...r, slam };
}

/** crusher: lay the crowd on the opposite wall under the plate and wait for the stroke. */
function tacticPress(s, t, mem, plan) {
  const v = plan.h.view;
  const r = steer(s, plan.target, { maxW: 1.6 });
  // stay still during the telegraph + stroke
  if (v.state === 'telegraph' || v.state === 'extend' || v.state === 'hold') return { rotate: 0, brake: true };
  return r;
}

/** pool: hold the hazard at the waterline, rock gently so floaters drift through it, slam to lift them in. */
function tacticWaterline(s, t, mem, plan, crowd) {
  const wl = waterlineAngle(s, ...hazardPoint(plan.h));
  if (wl != null) plan.target = wl;
  const ph = Math.floor((t - mem.phaseT) / 1.5) % 2;
  const r = steer(s, plan.target + (ph ? 0.3 : -0.3), { k: 4 });
  let slam = false;
  if (s.drum.slamCooldown <= 0) {
    const [hx, hy] = hazardPoint(plan.h);
    for (const c of crowd) if (Math.hypot(c.x - hx, c.y - hy) < 3.5) { slam = true; break; }
  }
  return { ...r, slam };
}

/** high pool: hazard at the TOP, crowd floating below it, slam them up into it. */
function tacticSlamUp(s, t, mem, plan, crowd) {
  const r = steer(s, plan.target, { maxW: 1.4 });
  const [hx, hy] = hazardPoint(plan.h);
  let slam = false;
  if (s.drum.slamCooldown <= 0 && Math.abs(r.err) < 0.3) {
    let near = 0;
    for (const c of crowd) {
      const dist = Math.hypot(c.x - hx, c.y - hy);
      if (dist < 6.5) near++;
    }
    if (near >= 1) slam = true;
  }
  return { ...r, slam };
}
