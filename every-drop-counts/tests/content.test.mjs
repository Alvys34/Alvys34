/**
 * CONTENT tests: new hazards, donor types, props, Overtime, achievements.
 * Each test builds a tiny inline level and spawns what it needs directly (deterministic).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, runPolicy } from './helpers.mjs';
import { spawnDonor } from '../src/sim/donor.js';
import { createProp } from '../src/sim/props/index.js';
import { createBus } from '../src/core/bus.js';
import { ACHIEVEMENTS, createAchievementTracker } from '../src/core/achievements.js';

const base = (id, hazards, extra = {}) => ({
  id, number: 90, name: id, duration: 999, capacity: 150, quota: [1, 2, 3],
  hatch: { wall: 'back', x: 0, y: 0, offset: 1.2 }, hazards, waves: [], pa: [], ...extra,
});

/** step n seconds regardless of the shift status */
function stepFor(sim, seconds, inp = { rotate: 0 }) {
  for (let i = 0; i < Math.round(seconds * 60); i++) { sim.setInput(inp); sim.step(); }
}

function conservation(ctx) {
  const B = ctx.blood;
  let inBodies = 0;
  for (const d of ctx.donors) for (const p of d.partList) inBodies += p.blood;
  return Math.abs(B.collected + B.dissolved + B.pending + inBodies - B.donorTotal);
}

test('grinder: swallows a donor and converts ~100 % of the blood (over ~1.5 s per part)', async () => {
  const { sim, events } = await makeSim({ seed: 1, level: base('t-grinder', [{ type: 'grinder', wall: 'floor', at: 0, width: 3, z: [-2.5, 2.5] }]) });
  const d = spawnDonor(sim.ctx, 'standard', 0, -3.3, 0);
  let maxErr = 0;
  for (let i = 0; i < 60 * 14; i++) { sim.setInput({ rotate: 0 }); sim.step(); maxErr = Math.max(maxErr, conservation(sim.ctx)); }
  assert.equal(d.alive, false);
  assert.equal(d.cause, 'grind');
  assert.ok(events.filter((e) => e.type === 'grinder:swallow').length >= 8, 'most parts swallowed');
  const c = sim.ctx.blood;
  assert.ok(c.collected >= d.bloodMax * 0.95, `yield ${c.collected.toFixed(2)} / ${d.bloodMax}`);
  assert.ok(c.pending < 1e-6, 'nothing left in the machine');
  assert.ok(maxErr < 1e-6, `blood conservation (incl. pending) ${maxErr}`);
  assert.ok(events.some((e) => e.type === 'hazard:contact' && e.payload.hazard === 'grinder'));
  sim.dispose();
});

test('grinder: too much meat jams it, SLAM clears it', async () => {
  const { sim, events } = await makeSim({ seed: 2, level: base('t-clog', [{ type: 'grinder', wall: 'floor', at: 0, width: 3, z: [-2.5, 2.5] }]) });
  for (let k = 0; k < 3; k++) spawnDonor(sim.ctx, k === 0 ? 'bigGiver' : 'standard', -0.4 + k * 0.4, -3.2 + k * 0.6, -1 + k);
  let clogT = -1;
  for (let i = 0; i < 60 * 6 && clogT < 0; i++) { sim.setInput({ rotate: 0 }); sim.step(); if (events.some((e) => e.type === 'grinder:clog')) clogT = sim.ctx.time; }
  assert.ok(clogT > 0, 'grinder jammed');
  const g = sim.ctx.hazards[0];
  assert.equal(g.view.clogged, true);
  assert.equal(g.load > 0.5, true);
  assert.equal(sim.audioState().grinderLoad > 0.5, true);
  stepFor(sim, 1);
  assert.equal(g.view.clogged, true, 'stays jammed without a slam');
  sim.setInput({ slam: true }); sim.step();
  const clear = events.find((e) => e.type === 'grinder:clear');
  assert.ok(clear && clear.payload.bySlam === true, 'slam cleared the jam');
  stepFor(sim, 6);
  assert.ok(events.filter((e) => e.type === 'grinder:swallow').length > 4, 'it swallows again after clearing');
  assert.ok(conservation(sim.ctx) < 1e-6);
  sim.dispose();
});

