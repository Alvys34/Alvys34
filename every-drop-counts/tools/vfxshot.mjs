#!/usr/bin/env node
/**
 * VFX screenshot tool (variant of tools/shot.mjs for slow software WebGL):
 *  - stops the free-running RAF loop, so only explicit steps render (no GPU queue backlog)
 *  - captures the WebGL canvas itself via toDataURL (needs ?debug=1 -> preserveDrawingBuffer),
 *    so it never waits on the compositor; the DOM HUD is not in the image (pass --dom to use a
 *    regular page screenshot instead)
 *
 *   node tools/vfxshot.mjs --serve --port 5175 --script tools/scripts/vfx-shift2.json --out tools/out --prefix vfx
 *        [--width 1280 --height 720] [--quality high] [--level 2] [--dom]
 *
 * Script actions: same as tools/shot.mjs ({input},{step},{rock},{level},{quality},{eval},{shot},
 * {wait}) plus { "size": [w, h] } (resize the viewport) and { "render": n } (render n frames
 * of real-time-equivalent dt without stepping the sim — lets camera/post settle).
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(`--${k}`);

async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not come up: ${url}`);
}

async function main() {
  const port = Number(get('port', '5175'));
  const quality = get('quality', 'high');
  const level = get('level', '2');
  const url = get('url', `http://localhost:${port}/?debug=1&seed=1&autostart=${level}&quality=${quality}`);
  const out = resolve(get('out', resolve(ROOT, 'tools/out')));
  const prefix = get('prefix', 'vfx');
  const width = Number(get('width', '1280')); const height = Number(get('height', '720'));
  const s = get('script', '[]');
  const script = s.trim().startsWith('[') ? JSON.parse(s) : JSON.parse(readFileSync(resolve(s), 'utf8'));
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
    page.setDefaultTimeout(600000);
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /THREE|WebGL|GL_/.test(m.text()))) consoleErrors.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => window.__edc && window.__edc.ready, null, { timeout: 120000 });
    await page.evaluate(() => window.__edc.ready);
    await page.evaluate(() => { window.__edc.setTimeScale(0); window.__edc.loop.stop(); });
    const t0 = Date.now();
    for (const act of script) {
      if (act.size) { await page.setViewportSize({ width: act.size[0], height: act.size[1] }); await page.evaluate(() => { window.__edc.view.resize(); }); }
      if (act.input) await page.evaluate((i) => window.__edc.setInput(i), act.input);
      if (act.level != null) await page.evaluate((l) => { window.__edc.loadLevel(l); window.__edc.loop.stop(); }, act.level);
      if (act.quality) await page.evaluate((q) => window.__edc.setQuality(q), act.quality);
      if (act.step) {
        let left = act.step;
        while (left > 0) {
          const n = Math.min(left, 10);
          await page.evaluate(([k, r]) => window.__edc.step(k, r), [n, left <= 40]);
          left -= n;
        }
      }
      if (act.rock) {
        const { steps = 600, period = 96, slamEvery = 0, renderEvery = 0 } = act.rock;
        for (let i = 0; i < steps; i += 6) {
          const dir = Math.floor(i / period) % 2 ? -1 : 1;
          const slam = slamEvery > 0 && i % slamEvery < 6;
          const r = steps - i <= 30 || (renderEvery > 0 && i % renderEvery < 6);
          await page.evaluate(([d, sl, rr]) => { window.__edc.setInput({ rotate: d, slam: sl }); return window.__edc.step(6, rr); }, [dir, slam, r]);
        }
        await page.evaluate(() => window.__edc.setInput({ rotate: 0 }));
      }
      if (act.render) {
        await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__edc.view.update(window.__edc.sim.state, 1, 1 / 60); }, act.render);
      }
      if (act.wait) await page.waitForTimeout(act.wait);
      if (act.eval) console.log('eval:', JSON.stringify(await page.evaluate(act.eval)));
      if (act.shot) {
        const file = resolve(out, `${prefix}-${act.shot}.png`);
        if (has('dom')) {
          await page.screenshot({ path: file, timeout: 600000 });
        } else {
          const data = await page.evaluate(() => document.getElementById('game').toDataURL('image/png'));
          writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
        }
        const st = await page.evaluate(() => ({ s: window.__edc.getState(), b: window.__edc.view.ctx.blood.stats ? window.__edc.view.ctx.blood.stats() : null }));
        console.log(`shot ${file}  [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
        console.log(`  t=${st.s.time} L=${st.s.liters} fill=${st.s.fill} alive=${st.s.alive} theta=${st.s.drum.theta} draws=${st.s.render.calls} tris=${st.s.render.triangles} tex=${st.s.render.textures} geo=${st.s.render.geometries} blood=${JSON.stringify(st.b)}`);
      }
    }
    const errs = await page.evaluate(() => window.__edc.errors.slice());
    const all = [...new Set([...errs, ...consoleErrors])];
    if (all.length) {
      failed = true;
      console.log(`ERRORS (${all.length}):`);
      for (const e of all.slice(0, 20)) console.log('  ', e.split('\n').slice(0, 3).join(' | '));
    } else console.log('no page errors');
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  if (failed && !has('keep-going')) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
