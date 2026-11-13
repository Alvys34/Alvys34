#!/usr/bin/env node
/**
 * CPU profile (CDP sampling profiler) of a real-GPU run, aggregated by function self time.
 *   node tools/local/cpu-profile.mjs [shift=1] [fromSec=0] [toSec=6] [quality=high] [--dev]
 * Prints the top functions by self time inside the window and writes the .cpuprofile to out/
 * (open it in Chrome DevTools > Performance to see the flame chart).
 * --dev profiles the Vite dev server on :5174 (unminified names) instead of the build.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, openGame, startRun, HERE } from './lib.mjs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [shift = '1', from = '0', to = '6', quality = 'high'] = pos;
if (process.argv.includes('--dev')) process.env.EDC_BASE = 'http://localhost:5174/';
const { browser, page, context } = await launch({ uncapped: true });
try {
  await openGame(page, `quality=${quality}&seed=1`);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await startRun(page, shift === 'ot' ? 'overtime' : Number(shift));
  if (Number(from) > 0) await page.waitForTimeout(Number(from) * 1000);
  await cdp.send('Profiler.start');
  await page.waitForTimeout((Number(to) - Number(from)) * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  mkdirSync(resolve(HERE, 'out'), { recursive: true });
  const file = resolve(HERE, 'out', `cpu-s${shift}-${from}-${to}.cpuprofile`);
  writeFileSync(file, JSON.stringify(profile));
  // self time per node
  const dt = new Map(); const ids = profile.samples; const deltas = profile.timeDeltas;
  for (let i = 0; i < ids.length; i++) dt.set(ids[i], (dt.get(ids[i]) || 0) + (deltas[i] || 0) / 1000);
  const agg = new Map(); let total = 0;
  for (const n of profile.nodes) {
    const ms = dt.get(n.id) || 0; total += ms;
    const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${(cf.url || '').split('/').pop()}:${cf.lineNumber}:${cf.columnNumber}`;
    agg.set(key, (agg.get(key) || 0) + ms);
  }
  const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log(`window ${from}-${to}s, total sampled ${total.toFixed(0)} ms`);
  for (const [k, ms] of top) console.log(`${ms.toFixed(1).padStart(8)} ms  ${k}`);
  console.log('wrote', file);
} finally { await browser.close(); }
