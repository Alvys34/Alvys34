import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, runPolicy, poseHash } from './helpers.mjs';
import { setMotors, jointWorldPos } from '../src/sim/donor.js';
import shift1 from '../src/sim/levels/shift1.js';

const CONTRACT_EVENTS = new Set(['shift:start', 'shift:end', 'wave:incoming', 'hatch:open', 'donor:spawn', 'donor:hurt', 'donor:death',
  'limb:sever', 'limb:break', 'impact', 'blood:spurt', 'blood:splat', 'splash', 'hazard:contact', 'hazard:telegraph',
  'grinder:clog', 'grinder:clear', 'slam', 'slam:ready', 'combo', 'bonus', 'fine', 'prop:puncture', 'prop:explode',
  'sphere:crack', 'sphere:shatter', 'pa:announce', 'timer:warning', 'game:pause', 'achievement']);
const POSITIONAL = ['hatch:open', 'donor:spawn', 'donor:hurt', 'donor:death', 'limb:sever', 'limb:break', 'impact', 'blood:spurt', 'blood:splat', 'splash', 'hazard:contact'];

test('determinism: same seed + same inputs => identical state', async () => {
  const run = async (seed) => {
    const { sim } = await makeSim({ seed, level: 2 });
    runPolicy(sim, 'rock', 12);
    const out = { hash: poseHash(sim), snap: sim.snapshot() };
    sim.dispose();
    return out;
  };
  const a = await run(7); const b = await run(7); const c = await run(8);
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.snap, b.snap);
  assert.notEqual(a.hash, c.hash, 'different seed should differ');
});

test('full shift 1 (spin): completes, no body escapes the drum, no exceptions', async () => {
  const { sim, events } = await makeSim({ seed: 3, level: 1 });
  let escapes = 0; let maxBodies = 0;
  runPolicy(sim, 'spin', 200, (s) => {
    const c = s.ctx; let n = 0;
    for (const d of c.dyns) {
      if (d.removed) continue;
      n++;
      if (!(Math.abs(d.x) < c.drum.hw + 0.3 && Math.abs(d.y) < c.drum.hh + 0.3 && Math.abs(d.z) < c.drum.hd + 0.3)) escapes++;
      if (!Number.isFinite(d.x + d.y + d.z + d.vx + d.vy + d.vz)) escapes += 1000;
    }
    maxBodies = Math.max(maxBodies, n);
  });
  assert.equal(sim.state.status, 'ended');
  assert.equal(escapes, 0, 'bodies outside the drum / NaN');
  assert.ok(maxBodies <= sim.ctx.T.sim.maxBodies);
  const end = events.find((e) => e.type === 'shift:end');
  assert.ok(end && ['complete', 'timeout', 'failed'].includes(end.payload.result));
  assert.ok(Number.isInteger(end.payload.stars) && end.payload.stars >= 0 && end.payload.stars <= 3);
  sim.dispose();
});

test('full shift 2 (rock): contract events + pan, blood conservation', async () => {
  const { sim, events } = await makeSim({ seed: 5, level: 2 });
  let violations = 0;
  runPolicy(sim, 'rock', 200, (s) => {
    const c = s.ctx; const B = c.blood;
    let inBodies = 0;
    for (const d of c.donors) for (const p of d.partList) { inBodies += p.blood; if (p.blood < -1e-9) violations++; }
    // every litre is accounted for: released (collected) + dissolved + still inside donors
    if (Math.abs(B.collected + B.dissolved + B.pending + inBodies - B.donorTotal) > 1e-6 * Math.max(1, B.donorTotal)) violations++;
    if (B.collected > B.donorTotal + 1e-9) violations++;
  });
  assert.equal(violations, 0);
  const snap = sim.snapshot();
  assert.ok(snap.collected <= snap.donorBloodTotal + 1e-6);
  assert.ok(Math.abs(snap.liters - (snap.collected + snap.bonus - snap.fines)) <= 0.06, 'liters = collected + bonuses - fines (result rounded to 0.1)');
  assert.ok(snap.collected > 0);
  assert.equal(sim.state.status, 'ended');
  const types = new Set(events.map((e) => e.type));
  for (const t of ['shift:start', 'shift:end', 'wave:incoming', 'hatch:open', 'donor:spawn', 'donor:death', 'limb:sever', 'impact', 'blood:spurt', 'slam', 'slam:ready', 'hazard:contact', 'pa:announce']) {
    assert.ok(types.has(t), `missing event ${t}`);
  }
  for (const e of events) {
    if (POSITIONAL.includes(e.type)) assert.ok(e.payload.pan >= -1 && e.payload.pan <= 1, `${e.type} pan ${e.payload.pan}`);
    if (e.type === 'donor:death') assert.ok(['cut', 'impale', 'crush', 'grind', 'impact', 'drown', 'explode', 'bleedout'].includes(e.payload.cause));
  }
  // every contract-named event we emit uses a contract name or a documented extension
  const extensions = new Set(['donor:speak', 'part:dissolve', 'grinder:swallow', 'crusher:stroke']);
  for (const t of types) assert.ok(CONTRACT_EVENTS.has(t) || extensions.has(t), `unexpected event type ${t}`);
  sim.dispose();
});

