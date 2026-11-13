#!/usr/bin/env node
/**
 * Memory growth over consecutive shifts, real time, real GPU, smart bot.
 *   node tools/local/mem-test.mjs [shifts=7,7,7] [quality=high]
 * After each shift reaches its report (and once before the first), forces a GC through CDP and
 * records: JS heap used, DOM nodes, JS event listeners, three.js geometries/textures, and the
 * Chrome GPU process private memory (Windows, via CIM). Plays each shift to its real end.
 */
import { execSync } from 'node:child_process';
import { launch, openGame, startRun } from './lib.mjs';

const [list = '7,7,7', quality = 'high'] = process.argv.slice(2);
const shifts = list.split(',').map((s) => (s === 'ot' ? 'ot' : Number(s)));
const { browser, page, context, consoleMsgs } = await launch({ uncapped: false });

function gpuProcMB() {
  try {
    const ps = "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*--type=gpu-process*' -and $_.CommandLine -like '*playwright*' } | ForEach-Object { (Get-Process -Id $_.ProcessId).PrivateMemorySize64 }";
    const out = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
    return out.trim().split(/\s+/).filter(Boolean).map((b) => Math.round(Number(b) / 1048576));
  } catch { return []; }
}
try {
  await openGame(page, `quality=${quality}&seed=1`);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const snap = async (label) => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(500);
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    const v = await page.evaluate(() => { const i = window.__edc.view.info(); const p = window.__edc.view.perf(); return { geo: i.geometries, tex: i.textures, drops: p.blood && p.blood.drops, screen: window.__edc.ui.screen }; });
    const row = { label, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, ...v, gpuProcMB: gpuProcMB() };
    console.log(JSON.stringify(row));
    return row;
  };
  await snap('before');
  let i = 0;
  for (const s of shifts) {
    i++;
    await startRun(page, s === 'ot' ? 'overtime' : s);
    const t0 = Date.now();
    await page.waitForFunction(() => window.__edc.sim.state.status === 'ended', null, { timeout: 400000, polling: 1000 });
    await page.waitForTimeout(4000); // report screen up
    const st = await page.evaluate(() => { const g = window.__edc.getState(); return { liters: g.liters, result: g.result }; });
    console.log(`shift ${s} #${i} ended after ${((Date.now() - t0) / 1000).toFixed(0)} s real, ${JSON.stringify(st)}`);
    await snap(`after #${i} (shift ${s})`);
  }
  console.log('console errors/warnings:', consoleMsgs.length, consoleMsgs.slice(0, 8));
} finally { await browser.close(); }
