/**
 * Shared helpers for the local real-GPU tools (perf, capture).
 *
 * Uses the system Google Chrome (channel 'chrome'), headed, on the machine's real GPU — never
 * SwiftShader. Expects the game served at BASE (default http://localhost:5173, `npm run preview`
 * after `npm run build`, so we measure the production bundle).
 *
 * In-page: window.EDCBOT (tools/policies.mjs bundled by build-bot.mjs) and window.__bot, a rAF
 * driver that feeds the chosen policy's input to __edc.setInput every frame, like a player would.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');
export const BASE = process.env.EDC_BASE || 'http://localhost:5173/';

export async function launch({ uncapped = true, width = 1920, height = 1080, extraArgs = [], recordAudio = false } = {}) {
  const args = ['--ignore-gpu-blocklist', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required',
    `--window-size=${width + 16},${height + 140}`, '--window-position=0,0', ...extraArgs,
    // EDC_CHROME_ARGS: extra switches, e.g. --use-adapter-luid=0,76383 (pin Chrome to the iGPU on this machine)
    ...(process.env.EDC_CHROME_ARGS ? process.env.EDC_CHROME_ARGS.split(' ') : [])];
  // vsync off + no frame-rate cap: frame time then shows the real cost instead of the monitor's refresh
  if (uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleMsgs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${e.message}`));
  if (recordAudio) await page.addInitScript(AUDIO_TAP);
  return { browser, context, page, consoleMsgs };
}

/** Taps every connection to an AudioContext destination into a MediaStream (for footage with sound). */
const AUDIO_TAP = `(() => {
  const orig = AudioNode.prototype.connect;
  window.__audioTaps = [];
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode) {
        const ctx = dest.context;
        if (!ctx.__tap) { ctx.__tap = ctx.createMediaStreamDestination(); window.__audioTaps.push(ctx.__tap); }
        orig.call(this, ctx.__tap, ...rest);
      }
    } catch (e) { /* ignore */ }
    return r;
  };
})();`;

export async function openGame(page, query = '') {
  const url = `${BASE}?debug=1${query ? `&${query}` : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__edc && window.__edc.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__edc.ready);
  const bot = resolve(HERE, 'out', 'bot.iife.js');
  if (!existsSync(bot)) throw new Error('run node tools/local/build-bot.mjs first');
  await page.addScriptTag({ content: readFileSync(bot, 'utf8') });
  await page.evaluate(INSTALL_DRIVER);
}

const INSTALL_DRIVER = `(() => {
  const bot = window.__bot = { on: false, policy: 'smart', mem: {}, frames: null };
  function tick(ts) {
    if (bot.frames) bot.frames.push(ts);
    if (bot.on) {
      const e = window.__edc; const s = e.sim && e.sim.state;
      if (s && s.status !== 'ended') {
        try { e.setInput(window.EDCBOT.POLICIES[bot.policy](s, s.time != null ? s.time : e.sim.ctx.time, bot.mem)); } catch (err) { bot.err = String(err); }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})()`;

export async function gpuInfo(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a', vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'n/a', dpr: devicePixelRatio, w: innerWidth, h: innerHeight };
  });
}

/** Start a run with the bot driving. ref = shift number or 'overtime'. */
export async function startRun(page, ref, { policy = 'smart' } = {}) {
  await page.evaluate(({ ref, policy }) => {
    window.__bot.on = false; window.__bot.mem = {}; window.__bot.policy = policy;
    if (ref === 'overtime') window.__edc.startOvertime(); else window.__edc.loadLevel(ref);
    window.__bot.on = true;
  }, { ref, policy });
}

/** Fast-forward the sim with the bot (no rendering) until pred(state) or maxSteps. */
export async function fastForward(page, { untilBodies = Infinity, maxSimSeconds = 600 } = {}) {
  for (;;) {
    const r = await page.evaluate(({ untilBodies, maxSimSeconds }) => {
      const e = window.__edc; const b = window.__bot;
      for (let i = 0; i < 300; i++) {
        const s = e.sim.state; if (s.status === 'ended') break;
        e.setInput(window.EDCBOT.POLICIES[b.policy](s, s.time != null ? s.time : e.sim.ctx.time, b.mem));
        e.step(1, false);
      }
      const g = e.sim.snapshot();
      let bodies = 0; for (const d of e.sim.ctx.dyns) if (!d.removed) bodies++;
      return { t: g.time, bodies, status: g.status, done: bodies >= untilBodies || g.time >= maxSimSeconds || g.status === 'ended' };
    }, { untilBodies, maxSimSeconds });
    if (r.done) return r;
  }
}

/** Record rAF frame intervals for `seconds` of real time while the bot plays. */
export async function measure(page, seconds) {
  await page.evaluate(() => { window.__bot.frames = []; window.__edc.perfReset(); });
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    await page.waitForTimeout(1000);
    samples.push(await page.evaluate(() => {
      const e = window.__edc; const p = e.view.perf();
      let bodies = 0; for (const d of e.sim.ctx.dyns) if (!d.removed) bodies++;
      return { info: e.view.info(), bodies, drops: p.blood && p.blood.drops, mist: p.blood && p.blood.mist, auto: p.autoLevel, quality: p.quality, pr: p.pixelRatio, status: e.sim.state.status, screen: e.ui.screen };
    }));
  }
  const { frames, perf } = await page.evaluate(() => { const f = window.__bot.frames; window.__bot.frames = null; return { frames: f, perf: window.__edc.perf() }; });
  const dts = []; for (let i = 1; i < frames.length; i++) dts.push(frames[i] - frames[i - 1]);
  return { ...frameStats(dts), split: splitPerFrame(perf), samples };
}

export function frameStats(dts) {
  const n = dts.length; if (!n) return { n: 0 };
  const sorted = [...dts].sort((a, b) => b - a);
  const avg = dts.reduce((a, b) => a + b, 0) / n;
  const worst1 = sorted.slice(0, Math.max(1, Math.floor(n * 0.01)));
  const low1Ms = worst1.reduce((a, b) => a + b, 0) / worst1.length;
  return { n, avgMs: avg, fps: 1000 / avg, low1Ms, low1Fps: 1000 / low1Ms, p99Ms: sorted[Math.floor(n * 0.01)], maxMs: sorted[0], over33: dts.filter((d) => d > 33.4).length };
}

function splitPerFrame(p) {
  const f = Math.max(1, p.frames);
  return { simMsPerFrame: p.sim / f, viewMsPerFrame: p.view / f, uiMsPerFrame: p.ui / f, audioMsPerFrame: p.audio / f, simMsPerStep: p.steps ? p.sim / p.steps : 0, maxFrameMs: p.maxFrame };
}

export const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '-' : Number(v).toFixed(d));