test('ragdolls do not jitter or explode at rest (alive and dead)', async () => {
  const lvl = { ...shift1, id: 'rest-test', duration: 999, waves: [{ at: 0.1, count: 8 }], pa: [] };
  const { sim } = await makeSim({ seed: 11, level: lvl });
  runPolicy(sim, 'idle', 10);
  const measure = (seconds) => {
    let max = 0; let sum = 0; let n = 0; let maxSep = 0;
    runPolicy(sim, 'idle', seconds, (s) => {
      for (const p of s.ctx.parts) { const v = Math.hypot(p.vx, p.vy, p.vz); max = Math.max(max, v); sum += v; n++; }
      for (const d of s.ctx.donors) for (const j of d.joints) {
        if (j.severed || j.removed) continue;
        const a = jointWorldPos(j.parent, j.a1); const b = jointWorldPos(j.child, j.a2);
        maxSep = Math.max(maxSep, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    });
    return { max, mean: sum / n, maxSep };
  };
  const alive = measure(3);
  assert.ok(alive.mean < 0.15, `alive mean speed ${alive.mean}`);
  assert.ok(alive.max < 3.0, `alive max speed ${alive.max} (flailing is fine, explosions are not)`);
  assert.ok(alive.maxSep < 0.06, `alive joint separation ${alive.maxSep}`);
  for (const d of sim.ctx.donors) { d.alive = false; setMotors(sim.ctx, d, false); }
  runPolicy(sim, 'idle', 5);
  const dead = measure(3);
  assert.ok(dead.mean < 0.12, `dead mean speed ${dead.mean} (sub-mm pile jitter / pool bob is ok)`);
  assert.ok(dead.max < 1.5, `dead max speed ${dead.max}`);
  assert.ok(dead.maxSep < 0.06, `dead joint separation ${dead.maxSep}`);
  sim.dispose();
});

test('slam: impulse along drum-relative up, cooldown, events', async () => {
  const lvl = { ...shift1, id: 'slam-test', duration: 999, waves: [{ at: 0.1, count: 2 }], pa: [] };
  const { sim, events } = await makeSim({ seed: 2, level: lvl });
  runPolicy(sim, 'idle', 6);
  const vyBefore = sim.ctx.parts[0].vy;
  sim.setInput({ slam: true });
  sim.step();
  assert.equal(events.filter((e) => e.type === 'slam').length, 1);
  assert.ok(sim.ctx.parts[0].vy > vyBefore + 5, 'parts were thrown up');
  sim.setInput({ slam: true });
  sim.step();
  assert.equal(events.filter((e) => e.type === 'slam').length, 1, 'cooldown blocks a second slam');
  runPolicy(sim, 'idle', sim.ctx.T.slam.cooldown + 0.1);
  assert.ok(events.some((e) => e.type === 'slam:ready'));
  sim.dispose();
});

test('overtime mode runs and ends when the tank runs dry', async () => {
  const { sim, events } = await makeSim({ seed: 4, level: 'overtime' });
  runPolicy(sim, 'idle', 300);
  assert.equal(sim.state.status, 'ended');
  assert.ok(events.some((e) => e.type === 'shift:end' && e.payload.result === 'failed'));
  sim.dispose();
});

test('drum regimes: slow spin cascades, sustained fast spin pins bodies to the walls', async () => {
  const measure = async (target) => {
    const lvl = { ...shift1, id: 'regime-test', hazards: [], duration: 999, waves: [{ at: 0.1, count: 5 }], pa: [] };
    const { sim } = await makeSim({ seed: 5, level: lvl });
    runPolicy(sim, 'idle', 5);
    let sumV = 0; let sumR = 0; let n = 0; let i = 0;
    runPolicy(sim, (st) => ({ rotate: Math.max(-1, Math.min(1, -(target - st.drum.omega) * 3)) }), 12, (s) => {
      if (i++ < 360) return;
      for (const p of s.ctx.parts) { sumV += Math.hypot(p.vx, p.vy, p.vz); sumR += Math.hypot(p.x, p.y); n++; }
    });
    sim.dispose();
    return { v: sumV / n, r: sumR / n };
  };
  const slow = await measure(0.7);
  const fast = await measure(2.2);
  assert.ok(slow.v > 2.0, `slow spin should tumble (mean relative speed ${slow.v})`);
  assert.ok(fast.v < 0.8, `fast spin should pin (mean relative speed ${fast.v})`);
  assert.ok(fast.r > 7.5, `pinned bodies sit at the walls/corners (mean radius ${fast.r})`);
});

test('determinism with all content (shift 8: grinder, crusher, rail saw, tanks, spheres)', async () => {
  const run = async () => {
    const { sim } = await makeSim({ seed: 21, level: 8 });
    runPolicy(sim, 'smart', 14);
    const out = { hash: poseHash(sim), snap: sim.snapshot() };
    sim.dispose();
    return out;
  };
  const a = await run(); const b = await run();
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.snap, b.snap);
});