test('crusher: telegraphs, then presses a donor on the opposite wall (cause crush)', async () => {
  const { sim, events } = await makeSim({ seed: 3, level: base('t-crusher', [{ type: 'crusher', wall: 'ceiling', at: 0, width: 3, z: [-2.5, 2.5], period: 4 }]) });
  const d = spawnDonor(sim.ctx, 'standard', 0, -4.0, 0);
  stepFor(sim, 5);
  const tel = events.findIndex((e) => e.type === 'hazard:telegraph' && e.payload.hazard === 'crusher');
  const stroke = events.findIndex((e) => e.type === 'crusher:stroke');
  assert.ok(tel >= 0 && stroke > tel, 'telegraph comes before the stroke');
  assert.equal(d.alive, false);
  assert.equal(d.cause, 'crush');
  assert.ok(events.some((e) => e.type === 'hazard:contact' && e.payload.hazard === 'crusher' && e.payload.pressed >= 1));
  assert.ok(sim.ctx.blood.collected > d.bloodMax * 0.4, 'pressing pops a lot of blood');
  const v = sim.ctx.hazards[0].view;
  assert.ok(['idle', 'telegraph', 'extend', 'hold', 'retract'].includes(v.state));
  sim.dispose();
});

test('rail saw: travels along its rail and cuts what it passes', async () => {
  const { sim, events } = await makeSim({ seed: 4, level: base('t-rail', [{ type: 'railSaw', wall: 'floor', from: -4, to: 4, z: [-2.5, 2.5], period: 4 }]) });
  const v = sim.ctx.hazards[0].view;
  const us = new Set();
  spawnDonor(sim.ctx, 'standard', 2, -3.0, 0);
  for (let i = 0; i < 60 * 5; i++) { sim.setInput({ rotate: 0 }); sim.step(); us.add(Math.round(v.u * 10)); }
  assert.ok(us.has(0) && us.has(10), 'carriage reaches both ends');
  assert.ok(events.some((e) => e.type === 'limb:sever'), 'it cut something');
  assert.ok(sim.audioState().sawLoad >= 0);
  sim.dispose();
});

test('inspector: a saw cracks the sphere (and flings it away)', async () => {
  const { sim, events } = await makeSim({ seed: 5, level: base('t-insp', [{ type: 'saw', wall: 'floor', at: 0, z: [-2.5, 2.5], radius: 1.2 }]) });
  const d = spawnDonor(sim.ctx, 'inspector', 0, 1.5, 0);
  assert.equal(d.encased, true);
  assert.ok(d.partList.every((p) => p.encased), 'parts are encased');
  assert.equal(sim.ctx.props.filter((p) => p.type === 'safetySphere').length, 1);
  stepFor(sim, 3);
  assert.ok(events.some((e) => e.type === 'sphere:crack' && e.payload.cause === 'saw'), 'cracked by the saw');
  assert.equal(d.alive, true, 'the sphere protected him');
  assert.ok(d.partList.every((p) => p.hp === p.hpMax), 'no damage reached him');
  sim.dispose();
});

test('inspector: 3 hits shatter the sphere, he becomes an ordinary ragdoll, his death = fine', async () => {
  const { sim, events } = await makeSim({ seed: 5, level: base('t-insp3', []) });
  const ctx = sim.ctx;
  const d = spawnDonor(ctx, 'inspector', 0, -3.5, 0);
  const sphere = ctx.props.find((p) => p.type === 'safetySphere');
  stepFor(sim, 1);
  sphere.onHazard(ctx, { hazard: 'spike', intensity: 1 });
  stepFor(sim, 0.6);
  sphere.onHazard(ctx, { hazard: 'spike', intensity: 1 });
  sphere.onHazard(ctx, { hazard: 'spike', intensity: 1 }); // inside the hit cooldown: ignored
  stepFor(sim, 0.6);
  assert.equal(events.filter((e) => e.type === 'sphere:crack').length, 2);
  assert.equal(d.encased, true);
  sphere.onHazard(ctx, { hazard: 'saw', intensity: 1 });
  assert.equal(events.filter((e) => e.type === 'sphere:shatter').length, 1, 'third hit shatters');
  assert.equal(d.encased, false);
  assert.ok(sphere.removed);
  assert.ok(d.partList.every((p) => !p.encased && p.body.isEnabled()), 'bodies are live again');
  stepFor(sim, 1);
  const chest = d.parts.chest;
  assert.ok(Math.abs(chest.y - chest.py) < 0.5 && chest.y > -5.2, 'ragdoll is simulated, still in the drum');
  const { damagePart } = await import('../src/sim/donor.js');
  damagePart(ctx, chest, 500, 'cut', 'cut');
  assert.equal(d.alive, false);
  const fine = events.find((e) => e.type === 'fine');
  assert.ok(fine && fine.payload.liters === 25 && fine.payload.reason === 'workplace-incident');
  assert.equal(ctx.scoring.kills, 0, 'an Inspector is never a kill');
  assert.equal(ctx.scoring.combo.best, 0);
  assert.equal(ctx.scoring.fines, 25);
  sim.dispose();
});

