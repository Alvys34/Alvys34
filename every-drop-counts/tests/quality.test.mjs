/**
 * Auto-quality governor (src/render/quality.js) with synthetic frame-time sequences
 * (LOCAL-REPORT-1 §1 "Auto-quality governor"): fast to its floor, pixel ratio first when GPU-bound,
 * pixel scale kept across preset changes, no ping-pong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQualityGovernor, PIXEL_STEPS, QUALITY_ORDER, pickStart } from '../src/render/quality.js';

function rig(start = 'high') {
  const s = { preset: start, level: 0, pixel: 1, events: [] };
  const gov = createQualityGovernor({
    getPreset: () => s.preset,
    applyPreset: (n) => { s.preset = n; s.events.push(['preset', n]); },
    applyLevel: (l) => { s.level = l; },
    applyPixelScale: (p) => { s.pixel = p; s.events.push(['pixel', p]); },
  });
  s.gov = gov;
  s.t = 0;
  /** run `seconds` of frames; msFn(s) -> frame ms (may depend on the current quality); cost optional */
  s.run = (seconds, msFn, costFn = null) => {
    const end = s.t + seconds;
    while (s.t < end) {
      const ms = typeof msFn === 'function' ? msFn(s) : msFn;
      s.t += ms / 1000;
      gov.frame(ms / 1000, costFn ? costFn(s, ms) : null);
    }
  };
  s.atFloor = () => s.preset === 'low' && s.pixel === PIXEL_STEPS[PIXEL_STEPS.length - 1] && s.level === 2;
  return s;
}

test('quality: from high at 45 ms frames it reaches its floor within 12 s', () => {
  const s = rig('high');
  let reached = -1;
  while (s.t < 12) { s.run(0.05, 45); if (reached < 0 && s.atFloor()) reached = s.t; }
  assert.ok(reached > 0, `not at floor after 12 s: ${s.preset} px ${s.pixel} load ${s.level}`);
  assert.ok(reached <= 12, `floor reached at ${reached.toFixed(2)} s`);
});

test('quality: GPU-bound -> pixel ratio is the first lever, and it survives preset changes', () => {
  const s = rig('high');
  s.run(10, 30, () => ({ simMs: 2, busyMs: 28 })); // 30 ms frames, sim only 2 ms: GPU-bound
  assert.equal(s.events[0][0], 'pixel', `first step was ${JSON.stringify(s.events[0])}`);
  const firstPreset = s.events.findIndex((e) => e[0] === 'preset');
  assert.ok(firstPreset > 0, 'stepped a preset eventually');
  // pixel scale is not reset by the preset change
  const pxBefore = s.events.slice(0, firstPreset).filter((e) => e[0] === 'pixel').pop()[1];
  assert.ok(pxBefore <= 0.6 + 1e-9, `pixel reached its floor (${pxBefore}) before the preset step`);
  assert.ok(!s.events.slice(firstPreset).some((e) => e[0] === 'pixel' && e[1] > pxBefore), 'pixel scale kept across the preset change');
});

test('quality: CPU-bound (sim-heavy) -> particle load first, pixel ratio last', () => {
  const s = rig('high');
  s.run(3, 30, () => ({ simMs: 20, busyMs: 29 }));
  assert.equal(s.level >= 1, true);
  assert.equal(s.pixel, 1);
});

test('quality: steady 8 ms frames never step down', () => {
  const s = rig('high');
  s.run(300, 8, () => ({ simMs: 1, busyMs: 3 }));
  assert.deepEqual(s.events, []);
  assert.equal(s.preset, 'high');
});

test('quality: steady 16.7 ms (vsync) with light main thread never steps down', () => {
  const s = rig('high');
  s.run(300, 16.7, () => ({ simMs: 1, busyMs: 3 }));
  assert.deepEqual(s.events, []);
});

