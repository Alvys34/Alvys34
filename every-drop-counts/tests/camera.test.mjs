/**
 * Camera framing (PLAYTEST-1 M3, LOCAL-REPORT-1 §2.1): constant base framing, gentle tighten at
 * rest, no pumping. Drives src/render/camera.js with the pure drum model (tools/camera-log.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCameraScript } from '../tools/camera-log.mjs';

const HUD = { top: 0.12, left: 0.26, right: 0.24 };

for (const [name, opts] of [
  ['16:9', {}],
  ['16:9 + HUD plates', { hudInsets: HUD }],
  ['16:10 + HUD plates', { aspect: 1.6, hudInsets: HUD }],
  ['4:3', { aspect: 4 / 3 }],
  ['21:9 + HUD plates', { aspect: 2.37, hudInsets: HUD }],
  ['30 fps', { fps: 30 }],
]) {
  test(`camera: rest -> spin -> brake -> rest -> rock, ${name}`, () => {
    const { stats } = runCameraScript(opts);
    assert.ok(stats.maxChange025 <= 0.08, `scale changed ${(stats.maxChange025 * 100).toFixed(1)} % within 0.25 s (t=${stats.worstAt})`);
    assert.ok(stats.range <= 1.25 + 1e-6, `total scale range ${stats.range}`);
    assert.ok(stats.rockRange <= 1.01, `scale pumps while rocking: ${stats.rockRange}`);
    assert.ok(stats.rockMax <= 1.01, `rocking is not at the base framing: ${stats.rockMax}`);
    assert.ok(stats.spinScale[0] >= 0.999, 'never wider than the base framing');
    assert.ok(stats.restScaleEnd > 1.15, `tightens at rest upright: ${stats.restScaleEnd}`);
  });
}

test('camera: cameraZoomRange = 0 keeps the framing fixed', () => {
  const { stats } = runCameraScript({ cameraZoomRange: 0, hudInsets: HUD });
  assert.ok(stats.range <= 1.001, `range ${stats.range}`);
});

test('camera: at rest the tight framing never crops the drum', () => {
  const { log } = runCameraScript({ hudInsets: HUD });
  const rest = log.filter((e) => /^rest/.test(e.phase) && Math.abs(e.omega) < 1e-3);
  assert.ok(rest.length > 100);
  for (const e of rest) assert.ok(e.cropFree, `crop at rest t=${e.t}`);
});
