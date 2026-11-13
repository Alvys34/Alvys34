#!/usr/bin/env node
/**
 * Where do the long frames come from? Plays a shift with the smart bot on the real GPU and logs every
 * frame > 20 ms with: sim steps that frame, per-system ms (sim/view/ui/audio from __edc.perf deltas),
 * Long Animation Frame script attribution, and what happened on the bus in the previous 100 ms.
 *   node tools/local/hitch-probe.mjs [shift=1] [seconds=30] [quality=high]
 */
import { launch, openGame, startRun, fmt } from './lib.mjs';

const [shift = '1', seconds = '30', quality = 'high'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const { browser, page, consoleMsgs } = await launch({ uncapped: !process.argv.includes('--vsync') });
await page.route('**/*', (r) => r.continue());
const notFound = [];
page.on('response', (r) => { if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`); });
try {
  await openGame(page, `quality=${quality}&seed=1`);
  await page.evaluate(() => {
    const e = window.__edc; const log = window.__hitch = { long: [], events: [], loaf: [] };
    const evs = [];
    const origEmit = e.bus.emit.bind(e.bus);
    e.bus.emit = (type, payload) => { evs.push([performance.now(), type]); if (evs.length > 400) evs.splice(0, 200); return origEmit(type, payload); };
    let last = performance.now(); let prev = e.perf();
    function tick(ts) {
      const p = e.perf(); const dt = ts - last;
      if (dt > 20 && log.long.length < 200) {
        const recent = evs.filter((x) => x[0] > ts - dt - 100).map((x) => x[1]);
        const counts = {}; for (const r of recent) counts[r] = (counts[r] || 0) + 1;
        log.long.push({ at: +(e.sim.state.time || 0).toFixed(2), dt: +dt.toFixed(1), steps: p.steps - prev.steps, sim: +(p.sim - prev.sim).toFixed(1), view: +(p.view - prev.view).toFixed(1), ui: +(p.ui - prev.ui).toFixed(1), audio: +(p.audio - prev.audio).toFixed(1), events: counts });
      }
      last = ts; prev = p; requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        for (const en of list.getEntries()) {
          if (log.loaf.length > 100) return;
          log.loaf.push({ dur: Math.round(en.duration), blocking: Math.round(en.blockingDuration), render: Math.round(en.renderStart ? en.startTime + en.duration - en.renderStart : 0), scripts: (en.scripts || []).map((s) => `${s.invoker || s.name}:${Math.round(s.duration)}ms ${s.sourceFunctionName || ''}@${(s.sourceURL || '').split('/').pop()}:${s.sourceCharPosition}`) });
        }
      }).observe({ type: 'long-animation-frame', buffered: false });
    } catch (err) { log.loafErr = String(err); }
  });
  if (process.env.HIDEUI) await page.addStyleTag({ content: '#ui-root{display:none !important}' });
  await startRun(page, shift === 'ot' ? 'overtime' : Number(shift), { policy: process.env.POL || 'smart' });
  await page.waitForTimeout(Number(seconds) * 1000);
  const log = await page.evaluate(() => window.__hitch);
  console.log(`long frames (>20 ms) in ${seconds}s:`, log.long.length);
  for (const l of log.long) console.log(JSON.stringify(l));
  console.log('LoAF entries:', log.loaf.length, log.loafErr || '');
  for (const l of log.loaf.slice(0, 25)) console.log(JSON.stringify(l));
  console.log('HTTP errors:', notFound);
  console.log('console:', consoleMsgs);
} finally { await browser.close(); }
