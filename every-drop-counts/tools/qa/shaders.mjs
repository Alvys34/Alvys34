#!/usr/bin/env node
// QA: shader programs created after the shift starts (render/precompile.js). SwiftShader is fine:
// it counts renderer.info.programs, not time.
//   node tools/qa/withserver.mjs tools/qa/shaders.mjs [--level 7] [--secs 150] [--ot 60] [--every 20] [--query "&noprewarm=1"]
import { launch, newPage, open, sleep, save, RAW } from './lib.mjs';
import { resolve } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const level = arg('level', '7'); const secs = Number(arg('secs', 150)); const otSecs = Number(arg('ot', 60));
const every = Number(arg('every', 20)); const query = arg('query', '') + `&quality=${arg('quality', 'high')}`;
const policy = arg('policy', 'smart');

const browser = await launch();
const out = { level, secs, otSecs, every, query, policy, phases: [] };
try {
  const page = await newPage(browser, Number(arg('w', 320)), Number(arg('h', 180)));
  await open(page, query);
  await page.evaluate(async (pol) => {
    const P = (await import('/tools/policies.mjs')).POLICIES;
    window.__pol = P[pol]; window.__mem = {};
    const r = window.__edc.view.ctx.renderer;
    window.__progs = () => r.info.programs.map((p) => `${p.name || 'prog'}#${p.id}`);
    window.__seen = new Set();
    // which objects use program #id (material type, object name/parent chain, shadow/depth if none)
    window.__describe = (key) => {
      const id = Number(key.split('#')[1]); const prog = r.info.programs.find((p) => p.id === id);
      const users = [];
      const scan = (root) => root && root.traverse((o) => {
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) { const pp = r.properties.get(m); if (pp && pp.programs && [...pp.programs.values()].includes(prog)) users.push(`${m.type}:${o.name || (o.parent && o.parent.name) || o.type}${o.isInstancedMesh ? '[inst]' : ''}`); }
      });
      scan(window.__edc.view.ctx.scene);
      return `${key} ${users.slice(0, 3).join(' | ') || '(not in scene: post/atlas/depth pass)'} ${prog ? prog.cacheKey.slice(0, 60).replace(/,/g, ' ') : ''}`;
    };
  }, policy);
  const progs = () => page.evaluate(() => { const l = window.__progs(); const fresh = l.filter((n) => !window.__seen.has(n)).map((n) => window.__describe(n)); l.forEach((n) => window.__seen.add(n)); return { n: l.length, fresh }; });
  let runs0 = 0;
  const waitWarm = async () => {
    const t0 = Date.now();
    for (;;) {
      const s = await page.evaluate(() => ({ busy: window.__edc.view.ctx.precompiler.busy, st: window.__edc.view.ctx.precompiler.stats }));
      // wait for THIS load's warm-up to finish (or 90 s, e.g. ?noprewarm=1)
      if (!s.busy && (s.st.runs > runs0 || Date.now() - t0 > 20000) && Date.now() - t0 > 1500) { runs0 = s.st.runs; return { ...s.st, waitedMs: Date.now() - t0 }; }
      await sleep(250);
    }
  };
  const run = async (name, seconds) => {
    const fresh = []; let t = 0;
    await page.evaluate(() => { window.__edc.setTimeScale(0); window.__mem = {}; });
    while (t < seconds) {
      const r = await page.evaluate(({ every: k, batch }) => {
        const E = window.__edc; let ended = false;
        for (let b = 0; b < batch; b++) {
          for (let i = 0; i < k; i++) { const st = E.sim.state; E.setInput(window.__pol(st, st.time, window.__mem)); E.step(1, false); }
          E.step(1, true);
          const st = E.sim.state; if (st.status === 'ended' || st.status === 'won' || st.status === 'lost') { ended = true; break; }
        }
        const st = E.sim.state;
        return { time: st.time, ended, bodies: st.parts.length, alive: st.aliveCount, fill: st.pool.fill, props: st.props.length };
      }, { every, batch: 6 });
      t = r.time;
      const p = await progs();
      if (p.fresh.length) { fresh.push({ t: +r.time.toFixed(1), fresh: p.fresh, n: p.n }); console.log(`  [${name}] t=${r.time.toFixed(1)} NEW programs: ${p.fresh.join(', ')} (total ${p.n})`); }
      if (Math.floor(r.time / 20) !== Math.floor((r.time - 0.0001 - every * 6 / 60) / 20)) console.log(`  [${name}] t=${r.time.toFixed(1)} bodies ${r.bodies} alive ${r.alive} fill ${r.fill.toFixed(2)} props ${r.props} programs ${p.n}`);
      if (r.ended) { console.log(`  [${name}] ended at t=${r.time.toFixed(1)}`); break; }
    }
    const end = await page.evaluate(() => ({ programs: window.__edc.view.ctx.renderer.info.programs.length, state: window.__edc.getState() }));
    return { fresh, programsEnd: end.programs, simT: end.state.time, bodies: end.state.bodies, errors: end.state.errors };
  };

  // boot (attract warm-up) -> shift
  await sleep(1000);
  const boot = await waitWarm(); const pb = await progs();
  console.log(`boot: programs ${pb.n} (warm ${JSON.stringify(boot)})`);
  await page.evaluate((l) => window.__edc.loadLevel(Number(l)), level);
  const w1 = await waitWarm(); const p1 = await progs();
  console.log(`shift ${level} start: programs ${p1.n} (+${p1.fresh.length}: ${p1.fresh.join(', ')}) warm ${JSON.stringify(w1)}`);
  const r1 = await run(`shift${level}`, secs);
  console.log(`shift ${level} end: programs ${r1.programsEnd}, sim t ${r1.simT.toFixed(1)}, new after start: ${r1.fresh.reduce((a, f) => a + f.fresh.length, 0)}`);
  out.phases.push({ name: `shift${level}`, start: p1.n, warm: w1, ...r1 });
  if (otSecs > 0) {
    await page.evaluate(() => { window.__edc.setTimeScale(1); window.__edc.startOvertime(); });
    const w2 = await waitWarm(); const p2 = await progs();
    console.log(`overtime start: programs ${p2.n} (+${p2.fresh.length}: ${p2.fresh.join(', ')}) warm ${JSON.stringify(w2)}`);
    const r2 = await run('overtime', otSecs);
    console.log(`overtime end: programs ${r2.programsEnd}, sim t ${r2.simT.toFixed(1)}, new after start: ${r2.fresh.reduce((a, f) => a + f.fresh.length, 0)}`);
    out.phases.push({ name: 'overtime', start: p2.n, warm: w2, ...r2 });
  }
  out.errors = page.errs;
  console.log(page.errs.length ? `ERRORS: ${page.errs.slice(0, 5).join(' | ')}` : 'no page errors');
} finally { await browser.close(); }
save(resolve(RAW, `shaders-${level}${query.includes('noprewarm') ? '-noprewarm' : ''}.json`), out);
