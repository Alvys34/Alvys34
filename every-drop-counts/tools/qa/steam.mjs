#!/usr/bin/env node
// QA: candidate store-page moments at 1920x1080 (thinker persona, seed 1); accents allowed to decay before capture.
import { launch, newPage, open, key, shot, sleep, state } from './lib.mjs';
const MOMENTS = (process.argv[2] || 'title,1:3.0,1:6.3,2:5.0,3:29.0,4:24.8,5:8.0,6:7.15,7:18.5,8:11.2,overtime:300').split(',');
const b = await launch();
try {
  const p = await newPage(b, 1920, 1080, { storage: JSON.stringify({ version: 1, progress: { unlocked: 9 } }) });
  await open(p);
  await p.evaluate(async () => { window.__qaP = (await import('/tools/qa/personas.js')).PERSONAS; });
  for (const m of MOMENTS) {
    if (m === 'title') { await key(p, 'Enter', 4000); await p.evaluate(() => window.__edc.loop.stop()); await shot(p, 'steam-title'); await p.evaluate(() => window.__edc.loop.start()); continue; }
    const [lv, T] = m.split(':');
    const st = await p.evaluate(([lv, T]) => {
      const e = window.__edc; e.loop.stop(); lv === 'overtime' ? e.startOvertime() : e.loadLevel(Number(lv)); const mem = {};
      while (e.sim.state.time < Number(T) && e.sim.state.status !== 'ended') { const s = e.sim.state; e.setInput(window.__qaP.thinker(s, s.time, mem)); e.ui.frame(1 / 60); e.step(1, false); if (e.sim.state.step % 6 === 0) e.ui.update(0.1); }
      e.setInput({ rotate: 0 });
      for (let i = 0; i < 2; i++) { e.ui.frame(1 / 60); e.step(1, true); }
      const g = e.getState(); return { t: g.time, L: g.liters, fill: g.fill, alive: g.alive };
    }, [lv, T]);
    // let post accents decay (they run on wall-clock time) while the camera settles: the sim is frozen (time scale 0)
    await p.evaluate(async () => { const e = window.__edc; e.view.setReduceFlashing && e.view.setReduceFlashing(true); for (let i = 0; i < 6; i++) { e.view.update(e.sim.state, 1, 1 / 60, { realDt: 1 / 60, timeScale: 1, paused: false, slowMo: false, hitStop: false }); await new Promise((r) => setTimeout(r, 30)); } e.ui.update(0.5); });
    await shot(p, `steam-${lv}-${T}`);
    console.log(m, JSON.stringify(st));
  }
  console.log('errs', p.errs);
} finally { await b.close(); }
