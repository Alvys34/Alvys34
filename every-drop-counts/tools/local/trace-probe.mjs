#!/usr/bin/env node
/**
 * Chrome trace of a real-GPU run (renderer main thread, compositor, GPU process), then lists the
 * biggest events by duration, grouped by name, inside the window. Finds work that JS timers miss:
 * style/layout/paint of the DOM HUD, raster, GPU tasks, GC.
 *   node tools/local/trace-probe.mjs [shift=1] [fromSec=8] [seconds=6] [--vsync]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, openGame, startRun, HERE } from './lib.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [shift = '1', from = '8', secs = '6'] = pos;
const { browser, page } = await launch({ uncapped: !process.argv.includes('--vsync') });
try {
  await openGame(page, 'quality=high&seed=1');
  await startRun(page, Number(shift));
  await page.waitForTimeout(Number(from) * 1000);
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'v8', 'v8.gc', 'blink', 'cc', 'gpu', 'viz', 'toplevel', 'benchmark'] });
  await page.waitForTimeout(Number(secs) * 1000);
  const buf = await browser.stopTracing();
  const file = resolve(HERE, 'out', `trace-s${shift}.json`); writeFileSync(file, buf);
  const { traceEvents } = JSON.parse(buf.toString());
  const threads = {}; for (const e of traceEvents) if (e.ph === 'M' && e.name === 'thread_name') threads[`${e.pid}:${e.tid}`] = e.args.name;
  const big = traceEvents.filter((e) => e.ph === 'X' && e.dur > 8000);
  const agg = {};
  for (const e of big) { const k = `${threads[`${e.pid}:${e.tid}`] || e.tid} | ${e.name}`; (agg[k] ||= []).push(Math.round(e.dur / 1000)); }
  for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].length - a[1].length).slice(0, 40)) console.log(`${String(v.length).padStart(4)}x  max ${Math.max(...v)} ms  ${k}  [${v.slice(0, 12).join(',')}]`);
  console.log('wrote', file);
} finally { await browser.close(); }
