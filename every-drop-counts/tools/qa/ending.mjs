#!/usr/bin/env node
// QA: does the "Clock out" press on the shift-8 report survive into the ending sting? (keyboard Enter, Space, mouse click)
import { launch, newPage, open, key, shot, topScreen, focusedText, sleep, state } from './lib.mjs';
const b = await launch();
try {
  for (const how of ['Enter', 'Space', 'click']) {
    const p = await newPage(b, 1280, 720, { storage: JSON.stringify({ version: 1, progress: { unlocked: 9 } }) });
    await open(p);
    await key(p, 'Enter', 1200);
    await p.evaluate(() => window.__edc.ui.debug.showResults({ levelNumber: 8, levelId: 'shift-8', stars: 1, liters: 60, result: 'complete', collected: 60, bonus: 0, fines: 0, kills: 20, drownings: 0, quota: [55, 125, 150] }));
    await sleep(6000);
    const f = await focusedText(p);
    const seq = [];
    p.on('console', () => {});
    if (how === 'click') { const el = await p.$('text=Clock out'); await el.click(); } else await p.keyboard.press(how);
    const t0 = Date.now();
    for (let i = 0; i < 24; i++) { seq.push(`${((Date.now() - t0) / 1000).toFixed(1)}s:${await topScreen(p)}`); if (i === 4) { await p.evaluate(() => window.__edc.loop.stop()); await shot(p, `ending-${how}-2s`); await p.evaluate(() => window.__edc.loop.start()); } await sleep(700); }
    console.log(how, 'focus before:', f, '|', seq.join(' '), '| errs', p.errs.slice(0, 3));
    await p.context().close();
  }
} finally { await b.close(); }
