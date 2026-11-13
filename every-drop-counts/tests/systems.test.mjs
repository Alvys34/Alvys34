/**
 * Fix round 2 systems (PLAYTEST-1 M2/M6/B2/minor): pool fill curve, drowning, waves, report tiers,
 * donor:hurt for the living only, Overtime demand fields.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './helpers.mjs';
import { makeFillCurve } from '../src/sim/pool.js';
import { LEVELS } from '../src/sim/levels/index.js';
import { TUNABLES } from '../src/core/tunables.js';
import { spawnDonor, killDonor, damagePart } from '../src/sim/donor.js';
import { releaseBlood } from '../src/sim/blood.js';

const base = (id, extra = {}) => ({
  id, number: 91, name: id, duration: 999, capacity: 150, quota: [1, 2, 3],
  hatch: { wall: 'back', x: 0, y: 1.5, offset: 1.2 }, hazards: [], waves: [], pa: [], ...extra,
});
function stepFor(sim, seconds, inp = { rotate: 0 }) {
  for (let i = 0; i < Math.round(seconds * 60); i++) { sim.setInput(inp); sim.step(); }
}

test('fill curve: monotone, concave, deep at q1, cap only at 1.15 x q3 (every shift level)', () => {
  const maxFill = TUNABLES.pool.maxFill;
  for (const lvl of LEVELS) {
    const c = makeFillCurve(lvl, TUNABLES);
    if (lvl.fillCurve === false) { assert.equal(c, null, `${lvl.id}: legacy linear`); continue; }
    const [q1, , q3] = lvl.quota;
    const full = 1.15 * q3;
    assert.ok(c.fill(q1) >= 0.35 - 1e-9, `${lvl.id}: fill(q1) = ${c.fill(q1)}`);
    assert.ok(c.fill(q3) < maxFill - 0.01, `${lvl.id}: not capped at q3 (${c.fill(q3)})`);
    assert.ok(Math.abs(c.fill(full) - maxFill) < 1e-9 && c.fill(2 * full) === maxFill, `${lvl.id}: cap at 1.15 q3`);
    let prev = 0; let prevSlope = Infinity;
    for (let i = 1; i <= 200; i++) {
      const L = (full * i) / 200; const f = c.fill(L);
      assert.ok(f > prev, `${lvl.id}: monotone at ${L}`);
      const slope = f - prev;
      assert.ok(slope <= prevSlope + 1e-9, `${lvl.id}: concave at ${L}`);
      prev = f; prevSlope = slope;
    }
  }
  // per-level override and the legacy model
  const custom = makeFillCurve({ quota: [10, 20, 40], fillCurve: { atQ1: 0.5, fullAt: 1.0 } }, TUNABLES);
  assert.ok(Math.abs(custom.fill(10) - 0.5) < 1e-6 && Math.abs(custom.fill(40) - maxFill) < 1e-9);
  assert.equal(makeFillCurve({ quota: [10, 20, 40], fillCurve: false }, TUNABLES), null);
});

test('fill curve drives the shift pool; Overtime keeps the real tank volume', async () => {
  const { sim } = await makeSim({ seed: 1, level: 3 });
  const c = sim.ctx;
  assert.ok(c.pool.curve, 'shift 3 has a curve');
  const d = spawnDonor(c, 'standard', 0, 2, 0);
  for (const p of d.partList) releaseBlood(c, p, p.blood); // 5 L
  stepFor(sim, 0.1);
  assert.ok(Math.abs(c.pool.fill - c.pool.curve.fill(c.blood.collected)) < 1e-9);
  assert.ok(c.pool.fill > c.pool.curve.maxFill * c.blood.collected / c.pool.curve.fullLiters, 'concave: above the chord early on');
  sim.dispose();
  const ot = await makeSim({ seed: 1, level: 'overtime' });
  assert.equal(ot.sim.ctx.pool.curve, null);
  stepFor(ot.sim, 1);
  assert.ok(Math.abs(ot.sim.ctx.pool.fill - ot.sim.ctx.pool.volume / ot.sim.ctx.pool.capacity) < 1e-9);
  const s = ot.sim.snapshot().overtime;
  assert.ok('demandRate' in s && 'demandTier' in s && 'demandLevel' in s, 'demand fields');
  ot.sim.dispose();
});

test('drowning: live donors float low in a deep pool, progress rises, warns once, drowns = waste', async () => {
  // fullLiters 1: one litre fills the pool to the cap (deep everywhere)
  const { sim, events } = await makeSim({ seed: 3, level: base('t-drown', { fillCurve: { fullLiters: 1, k: 0 } }) });
  const c = sim.ctx;
  const seed = spawnDonor(c, 'standard', -5, 3, 0);
  releaseBlood(c, seed.parts.chest, 1.2);
  const d = spawnDonor(c, 'standard', 2, 2, 0);
  assert.equal(d.parts.chest.buoyancy, TUNABLES.donor.aliveBuoyancy, 'live donors float low');
  let maxDrown = 0; let diedAt = null; let underT = 0;
  for (let i = 0; i < 60 * 15 && d.alive; i++) {
    sim.setInput({ rotate: 0 }); sim.step();
    if (d.parts.head.sub > TUNABLES.donor.drownHeadSub) underT += c.dt;
    maxDrown = Math.max(maxDrown, d.drown01);
    if (!d.alive) diedAt = c.time;
  }
  assert.ok(c.pool.depth > 5, `deep pool (${c.pool.depth})`);
  assert.equal(d.alive, false, `drowned (max progress ${maxDrown}, head under ${underT.toFixed(1)} s)`);
  assert.equal(d.cause, 'drown');
  assert.ok(underT >= TUNABLES.donor.drownSeconds - 0.05, `head under >= drownSeconds (${underT})`);
  const warn = events.filter((e) => e.type === 'donor:drowning' && e.payload.id === d.id);
  assert.equal(warn.length >= 1, true, 'donor:drowning fired');
  assert.ok(['x', 'y', 'z', 'pan'].every((k) => k in warn[0].payload));
  const death = events.find((e) => e.type === 'donor:death' && e.payload.id === d.id).payload;
  assert.ok(death.wasted > 3, `wasted litres in the death payload (${death.wasted})`);
  assert.ok(d.partList.every((p) => p.blood === 0), 'nothing left to collect');
  assert.ok(d.partList.every((p) => p.buoyancy === 1), 'the corpse floats like a corpse');
  assert.ok(diedAt != null);
  sim.dispose();
});

test('drowning: progress decays with the head out; shallow pools never drown', async () => {
  const { sim, events } = await makeSim({ seed: 4, level: base('t-drown2') });
  const c = sim.ctx;
  const d = spawnDonor(c, 'standard', 0, -3, 0);
  stepFor(sim, 1);
  d.drown01 = 0.6; d.drowningWarned = true;
  stepFor(sim, 1);
  const k = TUNABLES.donor.drownRecover;
  assert.ok(Math.abs(d.drown01 - (0.6 - k)) < 0.02, `decays at drownRecover (${d.drown01})`);
  assert.equal(events.filter((e) => e.type === 'donor:drowning').length, 0, 'no warning while decaying');
  assert.equal(d.alive, true);
  sim.dispose();
});

test('waves: regular waves open on clear OR after waveGap; fixed waves keep their time', async () => {
  const lvl = base('t-waves', {
    duration: 120, waveGap: 8,
    waves: [{ at: 0.5, count: 1 }, { at: 99, count: 1 }, { at: 99, count: 1 }, { at: 30, count: 1, types: { standard: 1 }, fixed: true }, { at: 99, count: 1, gap: 40 }],
  });
  const { sim, events } = await makeSim({ seed: 2, level: lvl });
  const opened = () => events.filter((e) => e.type === 'hatch:open').map((e) => e.payload);
  stepFor(sim, 8.0);
  assert.equal(opened().length, 1, 'second regular wave not yet (timer 8 s from 0.5 s)');
  stepFor(sim, 1.0);
  assert.equal(opened().length, 2, 'timer expired: second regular wave');
  // clear the drum: kill everyone; the third regular wave comes clearDelay + warning later
  for (const d of sim.ctx.donors) killDonor(sim.ctx, d, 'cut');
  const tKill = sim.ctx.time;
  for (let i = 0; i < 60 * 6 && opened().length < 3; i++) { sim.setInput({ rotate: 0 }); sim.step(); }
  const dt = sim.ctx.time - tKill;
  const T = sim.ctx.T.levels;
  assert.equal(opened().length, 3, 'clear drum: third wave brought forward');
  assert.ok(dt < T.clearDelay + T.waveWarning + 0.6, `on clear after ${dt.toFixed(2)} s`);
  assert.equal(opened()[2].wave, 2);
  // the fixed wave (index 3) opens at its own time even though a regular wave is still due
  for (let i = 0; i < 60 * 40 && !opened().some((p) => p.wave === 3); i++) { sim.setInput({ rotate: 0 }); sim.step(); }
  const fx = events.find((e) => e.type === 'hatch:open' && e.payload.wave === 3).payload;
  assert.ok(Math.abs(fx.t - 30) < 0.05, `fixed wave at its at (${fx.t})`);
  assert.ok(sim.state.mode.waves.nextIn != null, 'nextIn exposed while waves remain');
  sim.dispose();
});

test('donor:hurt is for the living; report headline tier = drops', async () => {
  const { sim, events } = await makeSim({ seed: 2, level: base('t-hurt') });
  const c = sim.ctx;
  const d = spawnDonor(c, 'standard', 0, -3, 0);
  stepFor(sim, 0.5);
  killDonor(c, d, 'cut');
  stepFor(sim, 0.5);
  const n0 = events.filter((e) => e.type === 'donor:hurt').length;
  damagePart(c, d.parts.thigh_l || d.partList[7], 30, 'cut', 'cut');
  stepFor(sim, 0.5);
  assert.equal(events.filter((e) => e.type === 'donor:hurt').length, n0, 'no donor:hurt for a corpse');
  sim.dispose();
  const { shiftReport } = await import('../src/sim/modes/report.js');
  const r = (stars) => shiftReport({ rng: { pick: (a) => a[0] }, eventCounts: {} }, { variant: null }, { stars, collected: 1, bonus: 0, fines: 0, drownings: 0, bestCombo: 0, causes: {} });
  assert.deepEqual([0, 1, 2, 3].map((s) => r(s).tier), [0, 1, 2, 3]);
  assert.equal(r(1).title, 'Quota met.');
  assert.equal(r(2).title, 'Meets expectations.');
  assert.equal(r(3).title, 'Operator of the Shift.');
});
