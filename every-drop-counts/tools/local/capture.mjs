#!/usr/bin/env node
/**
 * Real-time capture on the real GPU (vsync on, 1920x1080, Chrome): gameplay video of the canvas
 * (with the game's own audio, tapped from WebAudio) and real-time screenshots of the page (HUD
 * included; optional clean twin with the HUD hidden). Also logs the camera distance every frame
 * so zoom motion can be judged in numbers, and collects console errors.
 *
 *   node tools/local/capture.mjs --run 1|..|8|ot [--secs 40] [--out name] [--quality high]
 *       [--video] [--shots 6,12,20] [--clean] [--blood green] [--reduce-flashing]
 *       [--ffbodies 380] [--fft 60] [--policy smart] [--spinup]
 *
 * --ffbodies N / --fft S: before capturing, fast-forward the run with the bot (sim only) until N bodies
 *   or S sim seconds (late-shift / late-Overtime states without waiting).
 * --spinup: drum held at rest 3 s, then full rotate for 4 s, brake, repeat (camera zoom test).
 * Output: tools/local/out/cap/<out>/ (video.webm|mp4, shot-*.png, camera.json, console.json)
 */
import { writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { launch, openGame, startRun, fastForward, HERE } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
const run = opt('--run', '1');
const secs = Number(opt('--secs', 30));
const out = opt('--out', `run-${run}`);
const quality = opt('--quality', 'high');
const shots = (opt('--shots', '') || '').split(',').filter(Boolean).map(Number);
const dir = resolve(HERE, 'out', 'cap', out); mkdirSync(dir, { recursive: true });

const { browser, page, consoleMsgs } = await launch({ uncapped: false, recordAudio: true });
let file = null; let stream = null;
await page.exposeFunction('__capChunk', (b64) => { stream.write(Buffer.from(b64, 'base64')); });
try {
  await openGame(page, `quality=${quality}&seed=${opt('--seed', '1')}`);
  await page.evaluate(({ blood, reduce }) => {
    const v = window.__edc.view;
    if (blood) v.setBloodColor(blood);
    if (reduce) v.setReduceFlashing(true);
  }, { blood: opt('--blood', null), reduce: has('--reduce-flashing') });
  await startRun(page, run === 'ot' ? 'overtime' : Number(run), { policy: opt('--policy', 'smart') });
  if (has('--spinup')) await page.evaluate(() => { window.__bot.on = false; });
  const ffb = Number(opt('--ffbodies', 0)); const fft = Number(opt('--fft', 0));
  if (ffb || fft) console.log('fast-forward', await fastForward(page, { untilBodies: ffb || Infinity, maxSimSeconds: fft || 600 }));
  await page.waitForTimeout(500);

  // camera log, every rAF
  await page.evaluate(() => {
    const e = window.__edc; const cam = e.view.ctx.camera; const log = window.__camLog = [];
    (function tick(ts) { if (window.__camLog) { log.push([+ts.toFixed(1), +cam.position.length().toFixed(4), +e.view.ctx.drumAngle.toFixed(4), +(e.sim.state.drum.omega || 0).toFixed(3)]); requestAnimationFrame(tick); } })(performance.now());
  });

  if (has('--video')) {
    const mime = await page.evaluate(() => ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)));
    file = resolve(dir, mime.startsWith('video/mp4') ? 'video.mp4' : 'video.webm');
    stream = createWriteStream(file);
    console.log('recording', mime, '->', file);
    await page.evaluate((mime) => {
      const canvas = document.getElementById('game');
      const vs = canvas.captureStream(60);
      const tracks = [...vs.getVideoTracks()];
      for (const t of window.__audioTaps || []) tracks.push(...t.stream.getAudioTracks());
      const rec = window.__rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 40e6, audioBitsPerSecond: 192e3 });
      window.__recDone = new Promise((res) => { rec.onstop = res; });
      let pending = Promise.resolve();
      rec.ondataavailable = (ev) => {
        pending = pending.then(async () => {
          const buf = new Uint8Array(await ev.data.arrayBuffer());
          let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
          await window.__capChunk(btoa(s));
        });
        window.__recPending = pending;
      };
      rec.start(1000);
    }, mime);
  }

  const t0 = Date.now(); let si = 0; let spin = 0;
  while (Date.now() - t0 < secs * 1000) {
    const el = (Date.now() - t0) / 1000;
    if (has('--spinup')) {
      // 7 s cycle: 3 s at rest (brake), 4 s full rotate (alternating direction)
      const ph = el % 7; const cyc = Math.floor(el / 7);
      await page.evaluate((o) => window.__edc.setInput(o), ph < 3 ? { rotate: 0, brake: true } : { rotate: cyc % 2 ? -1 : 1, brake: false });
      spin++;
    }
    if (si < shots.length && el >= shots[si]) {
      const n = String(si + 1).padStart(2, '0');
      await page.screenshot({ path: resolve(dir, `shot-${n}.png`) });
      if (has('--clean')) {
        await page.addStyleTag({ content: '#ui-root{visibility:hidden !important}' }).then(async (h) => {
          await page.screenshot({ path: resolve(dir, `shot-${n}-clean.png`) });
          await h.evaluate((n) => n.remove());
        });
      }
      si++;
    }
    await page.waitForTimeout(has('--spinup') ? 50 : 100);
  }
  if (has('--video')) {
    await page.evaluate(async () => { window.__rec.stop(); await window.__recDone; await window.__recPending; });
    await new Promise((r) => stream.end(r));
  }
  const cam = await page.evaluate(() => { const l = window.__camLog; window.__camLog = null; return l; });
  writeFileSync(resolve(dir, 'camera.json'), JSON.stringify(cam));
  const st = await page.evaluate(() => { const g = window.__edc.getState(); return { screen: g.screen, liters: g.liters, fill: g.fill, bodies: g.bodies, status: g.status, render: g.render, quality: g.quality, errors: window.__edc.errors.slice(0, 20) }; });
  writeFileSync(resolve(dir, 'console.json'), JSON.stringify({ console: consoleMsgs, state: st }, null, 1));
  // zoom motion summary: relative distance change per second, frame to frame
  let maxRate = 0; let maxStep = 0;
  for (let i = 1; i < cam.length; i++) {
    const dt = (cam[i][0] - cam[i - 1][0]) / 1000; if (dt <= 0) continue;
    const rel = Math.abs(cam[i][1] - cam[i - 1][1]) / cam[i - 1][1];
    maxStep = Math.max(maxStep, rel); maxRate = Math.max(maxRate, rel / dt);
  }
  console.log(JSON.stringify({ out, frames: cam.length, camDist: [Math.min(...cam.map((c) => c[1])).toFixed(2), Math.max(...cam.map((c) => c[1])).toFixed(2)], maxZoomRatePerS: maxRate.toFixed(3), maxZoomStepPerFrame: maxStep.toFixed(4), state: st, consoleCount: consoleMsgs.length }));
} finally { await browser.close(); }
