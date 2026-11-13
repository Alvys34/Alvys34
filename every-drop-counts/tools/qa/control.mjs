#!/usr/bin/env node
// QA: drum response to input (pure stepDrum with the live tunables). Prints tap/hold/brake tables and writes a trace.
import { createDrumState, stepDrum } from '../../src/sim/drum.js';
import { TUNABLES } from '../../src/core/tunables.js';
import { writeFileSync } from 'node:fs';
const dt = TUNABLES.sim.dt;
function run(script, secs = 4) {
  const ctx = { T: TUNABLES, drum: createDrumState(TUNABLES, 0), world: {}, emit() {}, dyns: [] };
  const tr = [];
  for (let i = 0; i < secs / dt; i++) {
    const t = i * dt; const inp = script(t);
    ctx.drum.input = { rotate: inp.rotate || 0, brake: !!inp.brake };
    stepDrum(ctx, dt);
    tr.push({ t: +t.toFixed(3), r: inp.rotate || 0, b: !!inp.brake, th: ctx.drum.theta, w: ctx.drum.omega });
  }
  return tr;
}
const deg = (r) => (r * 180 / Math.PI).toFixed(1);
const out = {};
console.log('TAP (hold rotate=1 for d s, release): total angle travelled, settle time');
for (const d of [1 / 60, 0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 1.0]) {
  const tr = run((t) => ({ rotate: t < d ? 1 : 0 }), 5);
  const fin = tr[tr.length - 1].th; const atRel = tr[Math.max(0, Math.round(d / dt) - 1)].th;
  const settle = tr.findIndex((x, i) => i > d / dt && Math.abs(x.w) < 0.01);
  console.log(` d=${d.toFixed(3)}s  angle at release ${deg(-atRel)}°  final ${deg(-fin)}°  coast ${deg(-(fin - atRel))}°  settles ${(settle * dt).toFixed(2)}s`);
  out[`tap${d}`] = tr;
}
console.log('FULL SPEED then release vs brake');
for (const brake of [false, true]) {
  const tr = run((t) => ({ rotate: t < 1.5 ? 1 : 0, brake: brake && t >= 1.5 }), 5);
  const at = tr[Math.round(1.5 / dt) - 1].th; const fin = tr[tr.length - 1].th;
  const settle = tr.findIndex((x, i) => i > 1.5 / dt && Math.abs(x.w) < 0.01);
  console.log(` brake=${brake}: overshoot after release ${deg(-(fin - at))}°  settle ${((settle * dt) - 1.5).toFixed(2)}s`);
  out[`full-brake${brake}`] = tr;
}
const tr = run((t) => ({ rotate: 1 }), 2);
const tmax = tr.findIndex((x) => Math.abs(x.w) >= TUNABLES.drum.maxOmega - 1e-6);
console.log(` time to max speed ${(tmax * dt).toFixed(2)}s; first-frame omega ${tr[0].w.toFixed(3)} rad/s; 180° flip from rest at full input takes ${(run((t) => ({ rotate: 1 }), 4).findIndex((x) => -x.th >= Math.PI) * dt).toFixed(2)}s`);
const rev = run((t) => ({ rotate: t < 1.5 ? 1 : -1 }), 3);
const zero = rev.findIndex((x, i) => i > 90 && x.w >= 0);
console.log(` reversal at full speed: omega crosses 0 after ${((zero - 90) * dt).toFixed(2)}s, travelling a further ${deg(-(rev[zero].th - rev[89].th))}°`);
writeFileSync(new URL('../../docs/qa/raw/control.json', import.meta.url), JSON.stringify(out));
