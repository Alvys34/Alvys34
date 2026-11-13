#!/usr/bin/env node
/**
 * Playwright screenshot tool (headless Chromium + SwiftShader WebGL).
 *
 *   node tools/shot.mjs [--serve] [--url URL] [--out DIR] [--prefix NAME] [--script FILE|JSON]
 *                       [--width 1280] [--height 720] [--keep-going]
 *
 *   --serve        start `vite` on port 5173 for the duration of the run (default URL then uses it)
 *   --url          default: http://localhost:5173/?debug=1&seed=1&autostart=1
 *                  (file:///…/dist/index.html?debug=1&autostart=1 works too)
 *   --script       JSON array of actions (inline or a file). Actions:
 *                    { "input": { "rotate": 1, "brake": false, "slam": false } }   -> __edc.setInput
 *                    { "step": 120 }          advance N fixed sim steps synchronously (deterministic;
 *                                             only the last ~40 steps are rendered — SwiftShader is slow)
 *                    { "play": 1500 }         let the game run in real time for N ms
 *                    { "wait": 300 }          sleep N ms
 *                    { "key": "Space" }       press a keyboard key (Playwright key name)
 *                    { "level": 2 }           __edc.loadLevel(2)
 *                    { "quality": "low" }     __edc.setQuality
 *                    { "eval": "js expr" }    evaluate in the page, result printed
 *                    { "rock": { "steps": 600, "period": 96, "slamEvery": 180 } }
 *                                             scripted rocking (alternate full rotate every
 *                                             `period` steps, slam every `slamEvery` steps)
 *                    { "shot": "name" }       write <out>/<prefix>-<name>.png and print getState()
 *   Default script: a short scripted shift with 4 screenshots.
 * Exit code 1 if the page collected any errors (window.onerror / console.error).
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Playwright is installed globally (NODE_PATH), which only CommonJS resolution honours.
const { chromium } = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(`--${k}`);

const DEFAULT_SCRIPT = [
  { eval: 'window.__edc.setTimeScale(0)' },
  { step: 150 }, { shot: 'start' },
  { input: { rotate: 1 } }, { step: 70 }, { shot: 'rotating' },
  { input: { rotate: -1 } }, { step: 160 }, { input: { rotate: 0 } }, { step: 60 }, { shot: 'tumble' },
  { input: { rotate: 0, slam: true } }, { step: 20 }, { shot: 'slam' },
];

function loadScript() {
  const s = get('script', null);
  if (!s) return DEFAULT_SCRIPT;
  if (s.trim().startsWith('[')) return JSON.parse(s);
  return JSON.parse(readFileSync(resolve(s), 'utf8'));
}

async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not come up: ${url}`);
}

async function main() {
  const port = Number(get('port', '5173'));
  const url = get('url', `http://localhost:${port}/?debug=1&seed=1&autostart=1`);
  const out = resolve(get('out', resolve(ROOT, 'tools/out')));
  const prefix = get('prefix', 'shot');
  const width = Number(get('width', '1280')); const height = Number(get('height', '720'));
  if (!existsSync(out)) mkdirSync(out, { recursive: true });

  let server = null;
  if (has('serve')) {
    server = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, EDC_NO_HMR: '1' } });
    await waitForServer(`http://localhost:${port}/`);
  }

  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let failed = false;
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => window.__edc && window.__edc.ready, null, { timeout: 60000 });
    await page.evaluate(() => window.__edc.ready);
    for (const act of loadScript()) {
      if (act.input) await page.evaluate((i) => window.__edc.setInput(i), act.input);
      if (act.level != null) await page.evaluate((l) => window.__edc.loadLevel(l), act.level);
      if (act.quality) await page.evaluate((q) => window.__edc.setQuality(q), act.quality);
      if (act.step) {
        // software WebGL is slow (~0.3 s/frame): only render the last few chunks (droplets need a
        // few frames to fly), skip rendering for the rest so the GPU queue doesn't back up
        let left = act.step;
        while (left > 0) {
          const n = Math.min(left, 10);
          await page.evaluate(([k, r]) => window.__edc.step(k, r), [n, left <= 40]);
          left -= n;
        }
      }
      if (act.rock) {
        const { steps = 600, period = 96, slamEvery = 0 } = act.rock;
        for (let i = 0; i < steps; i += 6) {
          const dir = Math.floor(i / period) % 2 ? -1 : 1;
          const slam = slamEvery > 0 && i % slamEvery < 6;
          await page.evaluate(([d, sl, r]) => { window.__edc.setInput({ rotate: d, slam: sl }); return window.__edc.step(6, r); }, [dir, slam, steps - i <= 30]);
        }
        await page.evaluate(() => window.__edc.setInput({ rotate: 0 }));
      }
      if (act.play) await page.waitForTimeout(act.play);
      if (act.wait) await page.waitForTimeout(act.wait);
      if (act.key) await page.keyboard.press(act.key);
      if (act.eval) console.log('eval:', JSON.stringify(await page.evaluate(act.eval)));
      if (act.shot) {
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const file = resolve(out, `${prefix}-${act.shot}.png`);
        await page.screenshot({ path: file });
        const st = await page.evaluate(() => window.__edc.getState());
        console.log(`shot ${file}`);
        console.log(`  t=${st.time} screen=${st.screen} L=${st.liters} fill=${st.fill} alive=${st.alive} dead=${st.dead} bodies=${st.bodies} `
          + `theta=${st.drum.theta} stepMs=${JSON.stringify(st.stepMs)} draws=${st.render.calls} tris=${st.render.triangles} droplets=${st.droplets}`);
      }
    }
    const errs = await page.evaluate(() => window.__edc.errors.slice());
    const all = [...new Set([...errs, ...consoleErrors])];
    if (all.length) {
      failed = true;
      console.log(`ERRORS (${all.length}):`);
      for (const e of all.slice(0, 20)) console.log('  ', e.split('\n')[0]);
    } else {
      console.log('no page errors');
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  if (failed && !has('keep-going')) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
