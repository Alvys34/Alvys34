#!/usr/bin/env node
/**
 * Camera framing log (Node, no GPU): drives src/render/camera.js with the pure drum model
 * (src/sim/drum.js stepDrum, live tunables) over a scripted run and measures the on-screen scale.
 *
 *   node tools/camera-log.mjs [--aspect 1.7778] [--hud] [--zoom 1] [--out file.json]
 *
 * Script: rest 3 s -> full spin 4 s -> brake 1.2 s -> rest 4 s -> rock +-45 deg for 20 s -> rest 3 s.
 * Scale = on-screen size of a mid-depth object (1 / camera z), relative to the base framing.
 * Reports: max scale change within any 0.25 s window, total range, range while rocking.
 * Also used by tests/camera.test.mjs (runCameraScript).
 */
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { createCameraRig } from '../src/render/camera.js';
import { createDrumState, stepDrum } from '../src/sim/drum.js';
import { TUNABLES } from '../src/core/tunables.js';

const DEG = Math.PI / 180;

export function runCameraScript({ aspect = 16 / 9, hudInsets = null, cameraZoomRange, screenShake = 1, fps = 60 } = {}) {
  const camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 200);
  const bus = { on: () => () => {}, emit() {} };
  const settings = { screenShake, hudInsets };
  if (cameraZoomRange != null) settings.cameraZoomRange = cameraZoomRange;
  const ctx = { camera, bus, settings, drumAngle: 0, drumGroup: new THREE.Group(), lastState: null };
  const rig = createCameraRig(ctx);
  const dt = TUNABLES.sim.dt;
  const sctx = { T: TUNABLES, drum: createDrumState(TUNABLES, 0), world: {}, emit() {}, dyns: [], parts: [], time: 0 };
  const state = { drum: sctx.drum };
  const phases = [
    ['rest', 3, () => ({ rotate: 0 })],
    ['spin', 4, () => ({ rotate: 1 })],
    ['brake', 1.2, () => ({ rotate: 0, brake: true })],
    ['rest2', 4, () => ({ rotate: 0 })],
    ['rock', 20, null],
    ['rest3', 3, () => ({ rotate: 0 })],
  ];
  const log = [];
  let t = 0; let rockCenter = 0; let rockDir = 1;
  const stepsPerFrame = Math.max(1, Math.round(1 / fps / dt));
  for (const [name, secs, inputFn] of phases) {
    if (name === 'rock') { rockCenter = sctx.drum.theta; rockDir = 1; }
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      let inp;
      if (inputFn) inp = inputFn();
      else {
        // bang-bang rocking between center +- 45 deg (rotate +1 = clockwise = negative omega)
        // reverse once the predicted stopping point (reverse thrust) reaches the target
        const target = rockCenter + rockDir * 45 * DEG;
        const w = sctx.drum.omega; const D = TUNABLES.drum;
        const stopAt = sctx.drum.theta + Math.sign(w) * (w * w) / (2 * D.rotateAccel * (D.reverseBoost || 1));
        if ((rockDir > 0 && stopAt >= target) || (rockDir < 0 && stopAt <= target)) rockDir = -rockDir;
        inp = { rotate: rockDir > 0 ? -1 : 1 };
      }
      sctx.drum.input = { rotate: inp.rotate || 0, brake: !!inp.brake };
      stepDrum(sctx, dt);
      t += dt;
      if ((i + 1) % stepsPerFrame === 0) {
        ctx.drumAngle = sctx.drum.theta;
        rig.update(dt * stepsPerFrame, state);
        const z = 2.5 + rig.distance; // camera z without punch / shake (front plane at z = HD)
        log.push({ t: +t.toFixed(4), phase: name, theta: sctx.drum.theta, omega: sctx.drum.omega, dist: rig.distance, base: rig.baseDistance, camZ: z, scale: rig.scale, cropFree: rig.distance >= rig.requiredDistance - 1e-6 });
      }
    }
  }
  // on-screen scale of a mid-depth object relative to the base framing (punch excluded)
  const baseZ = 2.5 + log[0].base;
  for (const e of log) e.s = baseZ / e.camZ;
  return { log, stats: cameraStats(log), rig };
}

export function cameraStats(log, win = 0.25) {
  let worst = 0; let worstAt = 0; let j = 0;
  for (let i = 0; i < log.length; i++) {
    while (log[i].t - log[j].t > win + 1e-9) j++;
    for (let k = j; k < i; k++) {
      const r = Math.abs(log[i].s / log[k].s - 1);
      if (r > worst) { worst = r; worstAt = log[i].t; }
    }
  }
  const ss = log.map((e) => e.s);
  const rock = log.filter((e) => e.phase === 'rock');
  const rs = rock.map((e) => e.s);
  const restUp = log.filter((e) => e.phase === 'rest').map((e) => e.s);
  const spin = log.filter((e) => e.phase === 'spin').map((e) => e.s);
  return {
    maxChange025: +worst.toFixed(4), worstAt: +worstAt.toFixed(2),
    range: +(Math.max(...ss) / Math.min(...ss)).toFixed(4), minScale: +Math.min(...ss).toFixed(4), maxScale: +Math.max(...ss).toFixed(4),
    rockRange: +(Math.max(...rs) / Math.min(...rs)).toFixed(4), rockMax: +Math.max(...rs).toFixed(4),
    rockThetaDeg: [+(Math.min(...rock.map((e) => e.theta)) / DEG).toFixed(1), +(Math.max(...rock.map((e) => e.theta)) / DEG).toFixed(1)],
    restScaleEnd: +restUp[restUp.length - 1].toFixed(4), spinScale: [+Math.min(...spin).toFixed(4), +Math.max(...spin).toFixed(4)],
    cropFrames: log.filter((e) => !e.cropFree).length, frames: log.length,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const aspect = Number(arg('aspect', 16 / 9));
  const hud = process.argv.includes('--hud') ? { top: 0.12, left: 0.26, right: 0.24 } : null;
  const zoom = arg('zoom', null);
  const { log, stats } = runCameraScript({ aspect, hudInsets: hud, cameraZoomRange: zoom == null ? undefined : Number(zoom) });
  console.log(JSON.stringify(stats, null, 1));
  const out = arg('out', null);
  if (out) writeFileSync(out, JSON.stringify(log.map((e) => ({ t: e.t, phase: e.phase, theta: +e.theta.toFixed(4), omega: +e.omega.toFixed(3), dist: +e.dist.toFixed(4), s: +e.s.toFixed(4) }))));
}
