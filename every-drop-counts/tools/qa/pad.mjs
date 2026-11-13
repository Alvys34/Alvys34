#!/usr/bin/env node
// QA: gamepad-only path (simulated standard pad) + hold-to-restart (keyboard R and pad Select), frames driven manually.
import { launch, newPage, open, topScreen, focusedText, sleep, state, shot } from './lib.mjs';
const PAD_SHIM = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })); const axes = [0, 0, 0, 0];
  const pad = { id: 'Simulated Xbox pad', index: 0, connected: true, mapping: 'standard', buttons, axes, timestamp: 0 };
  window.__pad = { hold(i, v) { buttons[i].pressed = v; buttons[i].value = v ? 1 : 0; }, axis(i, v) { axes[i] = v; } };
  navigator.getGamepads = () => [pad, null, null, null];
};
const b = await launch();
const out = {};
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(PAD_SHIM);
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.clear(); } });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') p.errs.push(m.text()); });
  await open(p);
  await p.evaluate(() => window.__edc.loop.stop());
  const frames = (n) => p.evaluate((n) => { const e = window.__edc; for (let i = 0; i < n; i++) { e.ui.frame(1 / 60); e.step(1, false); } }, n);
  const tap = async (btn) => { await p.evaluate((b) => window.__pad.hold(b, true), btn); await frames(2); await p.evaluate((b) => window.__pad.hold(b, false), btn); await frames(8); };
  const look = async (k) => { out[k] = { top: await topScreen(p), focus: await focusedText(p), screen: (await state(p)).screen, device: await p.evaluate(() => document.querySelector('.edc-ui').dataset.device) }; };
  await tap(0); await look('A.on.boot');
  await tap(13); await tap(13); await tap(13); await tap(13); await look('dpad.down4');
  await tap(0); await look('A.settings');
  await p.evaluate(() => window.__pad.axis(0, 1)); await frames(3); await p.evaluate(() => window.__pad.axis(0, 0)); await frames(20); await look('stick.right.in.settings');
  await tap(1); await look('B.back');
  await tap(12); await tap(12); await tap(12); await tap(12); await tap(0); await look('A.clockin');
  await p.evaluate(() => { window.__edc.step(1, true); }); await shot(p, 'pad-briefing');
  await tap(0); await look('A.begin'); out.slamAfterBegin = (await state(p)).slam.count;
  await p.evaluate(() => window.__pad.axis(0, 1)); await frames(30); out.stickOmega = (await state(p)).drum.omega;
  await p.evaluate(() => window.__pad.axis(0, 0.12)); await frames(30); out.deadzoneOmega = (await state(p)).drum.omega;
  await p.evaluate(() => window.__pad.axis(0, 0)); await frames(90);
  await p.evaluate(() => window.__pad.hold(6, true)); await frames(30); out.LTomega = (await state(p)).drum.omega; await p.evaluate(() => window.__pad.hold(6, false));
  await p.evaluate(() => window.__pad.hold(2, true)); await frames(20); out.XbrakeOmega = (await state(p)).drum.omega; await p.evaluate(() => window.__pad.hold(2, false));
  await frames(60); await tap(0); out.slamCount = (await state(p)).slam.count;
  await p.evaluate(() => { window.__edc.step(1, true); }); await shot(p, 'pad-hud-glyphs');
  await tap(9); await look('start.pause');
  await tap(1); await look('B.resume');
  const t0 = (await state(p)).time;
  await p.evaluate(() => window.__pad.hold(8, true)); await frames(45); await p.evaluate(() => window.__pad.hold(8, false)); await frames(5);
  out.selectHold = { before: t0, after: (await state(p)).time };
  await frames(120);
  const t1 = (await state(p)).time;
  await p.keyboard.down('KeyR'); await frames(40); await p.keyboard.up('KeyR'); await frames(3);
  out.keyRHold = { before: t1, after: (await state(p)).time };
  out.errs = p.errs;
} finally { await b.close(); console.log(JSON.stringify(out, null, 1)); }
