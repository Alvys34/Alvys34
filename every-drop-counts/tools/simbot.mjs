#!/usr/bin/env node
/**
 * Headless sim bot: runs a whole shift with a scripted policy and prints the outcome.
 *
 *   node tools/simbot.mjs --level 1 --policy spin [--seed 7] [--runs 3] [--json] [--overtime] [--max 300]
 *   npm run sim -- --level 2 --policy smart
 *
 * Policies: see tools/policies.mjs (idle spin rock tumble slamSpam flipper rockAim park smart);
 * all only use rotate/brake/slam. Prints litres, stars, kills, drownings, peak bodies, mean/max
 * step ms, pacing (longest stretch with nothing alive to process, fill at half time).
 * Matrix over all shifts/policies/seeds in parallel: node tools/botmatrix.mjs
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { createBus } from '../src/core/bus.js';
import { createSim } from '../src/sim/index.js';
import { listLevels } from '../src/sim/levels/index.js';

import { POLICIES } from './policies.mjs';

export { POLICIES };

export async function runBot({ level = 1, policy = 'idle', seed = 1, maxSeconds = 400, overtime = false, onStep = null } = {}) {
  await RAPIER.init();
  const bus = createBus();
  const counters = { sever: 0, impact: 0, events: 0, errors: 0 };
  bus.on('limb:sever', () => counters.sever++);
  bus.on('*', () => counters.events++);
  const sim = createSim({ RAPIER, bus, seed });
  if (overtime) sim.startOvertime(); else sim.loadLevel(level);
  const pol = POLICIES[policy];
  if (!pol) throw new Error(`unknown policy ${policy}`);
  const mem = {};
  let peakBodies = 0; let sum = 0; let max = 0; let n = 0; let maxSpeed = 0;
  let idleRun = 0; let maxIdle = 0; let fillHalf = null; let peakFill = 0;
  const steps = Math.round(maxSeconds * 60);
  const escapes = [];
  for (let i = 0; i < steps; i++) {
    const st = sim.state;
    const inp = pol(st, st.time, mem);
    sim.setInput(inp);
    const t0 = performance.now();
    sim.step();
    const ms = performance.now() - t0;
    sum += ms; n++; if (ms > max) max = ms;
    const c = sim.ctx;
    let bodies = 0;
    for (const d of c.dyns) {
      if (d.removed) continue;
      bodies++;
      const sp = Math.hypot(d.vx, d.vy, d.vz);
      if (sp > maxSpeed) maxSpeed = sp;
      if (Math.abs(d.x) > c.drum.hw + 0.6 || Math.abs(d.y) > c.drum.hh + 0.6 || Math.abs(d.z) > c.drum.hd + 0.6) {
        if (escapes.length < 5) escapes.push({ t: c.time, uid: d.uid, x: d.x, y: d.y, z: d.z });
      }
    }
    if (bodies > peakBodies) peakBodies = bodies;
    // pacing: time with no live product in the drum and nothing coming out of the hatch
    if (st.status === 'running') {
      const busy = c.aliveTargets > 0 || (c.mode.spawner && c.mode.spawner.pending > 0);
      idleRun = busy ? 0 : idleRun + c.dt;
      if (idleRun > maxIdle && c.time > 3) maxIdle = idleRun;
      const dur = c.mode.clock.duration;
      if (fillHalf == null && Number.isFinite(dur) && c.mode.clock.t >= dur / 2) fillHalf = c.pool.fill;
      if (c.pool.fill > peakFill) peakFill = c.pool.fill;
    }
    if (onStep) onStep(sim, i);
    if (st.status === 'ended' && st.time - (mem.endT ??= st.time) > 0.5) break;
  }
  const snap = sim.snapshot();
  const res = {
    level: overtime ? 'overtime' : level, policy, seed,
    result: snap.result ? snap.result.result : 'unfinished',
    liters: snap.liters, stars: snap.result ? snap.result.stars : 0, quota: snap.quota,
    collected: snap.collected, bonus: snap.bonus, donorBlood: snap.donorBloodTotal,
    kills: snap.kills, drownings: snap.drownings, severs: counters.sever, alive: snap.alive,
    time: snap.time, peakBodies, stepMsMean: +(sum / n).toFixed(3), stepMsMax: +max.toFixed(2),
    maxSpeed: +maxSpeed.toFixed(1), escapes: escapes.length, causes: snap.result ? snap.result.causes : null,
    maxIdle: +maxIdle.toFixed(1), fillHalf: fillHalf == null ? null : +fillHalf.toFixed(2), peakFill: +peakFill.toFixed(2),
    fines: snap.fines, inspectorDeaths: snap.result ? snap.result.inspectorDeaths : null,
    overtime: overtime ? { drainRate: sim.ctx.mode.drainRate, waves: sim.ctx.mode.waves.opened } : undefined,
  };
  sim.dispose();
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const has = (k) => args.includes(`--${k}`);
  if (has('help')) {
    console.log('usage: node tools/simbot.mjs --level 1 --policy idle|spin|rock|smart [--seed N] [--runs N] [--json] [--overtime]');
    console.log('levels:', listLevels().map((l) => `${l.number}:${l.name}`).join(', '));
    return;
  }
  const level = get('level', '1');
  const policies = (get('policy', 'idle')).split(',');
  const runs = Number(get('runs', '1'));
  const seed0 = Number(get('seed', '1'));
  const out = [];
  for (const policy of policies) {
    for (let r = 0; r < runs; r++) {
      const res = await runBot({ level, policy, seed: seed0 + r, overtime: has('overtime'), maxSeconds: Number(get('max', '400')) });
      out.push(res);
      if (!has('json')) {
        console.log(`[${res.level}] ${policy.padEnd(8)} seed=${res.seed} ${res.result.padEnd(9)} L=${res.liters.toFixed(1).padStart(6)} stars=${res.stars} quota=${JSON.stringify(res.quota)} `
          + `kills=${res.kills} drown=${res.drownings} severs=${res.severs} alive=${res.alive} t=${res.time.toFixed(1)}s idle(max)=${res.maxIdle}s fill@half=${res.fillHalf} `
          + `bodies(peak)=${res.peakBodies} step ms mean=${res.stepMsMean} max=${res.stepMsMax} vmax=${res.maxSpeed} escapes=${res.escapes}`);
      }
    }
  }
  if (has('json')) console.log(JSON.stringify(out, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
