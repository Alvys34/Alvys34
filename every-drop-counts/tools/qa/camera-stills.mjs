#!/usr/bin/env node
// QA: camera stills at 1280x720 (upright at rest, tilted 45 deg at rest, full spin) + donor size in pixels.
//   node tools/qa/withserver.mjs tools/qa/camera-stills.mjs [--level 1] [--prefix fix2-camera]
// Donor size = the longest on-screen extent of each live donor's parts (centre +- radius), median.
import { launch, newPage, open, save, RAW, ROOT } from './lib.mjs';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const level = arg('level', '1'); const prefix = arg('prefix', 'fix2-camera');
const OUTDIR = resolve(ROOT, 'docs/progress');
const browser = await launch();
const results = {};
try {
  const page = await newPage(browser, 1280, 720);
  await open(page, `&quality=${arg('quality', 'medium')}&autostart=${level}`);
  await page.evaluate(() => {
    const E = window.__edc; E.setTimeScale(0);
    // on-screen size of live donors (px) + the camera's framing scale
    window.__measure = () => {
      const V = E.view.ctx; const cam = V.camera; const st = E.sim.state; const H = V.renderer.domElement.height / V.renderer.getPixelRatio();
      const W = V.renderer.domElement.width / V.renderer.getPixelRatio();
      const v = new V.THREE.Vector3(); const by = new Map();
      for (const p of st.parts) {
        const d = p.owner || p.donor; if (!d || d.alive === false || !d.parts) continue;
        const k = d.id; let b = by.get(k); if (!b) by.set(k, (b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }));
        const r = p.radius || 0.1;
        for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          const w = V.toWorld(p.x + dx, p.y + dy, p.z); v.set(w[0], w[1], w[2]).project(cam);
          const sx = (v.x * 0.5 + 0.5) * W; const sy = (0.5 - v.y * 0.5) * H;
          b.x0 = Math.min(b.x0, sx); b.x1 = Math.max(b.x1, sx); b.y0 = Math.min(b.y0, sy); b.y1 = Math.max(b.y1, sy);
        }
      }
      const sizes = [...by.values()].map((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0)).sort((a, b) => a - b);
      // reference: a 1.7 m upright figure at mid-depth (z = 0)
      const camZ = cam.position.z; const ref = (1.7 / (2 * Math.tan((cam.fov * Math.PI) / 360) * camZ)) * H;
      const rig = V.cameraRig;
      return { donors: sizes.length, medianPx: sizes.length ? +sizes[sizes.length >> 1].toFixed(1) : null, maxPx: sizes.length ? +sizes[sizes.length - 1].toFixed(1) : null,
        ref17mPx: +ref.toFixed(1), camZ: +camZ.toFixed(3), scale: +rig.scale.toFixed(4), thetaDeg: +(st.drum.theta * 180 / Math.PI).toFixed(1), omega: +st.drum.omega.toFixed(3) };
    };
  });
  const steps = (n, rotate = 0, brake = false, renderEvery = 6) => page.evaluate(({ n: k, rotate: r, brake: b, every }) => {
    const E = window.__edc; E.setInput({ rotate: r, brake: b });
    for (let i = 0; i < k; i += every) E.step(Math.min(every, k - i), true); // the camera sees every 0.1 s
  }, { n, rotate, brake, every: renderEvery });
  const shotTo = async (name) => {
    const m = await page.evaluate(() => window.__measure());
    const data = await page.evaluate(() => document.getElementById('game').toDataURL('image/png'));
    const file = resolve(OUTDIR, `${prefix}-${name}.png`);
    writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    results[name] = { file: file.replace(ROOT + '/', ''), ...m };
    console.log(name, JSON.stringify(results[name]));
  };
  // let the first donors arrive and settle (no render), then 3 s at rest so the camera tightens
  await page.evaluate(() => { const E = window.__edc; E.setInput({ rotate: 0 }); for (let i = 0; i < 8; i++) E.step(60, false); });
  await steps(150, 0, false, 10);
  await shotTo('upright-rest');
  // tilt to ~45 deg (rotate +1 = clockwise = negative theta), stop, rest 3 s
  await page.evaluate(() => { const E = window.__edc; for (let i = 0; i < 200; i++) { const th = E.sim.state.drum.theta; if (th > -0.74) { E.setInput({ rotate: 1 }); E.step(1, false); } else break; } });
  await steps(30, 0, true, 10);
  await steps(150, 0, false, 10);
  await shotTo('tilt45-rest');
  // full spin: 2 s at full input
  await steps(120, 1, false, 10);
  await shotTo('full-spin');
  results.errors = page.errs;
} finally { await browser.close(); }
save(resolve(RAW, `${prefix}.json`), results);
