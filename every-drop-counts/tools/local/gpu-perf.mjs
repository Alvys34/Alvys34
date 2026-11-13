#!/usr/bin/env node
/**
 * Real-GPU frame-time table: quality {low, medium, high} x {shift 1, shift 7, late Overtime}.
 *   npm run build && npm run preview      (game on :5173)
 *   node tools/local/build-bot.mjs && node tools/local/gpu-perf.mjs [--vsync] [--q low,medium] [--s s1,s7,ot] [--secs 40]
 *
 * Each cell: fresh page load (?debug=1&quality=Q&seed=1), smart bot playing in real time.
 *   s1 / s7: play from the start, measure seconds 15..15+secs of the shift.
 *   ot:      fast-forward Overtime (sim only, no render) until ~400 bodies, then measure in real time.
 * The auto-quality governor is off under ?debug=1, so each row is the preset itself.
 * Output: table on stdout + tools/local/out/perf-*.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, openGame, gpuInfo, startRun, fastForward, measure, fmt, HERE } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const vsync = argv.includes('--vsync');
const qualities = opt('--q', 'low,medium,high').split(',');
const scenarios = opt('--s', 's1,s7,ot').split(',');
const secs = Number(opt('--secs', 40));

const { browser, page, consoleMsgs } = await launch({ uncapped: !vsync });
const rows = [];
try {
  await openGame(page, 'quality=low&seed=1');
  const gpu = await gpuInfo(page);
  console.log('GPU:', gpu.renderer, '| viewport', gpu.w, 'x', gpu.h, '@dpr', gpu.dpr, vsync ? '| vsync ON' : '| vsync OFF, uncapped');
  for (const q of qualities) {
    for (const s of scenarios) {
      await openGame(page, `quality=${q}&seed=1`);
      let pre = null;
      if (s === 'ot') {
        await startRun(page, 'overtime');
        pre = await fastForward(page, { untilBodies: 400, maxSimSeconds: 480 });
        await page.waitForTimeout(3000);
      } else {
        await startRun(page, s === 's1' ? 1 : 7);
        await page.waitForTimeout(15000);
      }
      const m = await measure(page, secs);
      const last = m.samples[m.samples.length - 1] || {};
      const maxCalls = Math.max(...m.samples.map((x) => x.info.calls));
      const maxBodies = Math.max(...m.samples.map((x) => x.bodies));
      const maxDrops = Math.max(...m.samples.map((x) => x.drops || 0));
      const row = { quality: q, scenario: s, ...m, pre, maxCalls, maxBodies, maxDrops, tris: last.info && last.info.triangles, pr: last.pr, status: last.status };
      rows.push(row);
      console.log(`${q.padEnd(6)} ${s.padEnd(3)} avg ${fmt(m.avgMs, 2)} ms (${fmt(m.fps, 0)} fps) | 1% low ${fmt(m.low1Ms, 2)} ms (${fmt(m.low1Fps, 0)} fps) | max ${fmt(m.maxMs)} | >33ms ${m.over33} | calls<=${maxCalls} tris ${last.info && last.info.triangles} | bodies<=${maxBodies} drops<=${maxDrops} | sim ${fmt(m.split.simMsPerFrame, 2)} view ${fmt(m.split.viewMsPerFrame, 2)} ui ${fmt(m.split.uiMsPerFrame, 2)} audio ${fmt(m.split.audioMsPerFrame, 2)} ms/frame | step ${fmt(m.split.simMsPerStep, 2)} ms | ${last.status}${pre ? ` | ff to t=${fmt(pre.t, 0)}s bodies=${pre.bodies}` : ''}`);
    }
  }
} finally {
  mkdirSync(resolve(HERE, 'out'), { recursive: true });
  const file = resolve(HERE, 'out', `perf-${process.env.EDC_TAG || ''}${vsync ? 'vsync' : 'uncapped'}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ rows, console: consoleMsgs }, null, 1));
  console.log('console errors/warnings:', consoleMsgs.length, consoleMsgs.slice(0, 10));
  console.log('wrote', file);
  await browser.close();
}
