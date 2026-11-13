#!/usr/bin/env node
// QA sweep 1: menus, pause/confirm/back paths, focus, spam, restart, slow-mo pause, hidden tab, settings effects, save/corrupt.
import { launch, newPage, open, key, shot, topScreen, focusedText, sleep, state, RAW } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const R = {}; const note = (k, v) => { R[k] = v; console.log(k, JSON.stringify(v)); };
const b = await launch();
const stepN = (p, n) => p.evaluate((n) => { const e = window.__edc; for (let i = 0; i < n; i++) { e.ui.frame(1 / 60); e.step(1, false); } return e.getState(); }, n);
try {
  // ---------- A: menu flows, back paths, focus restore
  let p = await newPage(b, 1280, 720, { storage: '' });
  await open(p, '&autopause=1');
  await key(p, 'Enter', 1500);
  note('title.focus', await focusedText(p));
  await key(p, 'ArrowDown'); await key(p, 'ArrowDown'); await key(p, 'ArrowDown'); await key(p, 'ArrowDown');
  note('title.focus.after4down', await focusedText(p));
  await key(p, 'Enter', 800); note('settings.open', await topScreen(p));
  await key(p, 'Escape', 800); note('back.from.settings.top', await topScreen(p)); note('back.from.settings.focus', await focusedText(p));
  await key(p, 'ArrowDown', 300); await key(p, 'Enter', 800); note('credits.open', await topScreen(p));
  const credTxt = await p.evaluate(() => document.querySelector('.screens').innerText.slice(0, 1500));
  note('credits.text', credTxt.replace(/\n+/g, ' / ').slice(0, 1200));
  await key(p, 'Escape', 800); note('back.from.credits.focus', await focusedText(p));
  // Backspace as back?
  await key(p, 'ArrowUp'); await key(p, 'ArrowUp'); await key(p, 'ArrowUp'); await key(p, 'ArrowUp');
  await key(p, 'ArrowDown', 300); // shift select
  await key(p, 'Enter', 800); note('shiftselect.top', await topScreen(p));
  note('shiftselect.text', (await p.evaluate(() => document.querySelector('.screens').innerText)).replace(/\n+/g, ' / ').slice(0, 600));
  await key(p, 'ArrowDown'); await key(p, 'Enter', 600); note('locked.shift.enter.top', await topScreen(p));
  await key(p, 'Backspace', 600); note('backspace.top', await topScreen(p));
  await key(p, 'Escape', 600); note('esc.top', await topScreen(p)); note('esc.focus', await focusedText(p));
  // into a shift via clock in
  await key(p, 'ArrowUp'); await key(p, 'ArrowUp'); await key(p, 'ArrowUp'); await key(p, 'Enter', 1200);
  note('briefing.top', await topScreen(p));
  await key(p, 'Space', 1200); note('space.on.briefing.screen', (await state(p)).screen);
  let s = await state(p); note('slamcount.after.space.start', s.slam.count);
  await p.evaluate(() => window.__edc.loop.stop());
  await stepN(p, 120);
  await p.evaluate(() => window.__edc.loop.start());
  await key(p, 'Escape', 1200); note('pause.top', await topScreen(p)); note('pause.focus', await focusedText(p));
  await key(p, 'ArrowDown'); await key(p, 'ArrowDown'); await key(p, 'Enter', 900); note('pause.settings.top', await topScreen(p));
  await key(p, 'Escape', 900); note('pause.settings.back.top', await topScreen(p)); note('pause.settings.back.focus', await focusedText(p));
  await key(p, 'ArrowDown'); await key(p, 'Enter', 900); note('quit.confirm.top', await topScreen(p)); note('quit.confirm.focus', await focusedText(p));
  await shot(p, 'sw-confirm-quit');
  await key(p, 'Escape', 900); note('confirm.esc.top', await topScreen(p)); note('confirm.esc.focus', await focusedText(p));
  await key(p, 'Escape', 1200); note('resume.screen', (await state(p)).screen);
  // pause during slow-mo
  await p.evaluate(() => window.__edc.loop.slowMo(0.35, 0.6));
  await key(p, 'KeyP', 300); note('slowmo.pause.screen', (await state(p)).screen);
  await sleep(2500);
  await key(p, 'KeyP', 300); await sleep(1500);
  note('after.slowmo.resume', await p.evaluate(() => ({ ts: window.__edc.loop.timeScale, base: window.__edc.loop.baseTimeScale, slow: window.__edc.loop.slowMoActive, screen: window.__edc.getState().screen })));
  // hidden tab + blur
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  note('hidden.screen', (await state(p)).screen);
  const tBefore = (await state(p)).time; await sleep(2000); note('hidden.simAdvance', +((await state(p)).time - tBefore).toFixed(3));
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  note('visible.again.screen', (await state(p)).screen);
  await key(p, 'Escape', 800);
  await p.evaluate(() => window.dispatchEvent(new Event('blur'))); note('blur.screen', (await state(p)).screen);
  await key(p, 'Escape', 800);
  // hold R restart
  const t0 = (await state(p)).time;
  await p.keyboard.down('KeyR'); await sleep(900); await p.keyboard.up('KeyR'); await sleep(500);
  note('holdR', { before: t0, after: (await state(p)).time });
  // tap R should not restart
  const t1 = (await state(p)).time; await key(p, 'KeyR', 300); await sleep(600); note('tapR', { before: t1, after: (await state(p)).time });
  // ---------- rapid restarts (30x) and memory
  await p.evaluate(() => window.__edc.loop.stop());
  const mem0 = await p.evaluate(() => ({ heap: performance.memory && performance.memory.usedJSHeapSize, r: window.__edc.view.renderer ? window.__edc.view.renderer.info.memory : null, info: window.__edc.getState().render, dom: document.getElementsByTagName('*').length }));
  for (let i = 0; i < 30; i++) {
    await p.evaluate((i) => { const e = window.__edc; e.ui.startRun(1 + (i % 8)); for (let k = 0; k < 40; k++) { e.ui.frame(1 / 60); e.step(1, false); } e.step(1, true); }, i);
  }
  const mem1 = await p.evaluate(() => ({ heap: performance.memory && performance.memory.usedJSHeapSize, info: window.__edc.getState().render, bodies: window.__edc.getState().bodies, rapierBodies: window.__edc.sim.ctx && window.__edc.sim.ctx.world ? window.__edc.sim.ctx.world.bodies.len() : null, dom: document.getElementsByTagName('*').length }));
  note('rapidRestart', { mem0, mem1, errors: p.errs.slice(0, 5) });
  // ---------- menu input spam
  await p.evaluate(() => window.__edc.loop.start());
  await p.evaluate(() => window.__edc.ui.debug.toTitle());
  await sleep(800);
  const keys = ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Space', 'ArrowLeft', 'ArrowRight', 'Backspace', 'KeyP', 'Tab'];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 160; i++) { await p.keyboard.press(keys[Math.floor(rnd() * keys.length)]); await sleep(25); }
  await sleep(1500);
  note('spam.final', { screen: (await state(p)).screen, top: await topScreen(p), focus: await focusedText(p), errs: p.errs.slice(0, 5), stack: await p.evaluate(() => window.__edc.ui.nav.depth) });
  await shot(p, 'sw-after-spam');
  note('A.errors', { errs: p.errs, warns: p.warns.slice(0, 20) });
  await p.context().close();

  // ---------- B: settings effects
  p = await newPage(b, 1280, 720, { storage: '' });
  await open(p);
  const probe = () => p.evaluate(() => { const e = window.__edc; const v = e.view; const vs = v.ctx.settings; let au = null; try { au = e.audio && e.audio.debug && e.audio.debug.engine ? e.audio.debug.engine.vol : null; } catch {} return { quality: v.qualityName, shake: vs.screenShake, shakeScale: vs.shakeScale, blood: vs.bloodColor, reduceFlashing: vs.reduceFlashing, audioKeys: e.audio ? Object.keys(e.audio) : null, au, bubbles: document.querySelector('.bubbles') ? getComputedStyle(document.querySelector('.bubbles')).display : 'n/a', save: JSON.parse(localStorage.getItem('edc.save.v1') || '{}').settings }; });
  note('settings.default', await probe());
  await p.evaluate(() => { const S = window.__edc.ui; S.debug.open('settings'); });
  await sleep(600);
  // walk the rows: press Right on each to change
  const rows = await p.evaluate(() => [...document.querySelectorAll('.settings-scr .row.setting')].map((r) => r.dataset.key));
  note('settings.rows', rows);
  for (let i = 0; i < rows.length - 1; i++) {
    await key(p, 'ArrowRight', 250); if (rows[i] === 'master' || rows[i] === 'music' || rows[i] === 'sfx') { await key(p, 'ArrowLeft', 150); await key(p, 'ArrowLeft', 150); await key(p, 'ArrowLeft', 150); }
    await key(p, 'ArrowDown', 200);
  }
  note('settings.changed', await probe());
  await shot(p, 'sw-settings-changed');
  await p.reload(); await p.waitForFunction(() => window.__edc && window.__edc.getState); await p.evaluate(() => window.__edc.ready); await sleep(800);
  note('settings.afterReload', await probe());
  await p.context().close();

  // ---------- C: corrupt / odd saves
  for (const [name, raw] of [['garbage', '{garbage'], ['wrongTypes', JSON.stringify({ version: 1, progress: { unlocked: 'lots' }, settings: { master: 'loud', quality: 'ultra', bloodColor: 'blue' }, best: { 'shift-1': { liters: -5, stars: 9 } }, overtime: 'nope' })], ['futureVersion', JSON.stringify({ version: 99, progress: { unlocked: 99 } })], ['unlockedAll', JSON.stringify({ version: 1, progress: { unlocked: 9 } })]]) {
    p = await newPage(b, 1280, 720, { storage: raw });
    await open(p);
    await key(p, 'Enter', 1500);
    const r = await p.evaluate(() => ({ title: document.querySelector('.screens').innerText.replace(/\n+/g, ' / ').slice(0, 400), toasts: document.querySelector('.toasts') ? document.querySelector('.toasts').innerText : '', corruptKept: !!localStorage.getItem('edc.save.v1.corrupt'), save: localStorage.getItem('edc.save.v1') }));
    note(`save.${name}`, { ...r, save: (r.save || '').slice(0, 300), errs: p.errs.slice(0, 3) });
    if (name === 'garbage') await shot(p, 'sw-corrupt-save-title');
    await p.context().close();
  }
} finally { await b.close(); writeFileSync(resolve(RAW, 'sweep1.json'), JSON.stringify(R, null, 1)); }
