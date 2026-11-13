/** Shared helpers for the Node sim tests (node --test tests/). */
import RAPIER from '@dimforge/rapier3d-compat';
import { createBus } from '../src/core/bus.js';
import { createSim } from '../src/sim/index.js';
import { POLICIES } from '../tools/simbot.mjs';

let ready = null;
export function initRapier() { return (ready ||= RAPIER.init()); }

/** Create a sim + bus that records every event. */
export async function makeSim({ seed = 1, level = 1, tunables = null } = {}) {
  await initRapier();
  const bus = createBus({ onError: (e) => { throw e; } });
  const events = [];
  bus.on('*', (type, payload) => events.push({ type, payload }));
  const sim = createSim({ RAPIER, bus, seed, tunables });
  if (level === 'overtime') sim.startOvertime(); else if (level != null) sim.loadLevel(level);
  return { sim, bus, events };
}

/** Run a policy for up to `seconds` (or until the shift ends); onStep(sim) after every step. */
export function runPolicy(sim, policy, seconds, onStep) {
  const pol = typeof policy === 'function' ? policy : POLICIES[policy];
  const mem = {};
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const st = sim.state;
    sim.setInput(pol(st, st.time, mem));
    sim.step();
    if (onStep) onStep(sim, i);
    if (sim.state.status === 'ended') return i + 1;
  }
  return n;
}

export function poseHash(sim) {
  let h = 0;
  for (const d of sim.ctx.dyns) {
    if (d.removed) continue;
    h = (h * 31 + Math.round(d.x * 1e4)) | 0;
    h = (h * 31 + Math.round(d.y * 1e4)) | 0;
    h = (h * 31 + Math.round(d.z * 1e4)) | 0;
  }
  return h;
}
