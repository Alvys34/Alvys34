#!/usr/bin/env node
// QA: fresh-save first launch through the real UI (keyboard only). Screens + visible text.
import { launch, newPage, open, key, shot, topScreen, focusedText, sleep, OUT, state } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const W = Number(process.argv[2] || 1280), H = Number(process.argv[3] || 720);
const tag = `fr-${W}x${H}`;
const b = await launch();
const log = [];
try {
  const p = await newPage(b, W, H, { storage: '' });
  await open(p);
  const snap = async (name) => {
    await p.evaluate(() => window.__edc.loop.stop());
    await shot(p, `${tag}-${name}`);
    const txt = await p.evaluate(() => { const el = document.querySelector('.screens'); const h = document.querySelector('.hud'); return ((el && el.innerText) || '') + (h && h.offsetParent ? '\n[HUD]\n' + h.innerText : ''); });
    log.push({ name, top: await topScreen(p), focus: await focusedText(p), screen: (await state(p)).screen, text: txt.replace(/\n+/g, ' / ').slice(0, 900) });
    await p.evaluate(() => window.__edc.loop.start());
  };
  await sleep(2500); await snap('01-boot');
  await key(p, 'Enter', 2500); await snap('02-title');
  await key(p, 'Enter', 2500); await snap('03-after-clockin');
  // escape from briefing then back in
  await key(p, 'Escape', 1500); log.push({ name: 'esc-from-briefing', top: await topScreen(p), focus: await focusedText(p) });
  await key(p, 'Enter', 2000); log.push({ name: 'enter-again', top: await topScreen(p), focus: await focusedText(p) });
  await key(p, 'Enter', 1500); await snap('04-shift-start');
  await sleep(4000); await snap('05-shift-4s');
  log.push({ errors: p.errs, warns: p.warns.slice(0, 10) });
} finally { await b.close(); }
writeFileSync(resolve(OUT, `../raw/${tag}.json`), JSON.stringify(log, null, 1));
console.log(JSON.stringify(log, null, 1));