test('inspector: alive at shift end = +20 L compliance bonus, counted in the result', async () => {
  const lvl = base('t-insp2', [], { duration: 4, waves: [{ at: 0.2, count: 2, types: { inspector: 1, standard: 1 } }] });
  const { sim, events } = await makeSim({ seed: 6, level: lvl });
  stepFor(sim, 5);
  const end = events.find((e) => e.type === 'shift:end');
  assert.ok(end, 'shift ended');
  assert.ok(events.some((e) => e.type === 'bonus' && e.payload.reason === 'compliance' && e.payload.liters === 20));
  assert.ok(end.payload.liters >= 20, `liters ${end.payload.liters} include the bonus`);
  assert.equal(end.payload.inspectorsSaved, 1);
  assert.equal(end.payload.result, 'complete');
  assert.ok(end.payload.report && end.payload.report.lines.length > 3, 'results flavour text');
  sim.dispose();
});

test('oxygen tanks: puncture -> rocket ~2 s -> explode; a blast sets off the next tank (chain)', async () => {
  const { sim, events } = await makeSim({ seed: 7, level: base('t-tank', []) });
  const ctx = sim.ctx;
  const add = (pos) => { const p = createProp(ctx, { type: 'oxygenTank', pos }, ctx.nextPropId++); ctx.props.push(p); return p; };
  const a = add([-5, -4.6, 0]);
  stepFor(sim, 1);
  a.onHazard(ctx, { hazard: 'saw', intensity: 1 });
  assert.equal(a.view.state, 'punctured');
  assert.ok(events.some((e) => e.type === 'prop:puncture' && e.payload.cause === 'saw'));
  stepFor(sim, 0.5);
  assert.ok(a.view.thrust > 0 && !a.removed, 'rocketing');
  stepFor(sim, 1.8);
  assert.ok(a.removed, 'exploded after ~2 s');
  assert.equal(events.filter((e) => e.type === 'prop:explode').length, 1);
  // chain reaction: two tanks side by side, a donor next to them
  const c = add([2, -4.6, 0]);
  const e2 = add([3.4, -4.6, 0.4]);
  const d = spawnDonor(ctx, 'standard', 4.5, -3.9, 0);
  stepFor(sim, 0.5);
  c.onExplosion(ctx);
  stepFor(sim, 1.2);
  assert.ok(c.removed && e2.removed, 'both went off');
  assert.equal(events.filter((e) => e.type === 'prop:explode').length, 3);
  assert.ok(events.filter((e) => e.type === 'prop:puncture' && e.payload.cause === 'explosion').length >= 2, 'second tank punctured by the first blast');
  assert.ok(d.partList.some((p) => p.hp < p.hpMax), 'the blast hurt the donor');
  assert.ok(conservation(ctx) < 1e-6);
  sim.dispose();
});

test('donor types: Big Giver is big and bloody, Thin-Blood drains completely from a small cut', async () => {
  const { sim } = await makeSim({ seed: 8, level: base('t-types', []) });
  const ctx = sim.ctx;
  const big = spawnDonor(ctx, 'bigGiver', -4, -3, 0);
  const std = spawnDonor(ctx, 'standard', 0, -3.5, 0);
  const thin = spawnDonor(ctx, 'thinBlood', 4, -3.5, 0);
  assert.ok(big.bloodMax >= std.bloodMax * 1.9);
  const m = (d) => d.partList.reduce((s, p) => s + p.mass, 0);
  assert.ok(m(big) >= m(std) * 2.4);
  assert.ok(big.partList[0].slamScale < 1, 'hard to slam');
  // same small cut on the thigh of a standard and a thin-blood donor
  const { damagePart } = await import('../src/sim/donor.js');
  damagePart(ctx, std.parts.thighL, 20, 'cut', 'cut');
  damagePart(ctx, thin.parts.thighL, 20, 'cut', 'cut');
  stepFor(sim, 12);
  assert.ok(thin.parts.thighL.blood < thin.parts.thighL.bloodMax * 0.02, 'thin-blood thigh drained');
  assert.ok(std.parts.thighL.blood > std.parts.thighL.bloodMax * 0.2, 'standard thigh wound clotted');
  sim.dispose();
});

test('blunt trauma bruises (clots, little blood); open wounds bleed', async () => {
  const { sim } = await makeSim({ seed: 9, level: base('t-blunt', []) });
  const ctx = sim.ctx;
  const a = spawnDonor(ctx, 'standard', -3, -3.5, 0);
  const b = spawnDonor(ctx, 'standard', 3, -3.5, 0);
  const { damagePart } = await import('../src/sim/donor.js');
  damagePart(ctx, a.parts.chest, 200, 'blunt', 'impact'); // beaten to death on bare metal
  damagePart(ctx, b.parts.chest, 200, 'cut', 'cut');
  stepFor(sim, 10);
  assert.equal(a.alive, false); assert.equal(b.alive, false);
  const lostA = a.bloodMax - a.blood; const lostB = b.bloodMax - b.blood;
  assert.ok(lostA < a.bloodMax * 0.1, `blunt kill yields little (${lostA.toFixed(2)} L)`);
  assert.ok(lostB > b.bloodMax * 0.3, `cut kill bleeds (${lostB.toFixed(2)} L)`);
  assert.equal(ctx.scoring.combo.best, 1, 'only the cut kill started a Sponsor Match chain');
  sim.dispose();
});