test('quality: >2x over budget steps immediately, 1.2x waits the dwell', () => {
  const a = rig('high'); a.run(0.8, 50); assert.ok(a.events.length >= 1, 'stepped within 0.8 s at 50 ms');
  const b = rig('high'); b.run(1.2, 25); assert.equal(b.events.length, 0, 'no step within 1.2 s at 25 ms');
  b.run(1.5, 25); assert.ok(b.events.length >= 1, 'stepped after the dwell at 25 ms');
});

test('quality: after recovering it steps up at most once per 10 s', () => {
  const s = rig('high');
  s.run(10, 45);
  assert.ok(s.atFloor());
  const ups = [];
  const n0 = s.events.length;
  const t0 = s.t;
  s.run(200, 8, () => ({ simMs: 1, busyMs: 3 }));
  const hist = s.gov.history.filter((h) => h.dir === 'up');
  for (const h of hist) ups.push(h.t);
  assert.ok(ups.length >= 3, `recovered (${ups.length} up steps)`);
  for (let i = 1; i < ups.length; i++) assert.ok(ups[i] - ups[i - 1] >= 10 - 1e-6, `up steps ${ups[i - 1]} -> ${ups[i]}`);
  assert.ok(s.events.length > n0 && s.t > t0);
  assert.equal(s.preset, 'high', 'back at the player preset');
  assert.equal(s.pixel, 1);
});

test('quality: no ping-pong when the last up step is too expensive', () => {
  const s = rig('high');
  // cost model: the full high preset at pixel 1 is over budget (30 ms), one step lower is fine (12 ms)
  const ms = (st) => (st.preset === 'high' && st.pixel === 1 ? 30 : 12);
  s.run(240, ms, (st, m) => ({ simMs: 1, busyMs: m > 20 ? 25 : 4 }));
  const h = s.gov.history;
  const ups = h.filter((e) => e.dir === 'up').map((e) => e.t);
  for (let i = 1; i < ups.length; i++) assert.ok(ups[i] - ups[i - 1] >= 10, 'up steps at least 10 s apart');
  assert.ok(ups.length <= 4, `oscillated ${ups.length} times in 240 s (${JSON.stringify(h)})`);
  // the waits grow (backoff)
  for (let i = 2; i < ups.length; i++) assert.ok(ups[i] - ups[i - 1] >= (ups[i - 1] - ups[i - 2]) * 1.5, `backoff ${JSON.stringify(ups)}`);
});

test('quality: never above the player preset', () => {
  const s = rig('medium');
  s.run(120, 8);
  assert.equal(s.preset, 'medium');
  assert.ok(QUALITY_ORDER.includes(s.preset));
});

test('quality: benchmark picks the start preset and pixel scale', () => {
  assert.deepEqual(pickStart(8), { presetSteps: 0, pixelSteps: 0 });
  assert.deepEqual(pickStart(16.7), { presetSteps: 0, pixelSteps: 0 });
  assert.deepEqual(pickStart(30), { presetSteps: 1, pixelSteps: 0 });
  assert.deepEqual(pickStart(43), { presetSteps: 2, pixelSteps: 0 });
  assert.deepEqual(pickStart(70), { presetSteps: 2, pixelSteps: 2 });
  const fast = rig('high'); fast.gov.benchmark(1.5); fast.run(2.5, 16.7); assert.equal(fast.preset, 'high'); assert.ok(fast.gov.benchResult);
  const slow = rig('high'); slow.gov.benchmark(1.5); slow.run(2.5, 45);
  assert.equal(slow.preset, 'low'); assert.ok(!slow.gov.benchmarking);
  // skipped (warm-up) frames do not count
  const sk = rig('high'); sk.gov.benchmark(1.5);
  for (let i = 0; i < 100; i++) sk.gov.frame(0.2, { skip: true });
  assert.ok(sk.gov.benchmarking); sk.run(2, 16.7); assert.equal(sk.preset, 'high');
  // after a slow benchmark it can still recover to the player's preset
  slow.run(120, 8);
  assert.equal(slow.preset, 'high');
});
