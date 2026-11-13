#!/usr/bin/env node
/**
 * Fallback screenshot tool when page.screenshot() times out under software WebGL: steps the sim
 * and reads the game canvas via toDataURL (debug mode keeps the drawing buffer).
 *   node tools/canvas-shot.mjs <port> <outDir> <level>:<steps>[:rotate:rotSteps] ...
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const [port = '5174', out = resolve(ROOT, 'tools/out'), ...specs] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--port', port, '--strictPort'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, EDC_NO_HMR: '1' } });
const url = `http://localhost:${port}/?debug=1&seed=3&autostart=1&quality=low`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 300)); }
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(url);
  await page.waitForFunction(() => window.__edc && window.__edc.ready, null, { timeout: 90000 });
  await page.evaluate(() => window.__edc.ready);
  await page.evaluate(() => window.__edc.setTimeScale(0));
  for (const spec of specs) {
    const [lvl, steps, rot = '0', rotSteps = '0'] = spec.split(':');
    await page.evaluate((l) => (l === 'overtime' ? window.__edc.startOvertime() : window.__edc.loadLevel(Number(l))), lvl);
    let left = Number(steps);
    while (left > 0) { const n = Math.min(60, left); await page.evaluate((k) => window.__edc.step(k, false), n); left -= n; }
    if (Number(rotSteps)) {
      await page.evaluate((r) => window.__edc.setInput({ rotate: r }), Number(rot));
      await page.evaluate((k) => window.__edc.step(k, false), Number(rotSteps));
      await page.evaluate(() => window.__edc.setInput({ rotate: 0, brake: true }));
      await page.evaluate(() => window.__edc.step(90, false));
    }
    const st = await page.evaluate(() => { const s = window.__edc.step(2, true); return { t: s.time, alive: s.alive, bodies: s.bodies, errors: s.errors, L: s.liters }; });
    const data = await page.evaluate(() => document.getElementById('game').toDataURL('image/png'));
    const file = resolve(out, `content-${lvl}.png`);
    writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log('shot', file, JSON.stringify(st));
  }
  const errs = await page.evaluate(() => window.__edc.errors.slice());
  console.log(errs.length ? `ERRORS ${errs.length}: ${errs.slice(0, 5).join(' | ')}` : 'no page errors');
} finally { await browser.close(); server.kill(); }
