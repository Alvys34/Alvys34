#!/usr/bin/env node
// QA: one page session, fresh save, real UI flow: shifts 1..8 (smart bot, retry on 0 drops) -> ending sting -> credits
// -> Overtime to dry -> initials. Samples heap / renderer memory / bodies / step time; screenshots the ending + OT report.
import { launch, newPage, open, key, shot, topScreen, focusedText, sleep, state, RAW } from './lib.mjs';
import { writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
const LOG = resolve(RAW, 'longsession.log'); writeFileSync(LOG, '');
const log = (o) => { const s = JSON.stringify(o); appendFileSync(LOG, s + '\n'); console.log(s); };
const b = await launch();
const samples = [];
try {
  const p = await newPage(b, 1280, 720, { storage: '' });
  await open(p);
  await p.evaluate(async () => { window.__qaP = (await import('/tools/qa/personas.js')).PERSONAS; window.__qaEvN = {}; for (const t of ['donor:death', 'achievement', 'shift:end', 'pa:announce']) window.__edc.bus.on(t, () => { window.__qaEvN[t] = (window.__qaEvN[t] || 0) + 1; }); });
  const sample = (tag) => p.evaluate((tag) => {
    const e = window.__edc; const r = e.view.ctx && e.view.ctx.renderer; const g = e.getState();
    return { tag, t: +g.time.toFixed(1), screen: g.screen, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null,
      geo: r ? r.info.memory.geometries : g.render.geometries, tex: r ? r.info.memory.textures : g.render.textures, programs: r && r.info.programs ? r.info.programs.length : null,
      calls: g.render.calls, tris: g.render.triangles, bodies: g.bodies, debris: g.debris, droplets: g.droplets, dom: document.getElementsByTagName('*').length,
      rapier: e.sim.ctx && e.sim.ctx.world ? e.sim.ctx.world.bodies.len() : null, colliders: e.sim.ctx && e.sim.ctx.world ? e.sim.ctx.world.colliders.len() : null, errors: g.errors, ev: { ...window.__qaEvN } };
  }, tag);
  const play = async (tag, maxSteps) => {
    let worst = 0; let sum = 0; let n = 0;
    for (let done = 0; done < maxSteps; done += 600) {
      const r = await p.evaluate(() => {
        const e = window.__edc; const m = (window.__qaM = window.__qaM || {}); let w = 0; let sm = 0; let k = 0;
        for (; k < 600; k++) { const s = e.sim.state; if (s.status === 'ended') break; e.setInput(window.__qaP.smart(s, s.time, m)); e.ui.frame(1 / 60); const t0 = performance.now(); e.step(1, false); const dt = performance.now() - t0; sm += dt; if (dt > w) w = dt; }
        e.step(1, true);
        return { w, sm, k, ended: e.sim.state.status === 'ended' };
      });
      worst = Math.max(worst, r.w); sum += r.sm; n += r.k;
      const s = await sample(tag); s.stepMean = +(r.sm / Math.max(1, r.k)).toFixed(2); s.stepMax = +r.w.toFixed(1); samples.push(s); log(s);
      if (r.ended) break;
    }
    await p.evaluate(() => { window.__qaM = {}; });
    return { mean: sum / Math.max(1, n), worst };
  };
  await key(p, 'Enter', 1500); // boot -> title
  await key(p, 'Enter', 1500); // clock in -> briefing 1
  let shiftN = 1; let tries = 0;
  while (shiftN <= 8) {
    if ((await topScreen(p)) !== 'briefing') { log({ warn: 'expected briefing', top: await topScreen(p), focus: await focusedText(p) }); await p.evaluate((n) => window.__edc.ui.debug.brief(n), shiftN); await sleep(800); }
    await key(p, 'Enter', 800);
    await p.evaluate(() => window.__edc.loop.stop());
    const st = await play(`s${shiftN}`, 60 * 160);
    for (let k = 0; k < 160; k++) await p.evaluate(() => { const e = window.__edc; e.ui.frame(1 / 60); e.step(1, false); });
    await p.evaluate(() => window.__edc.loop.start());
    for (let i = 0; i < 40 && (await state(p)).screen !== 'results'; i++) await sleep(500);
    await sleep(5000);
    const g = await state(p);
    const rep = await p.evaluate(() => document.querySelector('.screens').innerText.replace(/\n+/g, ' / ').slice(0, 300));
    log({ shift: shiftN, liters: g.liters, stars: g.stars, stepMean: +st.mean.toFixed(2), stepWorst: +st.worst.toFixed(1), focus: await focusedText(p), rep });
    if (shiftN === 8 && g.stars > 0) {
      await shot(p, 'ls-s8-report');
      // Clock out -> ending
      log({ s8focus: await focusedText(p) });
      await key(p, 'Enter', 300);
      for (let i = 0; i < 6; i++) { await sleep(2500); await p.evaluate(() => window.__edc.loop.stop()); await shot(p, `ls-ending-${i}`); log({ ending: i, screen: (await state(p)).screen, top: await topScreen(p), text: await p.evaluate(() => document.querySelector('.screens').innerText.replace(/\n+/g, ' / ').slice(0, 200)) }); await p.evaluate(() => window.__edc.loop.start()); }
      for (let i = 0; i < 40 && (await topScreen(p)) !== 'credits'; i++) await sleep(1000);
      log({ afterEnding: await topScreen(p), screen: (await state(p)).screen });
      await shot(p, 'ls-after-ending');
      break;
    }
    if (g.stars > 0) { shiftN++; tries = 0; await key(p, 'Enter', 1500); } else { tries++; if (tries > 2) { log({ fail: shiftN }); break; } await key(p, 'ArrowRight', 300); log({ retryFocus: await focusedText(p) }); await p.evaluate(() => window.__edc.ui.debug.brief); await p.evaluate(() => { const r = window.__edc.ui; r.startRun(r.run.ref); }); await sleep(500); await p.evaluate((n) => window.__edc.ui.debug.brief(n), shiftN); await sleep(800); }
  }
  // Overtime from the title
  await p.evaluate(() => window.__edc.ui.debug.toTitle()); await sleep(1000);
  log({ titleText: await p.evaluate(() => document.querySelector('.screens').innerText.replace(/\n+/g, ' / ').slice(0, 300)) });
  await p.evaluate(() => window.__edc.ui.startRun('overtime'));
  await p.evaluate(() => window.__edc.loop.stop());
  const ot = await play('ot', 60 * 900);
  for (let k = 0; k < 160; k++) await p.evaluate(() => { const e = window.__edc; e.ui.frame(1 / 60); e.step(1, false); });
  await p.evaluate(() => window.__edc.loop.start());
  for (let i = 0; i < 40 && (await state(p)).screen !== 'results'; i++) await sleep(500);
  await sleep(5000);
  await p.evaluate(() => window.__edc.loop.stop()); await shot(p, 'ls-ot-report'); await p.evaluate(() => window.__edc.loop.start());
  log({ ot: (await state(p)).liters, stepMean: ot.mean, stepWorst: ot.worst, top: await topScreen(p), focus: await focusedText(p), text: await p.evaluate(() => document.querySelector('.screens').innerText.replace(/\n+/g, ' / ').slice(0, 600)) });
  await p.keyboard.type('QA'); await key(p, 'Enter', 1500);
  log({ afterInitials: await topScreen(p), save: await p.evaluate(() => JSON.parse(localStorage.getItem('edc.save.v1')).overtime) });
  log({ final: await sample('final'), errs: p.errs.slice(0, 20), nErr: p.errs.length, warns: p.warns.slice(0, 20), nWarn: p.warns.length });
} finally { await b.close(); writeFileSync(resolve(RAW, 'longsession.json'), JSON.stringify(samples)); }
