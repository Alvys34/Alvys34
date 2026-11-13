/**
 * Drum handling targets (PLAYTEST-1 M4, fix round 2). Pure stepDrum with the live tunables:
 * the drum must stop firmly after release (heavy machine, not ice), without losing its punch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrumState, stepDrum } from '../src/sim/drum.js';
import { TUNABLES } from '../src/core/tunables.js';

const dt = TUNABLES.sim.dt;
const DEG = 180 / Math.PI;

function run(script, secs = 4) {
  const ctx = { T: TUNABLES, drum: createDrumState(TUNABLES, 0), world: {}, emit() {}, dyns: [] };
  const tr = [];
  for (let i = 0; i < Math.round(secs / dt); i++) {
    const inp = script(i * dt);
    ctx.drum.input = { rotate: inp.rotate || 0, brake: !!inp.brake };
    stepDrum(ctx, dt);
    tr.push({ th: ctx.drum.theta, w: ctx.drum.omega });
  }
  return tr;
}

/** release after n steps: { total, after (deg), settle (s until omega == 0) } */
function release(tr, n) {
  const at = -tr[n - 1].th; const fin = -tr[tr.length - 1].th;
  const st = tr.findIndex((x, i) => i >= n && x.w === 0);
  return { total: fin * DEG, after: (fin - at) * DEG, settle: (st - n + 1) * dt };
}

test('handling: a 0.25 s tap travels <= 18° in total, <= 8° of it after release', () => {
  const r = release(run((t) => ({ rotate: t < 0.25 ? 1 : 0 })), Math.round(0.25 / dt));
  assert.ok(r.total <= 18, `tap total ${r.total.toFixed(1)}°`);
  assert.ok(r.after <= 8, `tap coast ${r.after.toFixed(1)}°`);
});

test('handling: release from full speed coasts <= 15° and settles within 0.45 s; Brake <= 5°', () => {
  const n = 90; // 1.5 s at full input = full speed
  const free = release(run((t) => ({ rotate: t < 1.5 ? 1 : 0 })), n);
  assert.ok(free.after <= 15, `coast ${free.after.toFixed(1)}°`);
  assert.ok(free.settle > 0 && free.settle <= 0.45, `settle ${free.settle.toFixed(2)} s`);
  const brake = release(run((t) => ({ rotate: t < 1.5 ? 1 : 0, brake: t >= 1.5 })), n);
  assert.ok(brake.after <= 5, `brake coast ${brake.after.toFixed(1)}°`);
});

test('handling: full speed <= 0.45 s, 180° flip <= 1.7 s, first-frame kick unchanged', () => {
  const tr = run(() => ({ rotate: 1 }));
  const tMax = (tr.findIndex((x) => Math.abs(x.w) >= TUNABLES.drum.maxOmega - 1e-6) + 1) * dt;
  const flip = (tr.findIndex((x) => -x.th >= Math.PI) + 1) * dt;
  assert.ok(tMax <= 0.45, `time to full speed ${tMax.toFixed(2)} s`);
  assert.ok(flip <= 1.7, `180° flip ${flip.toFixed(2)} s`);
  // first frame: rotateKick + one step of acceleration (clockwise = negative omega)
  const D = TUNABLES.drum;
  assert.ok(Math.abs(tr[0].w - -(D.rotateKick + D.rotateAccel * dt)) < 1e-9, `first-frame omega ${tr[0].w}`);
});
