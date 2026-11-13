#!/usr/bin/env node
/**
 * Balance diagnostics: death causes, damage by cause, litres timeline for one run.
 *   node tools/simdiag.mjs <level|overtime> <policy> [seed] [maxSeconds]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { createBus } from '../src/core/bus.js';
import { createSim } from '../src/sim/index.js';
import { POLICIES } from './simbot.mjs';

const EXTRA = {
  rockNoSlam: (s, t) => ({ rotate: Math.floor(t / 1.6) % 2 ? 1 : -1 }),
  slamOnly: (s) => ({ rotate: 0, slam: s.drum.slamCooldown <= 0 }),
};
await RAPIER.init();
const [lvlArg = '1', policy = 'rock', seedArg = '1', maxArg = '200'] = process.argv.slice(2);
const bus = createBus();
const causes = {}; const hurtBy = {}; const ev = {};
bus.on('donor:death', (p) => { causes[p.cause] = (causes[p.cause] || 0) + 1; });
bus.on('donor:hurt', (p) => { hurtBy[p.cause] = (hurtBy[p.cause] || 0) + p.amount; });
bus.on('*', (type) => { ev[type] = (ev[type] || 0) + 1; });
bus.on('bonus', (p) => { hurtBy['bonus:' + p.reason] = (hurtBy['bonus:' + p.reason] || 0) + p.liters; });
bus.on('fine', (p) => { hurtBy['fine:' + p.reason] = (hurtBy['fine:' + p.reason] || 0) + p.liters; });
const sim = createSim({ RAPIER, bus, seed: Number(seedArg) });
if (lvlArg === 'overtime') sim.startOvertime(); else sim.loadLevel(Number(lvlArg) || lvlArg);
const pol = POLICIES[policy] || EXTRA[policy];
const mem = {};
const timeline = [];
for (let i = 0; i < 60 * Number(maxArg); i++) {
  const st = sim.state; sim.setInput(pol(st, st.time, mem)); sim.step();
  if (i % 600 === 0) timeline.push(`${st.time.toFixed(0)}s:${sim.ctx.blood.collected.toFixed(0)}L/k${sim.ctx.scoring.kills}/f${sim.ctx.pool.fill.toFixed(2)}`);
  if (sim.state.status === 'ended') break;
}
const s = sim.snapshot();
console.log(`${lvlArg} ${policy} seed=${seedArg} result=${s.result && s.result.result} stars=${s.stars} L=${s.liters} collected=${s.collected} bonus=${s.bonus} fines=${s.fines} time=${s.time} kills=${s.kills} drown=${s.drownings} donorBlood=${s.donorBloodTotal}`);
console.log(' deaths', JSON.stringify(causes));
console.log(' damage/bonus', JSON.stringify(Object.fromEntries(Object.entries(hurtBy).map(([k, v]) => [k, Math.round(v)]))));
console.log(' ', timeline.join(' '));
if (process.argv.includes('--events')) console.log(' events', JSON.stringify(ev));
sim.dispose();
