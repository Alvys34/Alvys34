// Playwright runner for the audio meters / stress test.
//   node tools/audio/run.mjs                 full run (raw sounds, events, loops, music, 60 s stress, robustness)
//   node tools/audio/run.mjs --only=raw,events --stress=20 --wav
// Writes tools/audio/out/report.json (and WAVs with --wav). Exit code 1 if any assertion fails.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { TARGETS } from './targets.mjs';
import { TRIM_DB } from '../../src/audio/mix.js';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch (e) {
  // globally installed playwright: resolve from the global node_modules
  const { execSync } = await import('node:child_process');
  const g = execSync('npm root -g').toString().trim();
  playwright = require(path.join(g, 'playwright'));
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const only = args.only ? String(args.only).split(',') : ['raw', 'events', 'loops', 'music', 'stress', 'robust'];
const STRESS_S = Number(args.stress || 60);
const PORT = Number(args.port || 5181);

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); return cond; };

function table(rows, cols) {
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals) => vals.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ');
  console.log(line(cols));
  console.log(w.map((n) => '-'.repeat(n)).join('  '));
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
  console.log('');
}

const server = await startServer(PORT);
const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const report = { date: new Date().toISOString() };
try {
  await page.goto(`http://127.0.0.1:${PORT}/tools/audio/test.html`);
  await page.waitForFunction(() => window.__audioHarnessReady === true, null, { timeout: 15000 });
  fs.mkdirSync(OUT, { recursive: true });
  const COLS = ['id', 'cls', 'peakDb', 'momDb', 'rmsDb', 'durMs', 'centroidHz', 'lowPct', 'midPct', 'highPct', 'flatness', 'clip'];

  if (only.includes('raw')) {
    console.log('== RAW SOUNDS (through class bus + master chain; variant 0; dBFS) ==');
    const raw = await page.evaluate((n) => window.__audioHarness.measureRaw(n), Number(args.variants || 3));
    report.raw = raw;
    for (const r of raw) { const t = TARGETS[r.id]; r.target = t ?? ''; r.delta = t != null ? +(r.momDb - t).toFixed(1) : ''; }
    table(raw, [...COLS, 'momSpread', 'target', 'delta']);
    if (args.autotrim) {
      const next = { ...TRIM_DB };
      for (const r of raw) if (TARGETS[r.id] != null) next[r.id] = Math.round(((TRIM_DB[r.id] || 0) - r.delta) * 2) / 2;
      for (const k of Object.keys(next)) if (next[k] === 0) delete next[k];
      console.log('Suggested TRIM_DB:\n' + JSON.stringify(next).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ') + '\n');
    }
    for (const r of raw) if (r.delta !== '' && !r.id.includes('#')) check(Math.abs(r.delta) <= 3, `raw ${r.id} is ${r.delta} dB off its mix target`);
    for (const r of raw) {
      check(!r.clip, `raw ${r.id} clips (peak ${r.peakDb} dBFS)`);
      check(r.momDb > -45, `raw ${r.id} nearly silent (${r.momDb} dB)`);
      check(r.errors === 0, `raw ${r.id} engine errors: ${r.errorLog}`);
    }
    const by = Object.fromEntries(raw.map((r) => [r.id, r]));
    // design sanity: spectral shapes
    check(by.crack.centroidHz > 1500 && by.crack.durMs < 250, `crack should be short & bright (centroid ${by.crack.centroidHz}, ${by.crack.durMs} ms)`);
    check(by.slam.lowPct > 50, `slam should be mostly < 250 Hz (low ${by.slam.lowPct}%)`);
    check(by.thud.centroidHz < 900, `thud should be low (centroid ${by.thud.centroidHz})`);
    check(by.squelch.centroidHz > 250 && by.squelch.centroidHz < 2500 && by.squelch.flatness > 0.01, `squelch should be noisy low-mid (centroid ${by.squelch.centroidHz}, flat ${by.squelch.flatness})`);
    check(by.tink.centroidHz > 2000, `glass tink should be bright (${by.tink.centroidHz})`);
    check(by.glassShatter.centroidHz > 2500, `shatter should be bright (${by.glassShatter.centroidHz})`);
    // relative loudness: gore & slam prominent, UI subtle
    check(by.squelch.momDb - by.uiHover.momDb > 10, `squelch should be >10 dB louder than ui hover (${by.squelch.momDb} vs ${by.uiHover.momDb})`);
    check(by.slam.momDb >= by.squelch.momDb - 2, `slam should be at least as prominent as a squelch (${by.slam.momDb} vs ${by.squelch.momDb})`);
    check(by.uiClick.momDb < by.squelch.momDb - 6, `ui click should sit well under gore (${by.uiClick.momDb})`);
    check(by.explosion.momDb >= by.slam.momDb - 3, `explosion should be among the loudest (${by.explosion.momDb})`);
  }

  if (only.includes('events')) {
    console.log('== BUS EVENTS (full response as the game would hear it) ==');
    const ev = await page.evaluate(() => window.__audioHarness.measureEvents());
    report.events = ev;
    table(ev, COLS.filter((c) => c !== 'cls'));
    for (const r of ev) {
      check(!r.clip, `event ${r.id} clips`);
      // a soft tumbling contact (below the impact curve, see src/audio/events.js) must stay silent
      if (/ soft$/.test(r.id)) check(r.momDb < -60, `event ${r.id} should be silent (${r.momDb} dB)`);
      else check(r.momDb > -50, `event ${r.id} silent (${r.momDb} dB)`);
      check(r.errors === 0, `event ${r.id} engine errors: ${r.errorLog}`);
    }
  }

  if (only.includes('loops')) {
    console.log('== CONTINUOUS LOOPS (steady state, state-driven) ==');
    const lp = await page.evaluate(() => window.__audioHarness.measureLoops());
    report.loops = lp;
    table(lp, COLS.filter((c) => c !== 'cls'));
    const by = Object.fromEntries(lp.map((r) => [r.id, r]));
    check(by['motor ω=2.2'].momDb > by['motor ω=0.4'].momDb + 2, 'motor should get louder with |ω|');
    check(by['saw load=1'].momDb > by['saw idle'].momDb + 3, 'saw should grind louder under load');
    check(by['saw idle'].momDb > -34, 'idle saw whine should be audible');
    check(by['grinder load=1'].momDb > by['grinder idle'].momDb, 'grinder louder under load');
    for (const r of lp) check(!r.clip, `loop ${r.id} clips`);
    const lat = await page.evaluate(() => window.__audioHarness.motorLatency());
    report.motorLatency = lat;
    console.log('motor onset latency:', lat, '\n');
    check(lat.latencyMs != null && lat.latencyMs <= 5, `motor should be audible within 5 ms of the state change (got ${lat.latencyMs})`);
    check(lat.halfLevelMs != null && lat.halfLevelMs <= 60, `motor body should reach half level within 60 ms (50 ms window) (got ${lat.halfLevelMs})`);
  }

  if (only.includes('music')) {
    console.log('== MUSIC (last 9 s of a 14 s render) ==');
    const mu = await page.evaluate(() => window.__audioHarness.measureMusic());
    report.music = mu;
    table(mu, [...COLS.filter((c) => c !== 'cls'), 'inTune', 'inKey']);
    const by = Object.fromEntries(mu.map((r) => [r.id, r]));
    const clean = by['shift fill=0 int=0'], wrecked = by['shift fill=1'], half = by['shift fill=0.5'];
    check(wrecked.inTune < clean.inTune - 0.15, `music should go out of tune with fill (in-tune ${clean.inTune} -> ${wrecked.inTune})`);
    check(half.inTune <= clean.inTune, 'music at fill 0.5 should be less in tune than at 0');
    check(wrecked.inKey < clean.inKey, `music should get sour (in-key ${clean.inKey} -> ${wrecked.inKey})`);
    check(wrecked.lowPct < clean.lowPct - 20, 'music at fill 1 should lose its low end (tinny speaker)');
    check(Math.abs(wrecked.momDb - clean.momDb) < 4, `degraded music should not jump in loudness (${clean.momDb} -> ${wrecked.momDb})`);
    check(by['paused (fill=0)'].momDb < by['shift fill=0 int=0'].momDb - 4, 'paused music should be clearly quieter');
    check(by['shift slow-mo 0.35'].centroidHz < by['shift fill=0 int=0'].centroidHz, 'slow-mo should pitch music down');
    for (const r of mu) check(!r.clip, `music ${r.id} clips`);
    const duck = await page.evaluate(() => window.__audioHarness.measureDuck());
    report.duck = duck;
    console.log('duck test (music + slam):', duck, '\n');
    if (report.raw) {
      const sq = report.raw.find((r) => r.id === 'squelch');
      check(by['shift fill=0 int=0'].rmsDb < sq.momDb - 6, `music RMS should sit under a squelch (music ${by['shift fill=0 int=0'].rmsDb} vs squelch ${sq.momDb})`);
    }
  }

  if (only.includes('robust')) {
    console.log('== ROBUSTNESS ==');
    const rb = await page.evaluate(() => window.__audioHarness.robustness());
    report.robustness = rb;
    console.log(rb, '\n');
    check(rb.issues.length === 0, 'robustness: exceptions escaped: ' + rb.issues.join('; '));
    check(rb.noAudioOk, 'robustness: no-WebAudio path threw');
    check(rb.listenersAfterDoubleAttach === rb.expectedListeners, `double attach should not duplicate listeners (${rb.listenersAfterDoubleAttach})`);
    check(rb.listenersAfterDispose === 0, 'dispose should unsubscribe everything');
  }

  if (only.includes('stress')) {
    console.log(`== STRESS: ${STRESS_S} s busy shift, real-time AudioContext ==`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const handlers = [];
    const metric = async () => { const m = await cdp.send('Performance.getMetrics'); const g = (n) => (m.metrics.find((x) => x.name === n) || {}).value; return { audioHandlers: g('AudioHandlers'), heapMB: +(g('JSHeapUsedSize') / 1e6).toFixed(1) }; };
    handlers.push({ t: 0, ...(await metric()) });
    const poll = setInterval(async () => { try { handlers.push({ t: handlers.length * 2, ...(await metric()) }); } catch (e) { /* page busy */ } }, 2000);
    const st = await page.evaluate((s) => window.__audioHarness.stress(s), STRESS_S);
    clearInterval(poll);
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    handlers.push({ t: 'after+gc', ...(await metric()) });
    report.stress = st;
    report.audioHandlers = handlers;
    if (st.error) { check(false, 'stress error: ' + st.error); console.log(st.error); }
    else {
      table(st.perSec, ['sec', 'peakDb', 'rmsDb', 'over', 'voices', 'dying', 'voiceNodes', 'musicNodes', 'events', 'ctxTime', 'wall']);
      console.log('AudioHandlers (live WebAudio nodes, Chrome counter) every 2 s:', handlers.map((h) => `${h.t}:${h.audioHandlers}`).join(' '));
      console.log('JS heap MB:', handlers.map((h) => h.heapMB).join(' '));
      console.log({ totalEvents: st.totalEvents, emitMeanUs: st.emitMeanUs, emitMaxMs: st.emitMaxMs, updateMeanMs: st.updateMeanMs, updateMaxMs: st.updateMaxMs, frameMaxMs: st.frameMaxMs, ctxState: st.ctxState, ctxTime: st.ctxTime, wallTime: st.wallTime });
      console.log('voice stats:', JSON.stringify(st.stats.voiceStats), 'bank:', { rendered: st.stats.bankRendered, totalRenderMs: Math.round(st.stats.bankRenderMs), maxRenderMs: +st.stats.bankMaxRenderMs.toFixed(1) });
      console.log('after tails:', { voices: st.after.voices, dying: st.after.dying, voiceNodes: st.after.voiceNodes, musicNodes: st.after.musicNodes }, 'after dispose:', { voiceNodes: st.afterDispose.voiceNodes, musicNodes: st.afterDispose.musicNodes });
      console.log('');
      check(st.stats.errors === 0, 'stress: internal errors ' + st.stats.errorLog.join('; '));
      check(st.ctxState === 'running', 'stress: context not running');
      const active = st.perSec.filter((s) => s.sec > 1 && !(s.sec >= 50 && s.sec < 52));
      check(active.every((s) => s.rmsDb > -50), 'stress: output went silent in some second(s)');
      check(st.perSec.every((s) => s.over === 0), 'stress: output hit the clip ceiling (>= 0.995) in some second(s)');
      check(Math.max(...st.perSec.map((s) => s.voices)) <= 48, 'stress: voice cap exceeded');
      check(Math.max(...st.perSec.map((s) => s.voiceNodes + s.musicNodes)) < 400, 'stress: live node count unbounded');
      check(st.emitMeanUs < 50, `stress: mean per-event cost too high (${st.emitMeanUs} µs)`);
      check(st.updateMeanMs < 1.0, `stress: mean update cost too high (${st.updateMeanMs} ms)`);
      check(st.after.voiceNodes === 0 || st.after.voices <= 6, 'stress: voices not cleaned up after tails');
      check(st.afterDispose.voiceNodes === 0 && st.afterDispose.musicNodes === 0, 'stress: nodes left after dispose');
      // Chrome counts finished nodes until JS GC collects them; a leak shows up as a high count after a forced GC.
      const h = handlers.filter((x) => typeof x.audioHandlers === 'number');
      const afterGc = h[h.length - 1].audioHandlers;
      report.audioHandlersPeak = Math.max(...h.map((x) => x.audioHandlers));
      console.log('AudioHandlers peak between GCs:', report.audioHandlersPeak, 'after dispose + forced GC:', afterGc);
      check(afterGc < 150, `stress: WebAudio nodes not collected after dispose+GC (${afterGc})`);
      check(Math.max(...h.map((x) => x.heapMB)) < 64, 'stress: JS heap grew beyond 64 MB');
    }
  }

  if (args.wav) {
    console.log('== WAV export ==');
    const wavs = [
      ['music_menu', { dur: 24, music: true, state: { screen: 'menu' } }],
      ['music_shift_fill0', { dur: 24, music: true, state: { screen: 'playing', intensity: 0.6 } }],
      ['music_shift_fill05', { dur: 24, music: true, state: { screen: 'playing', fill: 0.5, intensity: 0.6 } }],
      ['music_shift_fill1', { dur: 24, music: true, state: { screen: 'playing', fill: 1, intensity: 0.6 } }],
      ['music_fill_ramp_0_to_1', { dur: 45, music: true, state: { screen: 'playing', intensity: 0.6 }, stateAt: null, ramp: true }],
    ];
    const rawList = await page.evaluate(() => window.__audioHarness.RAW.map(([c, n, o]) => [c, n, o || {}]));
    const evList = await page.evaluate(() => window.__audioHarness.EVENT_CASES.map(([l, p, t]) => [l, p, t || l]));
    const write = (name, b64) => fs.writeFileSync(path.join(OUT, name.replace(/[^\w.-]+/g, '_') + '.wav'), Buffer.from(b64, 'base64'));
    for (const [name, sc] of wavs) {
      const b64 = await page.evaluate((sc) => { if (sc.ramp) sc.stateAt = (t) => ({ fill: Math.min(1, t / 40) }); return window.__audioHarness.renderWav(sc); }, sc);
      write(name, b64);
    }
    // one file per raw sound: 3 random variants spaced 1.2 s apart
    for (const [cls, name] of rawList) {
      const b64 = await page.evaluate(([cls, name]) => window.__audioHarness.renderWav({ dur: 4.5, plays: [[0, cls, name, {}], [1.3, cls, name, {}], [2.6, cls, name, {}]] }), [cls, name]);
      write('raw_' + name, b64);
    }
    for (const [label, payload, type] of evList) {
      const b64 = await page.evaluate(([type, payload]) => window.__audioHarness.renderWav({ dur: 3.5, events: [[0.1, type, payload]] }), [type, payload]);
      write('event_' + label, b64);
    }
    // a 20 s mini-shift soundscape
    const b64 = await page.evaluate(() => {
      const ev = [];
      let id = 0;
      const R = Math.random;
      ev.push([0, 'shift:start', {}]);
      for (let t = 1.5; t < 20; t += 0.05) {
        if (R() < 0.5) ev.push([t, 'blood:splat', { size: R() * 2, pan: R() * 2 - 1 }]);
        if (R() < 0.15) ev.push([t, 'impact', { kind: 'flesh', speed: R() * 14, mass: 5, pan: R() * 2 - 1 }]);
        if (R() < 0.02) ev.push([t, 'donor:death', { id: id++, cause: ['cut', 'impale', 'crush', 'grind'][Math.floor(R() * 4)], pan: R() * 2 - 1 }]);
        if (R() < 0.03) ev.push([t, 'hazard:contact', { hazard: 'saw', intensity: R(), pan: 0.4 }]);
        if (R() < 0.02) ev.push([t, 'donor:hurt', { id: Math.floor(R() * 9), amount: 9, pan: R() * 2 - 1 }]);
      }
      ev.push([6, 'slam', {}], [9, 'pa:announce', { text: 'Please keep your limbs inside the drum.', mood: 'calm' }], [14, 'combo', { multiplier: 4 }], [16, 'slam', {}]);
      return window.__audioHarness.renderWav({ dur: 21, music: true, state: { screen: 'playing', hasSaw: true, intensity: 0.6 }, events: ev, stateAt: (t) => ({ fill: t / 20, drumOmega: 1.6 * Math.sin(t * 0.6), sawLoad: 0.3 }) });
    });
    write('soundscape_minishift', b64);
    console.log('WAVs written to', OUT, '\n');
  }

  report.consoleErrors = consoleErrors;
  check(consoleErrors.filter((e) => !/\[audio\]/.test(e)).length === 0, 'page console errors: ' + consoleErrors.join(' | '));
} catch (e) {
  failures.push('runner exception: ' + (e && e.stack || e));
} finally {
  report.failures = failures;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
}

if (failures.length) { console.log('FAILURES (' + failures.length + '):\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('ALL AUDIO CHECKS PASSED');
