#!/usr/bin/env node
/**
 * QA: play one shift as a scripted human and capture full-page frames (HUD included) + a trace.
 *   node tools/qa/persona.mjs --level 1 --persona cautious --tag s1-cautious [--sample 30] [--coarseAfter 45 --coarse 60]
 *        [--w 1280 --h 720] [--seed 1] [--max 200] [--fresh]   (dev server on QA_PORT, default 5179)
 * Output: docs/qa/raw/<tag>/f<step>.jpg, trace.json (per-sample state), events.json (bus), report.png
 */
import { launch, newPage, open, tapBus, RAW, sleep } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const level = get('level', '1'); const persona = get('persona', 'cautious');
const tag = get('tag', `s${level}-${persona}`);
const sample = Number(get('sample', '30')); const coarseAfter = Number(get('coarseAfter', '1e9')); const coarse = Number(get('coarse', '60'));
const W = Number(get('w', '1280')); const H = Number(get('h', '720'));
const maxS = Number(get('max', '400')); const seed = get('seed', '1');
const noShots = args.includes('--noshots');
const dir = resolve(RAW, tag); mkdirSync(dir, { recursive: true });

const browser = await launch();
const t0 = Date.now();
try {
  const page = await newPage(browser, W, H);
  await page.goto(`http://localhost:${process.env.QA_PORT || 5179}/?debug=1&seed=${seed}${get('query', '')}`);
  await page.waitForFunction(() => window.__edc && window.__edc.getState, null, { timeout: 120000 });
  await page.evaluate(() => window.__edc.ready);
  await page.evaluate(async () => { window.__qaP = (await import('/tools/qa/personas.js')).PERSONAS; });
  await tapBus(page);
  await page.evaluate((lv) => { const e = window.__edc; e.loop.stop(); lv === 'overtime' ? e.startOvertime() : e.loadLevel(Number(lv)); }, level);
  const trace = [];
  let i = 0;
  while (true) {
    const fine = (await page.evaluate(() => window.__edc.sim.state.time)) < coarseAfter;
    const n = fine ? sample : coarse;
    const row = await page.evaluate(([n, name]) => {
      const e = window.__edc; const P = window.__qaP[name]; window.__qaMem = window.__qaMem || {};
      let inp = { rotate: 0 };
      const acc = { rot: 0, slams: 0, brake: 0 };
      for (let k = 0; k < n; k++) {
        const s = e.sim.state;
        if (s.status === 'running') inp = P(s, s.time, window.__qaMem) || { rotate: 0 }; else inp = { rotate: 0 };
        e.setInput({ rotate: inp.rotate || 0, brake: !!inp.brake, slam: !!inp.slam });
        acc.rot += inp.rotate || 0; if (inp.slam) acc.slams++; if (inp.brake) acc.brake++;
        e.ui.frame(1 / 60);
        if (k % 6 === 5) e.ui.update(6 / 60); // HUD count-ups, bubbles, PA ticker run on real dt
        e.step(1, k === n - 1);
      }
      const g = e.getState();
      const hud = document.querySelector('.edc-ui');
      const q = (sel) => { const el = hud.querySelector(sel); return el && el.offsetParent !== null ? el.innerText.replace(/\s+/g, ' ').trim() : null; };
      return { t: +g.time.toFixed(2), screen: g.screen, status: g.status, theta: +g.drum.theta.toFixed(3), omega: +g.drum.omega.toFixed(3), rotIn: +(acc.rot / n).toFixed(2), slamPress: acc.slams,
        liters: +g.liters.toFixed(1), stars: g.stars, kills: g.kills, alive: g.alive, donorsLeft: g.donorsLeft, drown: g.drownings, fill: +g.fill.toFixed(3), bodies: g.bodies, slamReady: g.slam.ready, combo: g.combo.multiplier,
        prompt: q('.prompt'), pa: q('.pa'), clock: g.clock && +g.clock.left.toFixed(1), errors: g.errors, calls: g.render.calls, tris: g.render.triangles, droplets: g.droplets, ot: g.overtime };
    }, [n, persona]);
    trace.push(row);
    if (!noShots) await page.screenshot({ path: resolve(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 78 });
    i++;
    if (row.status === 'ended' && (row.screen === 'results' || row.t > maxS + 3)) break;
    if (row.t > maxS) break;
    if (Date.now() - t0 > 560000) { console.log('time budget hit'); break; }
  }
  const ev = await page.evaluate(() => window.__qaEv);
  writeFileSync(resolve(dir, 'trace.json'), JSON.stringify(trace));
  writeFileSync(resolve(dir, 'events.json'), JSON.stringify(ev));
  // results screen: let the real loop run so the report animates in
  await page.evaluate(() => window.__edc.loop.start());
  for (let k = 0; k < 40; k++) { const sc = await page.evaluate(() => window.__edc.getState().screen); if (sc === 'results') break; await sleep(500); }
  await sleep(7000);
  await page.evaluate(() => window.__edc.loop.stop());
  await page.screenshot({ path: resolve(dir, 'report.png') });
  const rep = await page.evaluate(() => { const el = document.querySelector('.screens'); return el ? el.innerText : ''; });
  writeFileSync(resolve(dir, 'report.txt'), rep);
  const last = trace[trace.length - 1];
  const firstKill = ev.find((e) => e.type === 'donor:death');
  const counts = {}; for (const e of ev) counts[e.type] = (counts[e.type] || 0) + 1;
  console.log(JSON.stringify({ tag, frames: i, last, firstKillT: firstKill && firstKill.simT, deathCauses: ev.filter((e) => e.type === 'donor:death').map((e) => e.p.cause).reduce((a, c) => (a[c] = (a[c] || 0) + 1, a), {}), counts, errs: page.errs.slice(0, 5), warns: page.warns.slice(0, 5), wall: Math.round((Date.now() - t0) / 1000) }));
} finally { await browser.close(); }
