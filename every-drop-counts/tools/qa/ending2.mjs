#!/usr/bin/env node
// QA: real shift-8 run -> report -> Clock out: does the ending sting play?
import { launch, newPage, open, key, shot, topScreen, focusedText, sleep, state } from './lib.mjs';
const b = await launch();
try {
  const p = await newPage(b, 1280, 720, { storage: JSON.stringify({ version: 1, progress: { unlocked: 8 } }) });
  await open(p, '&autostart=8');
  await p.evaluate(async () => { window.__qaP = (await import('/tools/qa/personas.js')).PERSONAS; });
  await p.evaluate(() => { const e = window.__edc; e.loop.stop(); const m = {}; for (let k = 0; k < 60 * 150 && e.sim.state.status !== 'ended'; k++) { const s = e.sim.state; e.setInput(window.__qaP.smart(s, s.time, m)); e.ui.frame(1 / 60); e.step(1, false); } for (let k = 0; k < 150; k++) { e.ui.frame(1 / 60); e.step(1, false); } e.loop.start(); });
  for (let i = 0; i < 40 && (await state(p)).screen !== 'results'; i++) await sleep(500);
  console.log('stars', (await state(p)).stars);
  const seq0 = [];
  for (let i = 0; i < 12; i++) { seq0.push(`${await focusedText(p)}`); await sleep(1000); }
  console.log('focus over 12 s after report:', seq0.join(' | '));
  await p.keyboard.press('Enter');
  const t0 = Date.now(); const seq = [];
  for (let i = 0; i < 30; i++) { seq.push(`${((Date.now() - t0) / 1000).toFixed(1)}:${await topScreen(p)}:${(await state(p)).screen}`); await sleep(700); }
  console.log(seq.join(' '));
  console.log('errs', p.errs, p.warns.slice(0, 5));
} finally { await b.close(); }
