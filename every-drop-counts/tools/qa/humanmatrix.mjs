#!/usr/bin/env node
// QA: headless "human" personas (latency/noise versions of the bots) across shifts and seeds.
//   node tools/qa/humanmatrix.mjs [--levels 1,2] [--seeds 2] [--personas masher,cautious,avg]
import RAPIER from '@dimforge/rapier3d-compat';
import { createBus } from '../../src/core/bus.js';
import { createSim } from '../../src/sim/index.js';
import { POLICIES } from '../policies.mjs';
const args = process.argv.slice(2); const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const levels = get('levels', '1,2,3,4,5,6,7,8').split(','); const seeds = Number(get('seeds', '2'));
const ready = (s) => s.drum.slamCooldown <= 0;
const lagged = (inner, lat, noise) => (s, t, m) => {
  if (t < 3) return { rotate: 0 };
  if (m.next == null || t >= m.next) { m.next = t + lat; m.mi = m.mi || {}; m.cur = inner(s, t, m.mi) || { rotate: 0 }; m.rng = ((m.rng || 12345) * 16807) % 2147483647; if (noise && m.rng / 2147483647 < noise) m.cur = { rotate: m.cur.rotate ? -m.cur.rotate : 1, slam: false }; }
  const o = { ...m.cur }; if (o.slam) m.cur = { ...m.cur, slam: false }; return o;
};
const P = {
  masher: (s, t) => ({ rotate: Math.floor(t / 3) % 2 ? -1 : 1, slam: ready(s) }),
  masher15: (s, t) => ({ rotate: Math.floor(t / 1.5) % 2 ? -1 : 1, slam: ready(s) }),
  holder: () => ({ rotate: 1 }),
  holdslam: (s) => ({ rotate: 1, slam: ready(s) }),
  cautious: (s, t, m) => { if (t < 6) return { rotate: 0 }; const k = Math.floor((t - 6) / 2.25); const inTap = (t - 6) % 2.25 < 0.25; const dir = Math.floor(k / 3) % 2 ? -1 : 1; const slam = t > 20 && Math.floor(t / 15) !== m.lb && ready(s); if (slam) m.lb = Math.floor(t / 15); return { rotate: inTap ? dir : 0, slam }; },
  thinker: lagged(POLICIES.smart, 0.3, 0),
  avg: lagged(POLICIES.smart, 0.6, 0.15),   // slower decisions, 15 % wrong-direction mistakes
};
const personas = get('personas', 'masher,masher15,holder,holdslam,cautious,thinker,avg').split(',');
await RAPIER.init();
const rows = [];
for (const lv of levels) for (const pn of personas) for (let sd = 1; sd <= seeds; sd++) {
  const bus = createBus(); let drown = 0; let insp = 0; bus.on('donor:death', (p) => { if (p.cause === 'drown') drown++; if (p.type === 'inspector') insp++; });
  const sim = createSim({ RAPIER, bus, seed: sd }); if (lv === 'ot') sim.startOvertime(); else sim.loadLevel(Number(lv));
  const m = {}; let endT = null;
  for (let i = 0; i < 60 * (lv === 'ot' ? 900 : 200); i++) { const s = sim.state; sim.setInput(P[pn](s, s.time, m)); sim.step(); if (s.status === 'ended') { endT ??= s.time; if (s.time - endT > 0.3) break; } }
  const sn = sim.snapshot();
  rows.push({ lv, pn, sd, L: +sn.liters.toFixed(1), stars: sn.stars, kills: sn.kills, drown, insp, t: +sn.time.toFixed(0) });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