test('overtime: the pump drains the tank, the run ends, score = litres, report present', async () => {
  const { sim, events } = await makeSim({ seed: 4, level: 'overtime' });
  let peakDrain = 0;
  runPolicy(sim, 'idle', 400, (s) => { peakDrain = Math.max(peakDrain, s.ctx.mode.drainRate); });
  assert.equal(sim.state.status, 'ended');
  const end = events.find((e) => e.type === 'shift:end');
  assert.equal(end.payload.mode, 'overtime');
  assert.equal(end.payload.result, 'failed');
  assert.ok(end.payload.time > 22 && end.payload.time < 300, `idle run lasted ${end.payload.time}s`);
  assert.ok(peakDrain > 0.3);
  assert.ok(end.payload.report && end.payload.report.lines.length >= 4);
  const snap = sim.snapshot();
  assert.ok(snap.overtime && snap.overtime.tank <= 0.001);
  sim.dispose();
});

test('achievements: definitions are Steam-safe, each unlock fires once, seeded ids never fire', () => {
  for (const a of ACHIEVEMENTS) {
    assert.match(a.id, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(a.title && a.description);
  }
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  assert.ok(ACHIEVEMENTS.length >= 12);
  const bus = createBus({ onError: (e) => { throw e; } });
  const got = [];
  bus.on('achievement', (p) => got.push(p.id));
  const tr = createAchievementTracker({ bus, unlocked: ['FIRST_SHIFT'] });
  bus.emit('shift:start', { levelId: 'shift-1', mode: 'shift' });
  bus.emit('combo', { count: 8, multiplier: 8 });
  bus.emit('combo', { count: 9, multiplier: 8 });
  for (let i = 0; i < 31; i++) bus.emit('limb:sever', { id: 1, part: 'x' });
  bus.emit('grinder:clog', {}); bus.emit('grinder:clear', { bySlam: true });
  bus.emit('prop:puncture', { cause: 'explosion' }); bus.emit('prop:explode', {});
  bus.emit('shift:end', { levelId: 'shift-1', levelNumber: 1, stars: 3, kills: 5, drownings: 0 });
  bus.emit('shift:end', { levelId: 'shift-1', levelNumber: 1, stars: 3, kills: 5, drownings: 0 });
  assert.deepEqual(got.sort(), ['PERCUSSIVE_MAINTENANCE', 'PRESSURE_EVENT', 'SOME_ASSEMBLY_REQUIRED', 'SPONSOR_MATCH_8'].sort());
  assert.ok(tr.isUnlocked('FIRST_SHIFT'));
  // perfect record from seeded bests + this run
  const save = { best: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`shift-${n}`, { stars: 3 }])) };
  const tr2 = createAchievementTracker({ bus, save });
  got.length = 0;
  bus.emit('shift:start', { levelId: 'shift-8', mode: 'shift' });
  bus.emit('shift:end', { levelId: 'shift-8', levelNumber: 8, stars: 3, kills: 30, inspectorsSaved: 2, inspectorDeaths: 0 });
  assert.ok(got.includes('PERFECT_RECORD') && got.includes('ALL_SHIFTS') && got.includes('FULLY_COMPLIANT'));
  tr.dispose(); tr2.dispose();
});

test('achievements: real sim events drive the tracker (grinder jam + slam)', async () => {
  const { sim, bus } = await makeSim({ seed: 2, level: base('t-ach', [{ type: 'grinder', wall: 'floor', at: 0, width: 3, z: [-2.5, 2.5] }]) });
  const got = [];
  bus.on('achievement', (p) => got.push(p.id));
  const tr = createAchievementTracker({ bus });
  for (let k = 0; k < 3; k++) spawnDonor(sim.ctx, k === 0 ? 'bigGiver' : 'standard', -0.4 + k * 0.4, -3.2 + k * 0.6, -1 + k);
  stepFor(sim, 4);
  sim.setInput({ slam: true }); sim.step();
  stepFor(sim, 0.2);
  assert.deepEqual(got.filter((id) => id === 'PERCUSSIVE_MAINTENANCE'), ['PERCUSSIVE_MAINTENANCE']);
  tr.dispose(); sim.dispose();
});
