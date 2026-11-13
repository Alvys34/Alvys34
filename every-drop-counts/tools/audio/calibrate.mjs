import RAPIER from '@dimforge/rapier3d-compat';
import { createBus } from '../../src/core/bus.js';
import { createSim } from '../../src/sim/index.js';
import { POLICIES } from '../policies.mjs';
await RAPIER.init();
const levels = process.argv[2] ? process.argv[2].split(',') : ['1','2','3','4','5','6','7','8'];
const policy = process.argv[3] || 'smart';
const FIELDS = ['speed','mass','size','rate','amount','intensity','liters','pressed'];
const all = {};
let totalT = 0;
for (const lv of levels) {
  const bus = createBus();
  const st = {};
  bus.on('*', (type, p) => {
    const s = st[type] ||= { n: 0, v: {}, kinds: {} };
    s.n++;
    if (p.kind) s.kinds[p.kind] = (s.kinds[p.kind] || 0) + 1;
    if (p.hazard) s.kinds[p.hazard] = (s.kinds[p.hazard] || 0) + 1;
    if (p.cause) s.kinds[p.cause] = (s.kinds[p.cause] || 0) + 1;
    for (const f of FIELDS) if (typeof p[f] === 'number') (s.v[f] ||= []).push(p[f]);
    if (type === 'impact') (s.v.energy ||= []).push(p.speed * p.mass);
  });
  const sim = createSim({ RAPIER, bus, seed: 3 });
  if (lv === 'ot') sim.startOvertime(); else sim.loadLevel(Number(lv));
  const pol = POLICIES[policy]; const mem = {};
  let steps = 0;
  for (let i = 0; i < 60 * 400; i++) {
    sim.setInput(pol(sim.state, sim.state.time, mem)); sim.step(); steps++;
    if (sim.state.status === 'ended') break;
  }
  const T = steps / 60; totalT += T;
  const snap = sim.snapshot();
  console.log(`\n=== level ${lv} ${policy} t=${T.toFixed(0)}s liters=${snap.liters?.toFixed?.(1)} kills=${snap.kills}`);
  for (const [type, s] of Object.entries(st).sort()) {
    const a = all[type] ||= { n: 0, v: {}, kinds: {} };
    a.n += s.n; for (const k in s.kinds) a.kinds[k] = (a.kinds[k] || 0) + s.kinds[k];
    for (const f in s.v) (a.v[f] ||= []).push(...s.v[f]);
  }
}
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log(`\n##### ALL (${totalT.toFixed(0)} s)`);
for (const [type, s] of Object.entries(all).sort()) {
  let line = `${type.padEnd(18)} n=${String(s.n).padStart(6)} rate=${(s.n / totalT).toFixed(2).padStart(7)}/s`;
  if (Object.keys(s.kinds).length) line += ' ' + JSON.stringify(s.kinds);
  console.log(line);
  for (const [f, arr] of Object.entries(s.v)) console.log(`    ${f.padEnd(9)} min=${q(arr,0).toFixed(3)} p10=${q(arr,.1).toFixed(3)} p50=${q(arr,.5).toFixed(3)} p90=${q(arr,.9).toFixed(3)} p99=${q(arr,.99).toFixed(3)} max=${q(arr,1).toFixed(3)}`);
}
