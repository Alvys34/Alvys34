#!/usr/bin/env node
// QA sweep 2: every main screen at several window sizes (live resize in one page), real HUD + report.
import { launch, newPage, open, key, shot, topScreen, focusedText, sleep, state, RAW, noAnim } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const SIZES = [[1280, 720], [1280, 800], [1920, 1080], [2560, 1080], [1024, 768], [800, 600]];
const b = await launch();
const R = {};
const save = JSON.stringify({ version: 1, progress: { unlocked: 9 } });
try {
  const p = await newPage(b, 1280, 720, { storage: save });
  await open(p);
  await noAnim(p);
  const overflow = () => p.evaluate(() => {
    // elements whose text is clipped (scrollWidth > clientWidth) or that leave the viewport
    const out = [];
    for (const el of document.querySelectorAll('.edc-ui *')) {
      if (!el.offsetParent || !el.childElementCount && !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const clipped = (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') || (el.scrollHeight > el.clientHeight + 1 && cs.overflowY === 'hidden');
      const off = r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1;
      if ((clipped || off) && el.textContent.trim()) out.push({ cls: el.className && String(el.className).slice(0, 40), txt: el.textContent.trim().slice(0, 50), clipped, off });
    }
    return out.slice(0, 12);
  });
  const all = async (name) => {
    R[name] = {};
    for (const [w, h] of SIZES) {
      await p.setViewportSize({ width: w, height: h });
      await p.evaluate(() => { window.__edc.loop.stop(); window.dispatchEvent(new Event('resize')); window.__edc.step(0, true); window.__edc.step(0, true); });
      await sleep(300);
      await shot(p, `rs-${name}-${w}x${h}`);
      R[name][`${w}x${h}`] = await overflow();
    }
    await p.setViewportSize({ width: 1280, height: 720 });
    await p.evaluate(() => { window.dispatchEvent(new Event('resize')); window.__edc.loop.start(); });
    await sleep(400);
  };
  await key(p, 'Enter', 1500);
  await all('title');
  await p.evaluate(() => window.__edc.ui.debug.toShiftSelect()); await sleep(800);
  await all('shiftselect');
  await p.evaluate(() => window.__edc.ui.debug.brief(7)); await sleep(800);
  await all('briefing7');
  await p.evaluate(async () => { window.__qaP = (await import('/tools/qa/personas.js')).PERSONAS; });
  await key(p, 'Enter', 1000);
  await p.evaluate(() => { const e = window.__edc; e.loop.stop(); const m = {}; for (let k = 0; k < 60 * 34; k++) { const s = e.sim.state; const i = window.__qaP.thinker(s, s.time, m); e.setInput(i); e.ui.frame(1 / 60); e.step(1, false); if (k % 6 === 5) e.ui.update(0.1); } e.step(1, true); });
  R.hudState = await state(p);
  await all('hud7');
  await key(p, 'Escape', 1000);
  await all('pause');
  await p.evaluate(() => window.__edc.ui.debug.open('settings')); await sleep(600);
  await all('settings');
  await key(p, 'Escape', 600); await key(p, 'Escape', 1000);
  // finish the shift fast (no render) -> real report
  await p.evaluate(() => { const e = window.__edc; e.loop.stop(); const m = {}; for (let k = 0; k < 60 * 130 && e.sim.state.status !== 'ended'; k++) { const s = e.sim.state; e.setInput(window.__qaP.thinker(s, s.time, m)); e.ui.frame(1 / 60); e.step(1, false); } for (let k = 0; k < 200; k++) { e.ui.frame(1 / 60); e.step(1, false); } e.loop.start(); });
  for (let i = 0; i < 30 && (await state(p)).screen !== 'results'; i++) await sleep(500);
  await sleep(6000);
  await all('report7');
  R.reportText = await p.evaluate(() => document.querySelector('.screens').innerText);
  R.errs = p.errs; R.warns = p.warns.slice(0, 10);
} finally { await b.close(); writeFileSync(resolve(RAW, 'sweep2.json'), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1).slice(0, 6000)); }
