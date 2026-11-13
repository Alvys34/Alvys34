#!/usr/bin/env node
/**
 * Sim perf probe: step-time stats in windows (to see late-game cost), peak bodies.
 *   node tools/perf.mjs [level|overtime] [policy] [seed] [maxSeconds]
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { createBus } from '../src/core/bus.js';
import { createSim } from '../src/sim/index.js';
import { POLICIES } from './policies.mjs';

await RAPIER.init();
const [lvl = 'overtime', policy = 'smart', seed = '1', max = '600'] = process.argv.slice(2);
const sim = createSim({ RAPIER, bus: createBus(), seed: Number(seed) });
if (lvl === 'overtime') sim.startOvertime(); else sim.loadLevel(Number(lvl));
const pol = POLICIES[policy]; const mem = {};
let win = []; let peak = 0;
for (let i = 0; i < Number(max) * 60; i++) {
  const st = sim.state; sim.setInput(pol(st, st.time, mem));
  const t0 = performance.now(); sim.step(); win.push(performance.now() - t0);
  let n = 0; for (const d of sim.ctx.dyns) if (!d.removed) n++; peak = Math.max(peak, n);
  if (win.length === 3600 || sim.state.status === 'ended') {
    win.sort((a, b) => a - b);
    console.log(`t=${sim.ctx.time.toFixed(0)}s bodies=${n} peak=${peak} step ms mean=${(win.reduce((a, b) => a + b, 0) / win.length).toFixed(2)} p95=${win[Math.floor(win.length * 0.95)].toFixed(2)} max=${win[win.length - 1].toFixed(1)}`);
    win = [];
    if (sim.state.status === 'ended') break;
  }
}
