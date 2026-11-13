#!/usr/bin/env node
/**
 * Does the auto-quality governor (src/render/quality.js) react sensibly on a weak GPU?
 * Runs with ?autoq=1 (governor on, as in release), vsync on, starting at the given preset, and logs
 * once per second: preset, governor level, its smoothed frame ms, pixel ratio, real fps over that
 * second, bodies, particles.
 *   EDC_CHROME_ARGS=--use-adapter-luid=0,76383 node tools/local/governor-test.mjs [run=7] [seconds=120] [quality=high]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, openGame, startRun, fastForward, gpuInfo, HERE } from './lib.mjs';

const [run = '7', seconds = '120', quality = 'high'] = process.argv.slice(2);
const { browser, page } = await launch({ uncapped: false });
const log = [];
try {
  await openGame(page, `quality=${quality}&seed=1&autoq=1`);
  console.log('GPU:', (await gpuInfo(page)).renderer);
  await startRun(page, run === 'ot' ? 'overtime' : Number(run));
  if (run === 'ot') console.log('ff', await fastForward(page, { untilBodies: 380, maxSimSeconds: 400 }));
  await page.evaluate(() => { window.__bot.frames = []; });
  let last = 0;
  for (let s = 1; s <= Number(seconds); s++) {
    await page.waitForTimeout(1000);
    const r = await page.evaluate((last) => {
      const e = window.__edc; const p = e.view.perf(); const f = window.__bot.frames;
      const n = f.length - last; const span = n > 1 ? (f[f.length - 1] - f[last]) / 1000 : 1;
      let bodies = 0; for (const d of e.sim.ctx.dyns) if (!d.removed) bodies++;
      return { n: f.length, fps: +(n / Math.max(0.001, span)).toFixed(0), quality: p.quality, level: p.autoLevel, govMs: p.frameMs, pr: p.pixelRatio, load: p.loadScale, bodies, drops: p.blood && p.blood.drops, status: e.sim.state.status };
    }, last);
    last = r.n; delete r.n; r.t = s; log.push(r);
    if (s % 5 === 0 || (log.length > 1 && (r.level !== log[log.length - 2].level || r.quality !== log[log.length - 2].quality))) console.log(JSON.stringify(r));
    if (r.status === 'ended') break;
  }
} finally {
  writeFileSync(resolve(HERE, 'out', `governor-${run}-${quality}.json`), JSON.stringify(log));
  await browser.close();
}
