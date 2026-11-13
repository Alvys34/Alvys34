/**
 * Boot + wiring (owner: CORE). Other agents: make small, atomic edits to register systems.
 *
 * URL params: ?debug=1 (window.__edc harness), ?seed=123, ?autostart=2 (skip the gate, start shift 2;
 * 'overtime' starts Overtime), ?quality=low|medium|high
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { createBus } from './core/bus.js';
import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { createFeel } from './core/feel.js';
import { seedFrom } from './core/rng.js';
import { TUNABLES } from './core/tunables.js';
import { getSave, recordShiftResult, recordOvertime } from './core/save.js';
import { createSim } from './sim/index.js';
import { getLevel, nextLevel } from './sim/levels/index.js';
import { createRenderer } from './render/index.js';
import { createUI } from './ui/index.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug') && params.get('debug') !== '0';

// ---- error collection (always on; exposed as __edc.errors in debug) ----
const errors = [];
window.addEventListener('error', (e) => errors.push(String((e.error && e.error.stack) || e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(`unhandledrejection: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`));
const consoleError = console.error.bind(console);
console.error = (...a) => { errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); consoleError(...a); };

let resolveReady; let rejectReady;
const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
ready.catch(() => {});
if (DEBUG) window.__edc = { ready, errors };

// ---- AUDIO INTEGRATION POINT (src/audio is owned by the AUDIO agent) ----
// import.meta.glob keeps the build green whether or not src/audio/index.js exists.
const audioModules = import.meta.glob('./audio/index.js');
async function loadAudio() {
  const loader = audioModules['./audio/index.js'];
  if (!loader) return null;
  try {
    const mod = await loader();
    return typeof mod.createAudio === 'function' ? mod.createAudio() : null;
  } catch (err) {
    console.warn('[edc] audio unavailable:', err);
    return null;
  }
}

async function boot() {
  await RAPIER.init();
  const canvas = document.getElementById('game');
  const uiRoot = document.getElementById('ui-root');
  const save = getSave();
  const bus = createBus();
  const seed = seedFrom(params.get('seed'));
  const sim = createSim({ RAPIER, bus, seed });
  const quality = params.get('quality') || save.settings.quality;
  const view = createRenderer({ canvas, bus, settings: { ...save.settings, quality, preserveDrawingBuffer: DEBUG } });
  const ui = createUI({ root: uiRoot, bus });
  const input = createInput(window);

  const audio = await loadAudio();
  const safeAudio = (fn) => { if (!audio) return; try { fn(audio); } catch (e) { console.warn('[edc] audio call failed', e); } };
  safeAudio((a) => {
    a.attach(bus);
    a.setVolume('master', save.settings.master);
    a.setVolume('music', save.settings.music);
    a.setVolume('sfx', save.settings.sfx);
  });
  let audioUnlocked = false;
  const unlockAudio = () => { if (!audioUnlocked) { audioUnlocked = true; safeAudio((a) => a.unlock()); } };

  /** 'menu' (gate) | 'playing' | 'paused' | 'results' */
  let screen = 'menu';
  let levelRef = 1;
  let isOvertime = false;
  let resultsTimer = 0;
  let lastResult = null;

  const loop = createLoop({
    dt: TUNABLES.sim.dt,
    maxStepsPerFrame: TUNABLES.sim.maxStepsPerFrame,
    step: () => sim.step(),
    onFrameStart: handleInput,
    render,
  });
  createFeel({ bus, loop, T: TUNABLES });

  function startLevel(ref) {
    isOvertime = ref === 'overtime';
    if (!isOvertime) levelRef = getLevel(ref).id;
    ui.hideResults();
    ui.setPaused(false);
    if (isOvertime) sim.startOvertime(); else sim.loadLevel(levelRef);
    lastResult = null;
    resultsTimer = 0;
    screen = 'playing';
    loop.setPaused(false);
    loop.resetAccumulator();
    return sim.snapshot();
  }

  function setPaused(p) {
    if (p && screen === 'playing') {
      screen = 'paused';
      loop.setPaused(true);
      ui.setPaused(true, { onResume: () => setPaused(false), onRestart: () => startLevel(isOvertime ? 'overtime' : levelRef) });
      bus.emit('game:pause', { paused: true });
    } else if (!p && screen === 'paused') {
      screen = 'playing';
      loop.setPaused(false);
      ui.setPaused(false);
      bus.emit('game:pause', { paused: false });
    }
  }

  bus.on('shift:end', (r) => {
    lastResult = r;
    if (isOvertime) recordOvertime(r.liters);
    else recordShiftResult(r.levelId, { liters: r.liters, stars: r.stars, levelNumber: r.levelNumber });
    resultsTimer = 1.8; // let the last splashes land
  });

  function showResults() {
    screen = 'results';
    const nxt = isOvertime ? null : nextLevel(levelRef);
    ui.showResults(lastResult, {
      hasNext: !!nxt && lastResult.stars >= 1,
      onRetry: () => startLevel(isOvertime ? 'overtime' : levelRef),
      onNext: () => nxt && startLevel(nxt.id),
    });
  }

  function handleInput(realDt) {
    const s = input.poll(realDt);
    if (s.any) unlockAudio();
    if (screen === 'playing') {
      sim.setInput({ rotate: s.rotate, brake: s.brake, slam: s.slam });
      if (s.pause) setPaused(true);
      if (s.restart) startLevel(isOvertime ? 'overtime' : levelRef);
    } else if (screen === 'paused') {
      if (s.pause) setPaused(false);
      if (s.restart) startLevel(isOvertime ? 'overtime' : levelRef);
      sim.setInput({ rotate: 0, brake: false });
    } else {
      sim.setInput({ rotate: 0, brake: false });
    }
    if (resultsTimer > 0) {
      resultsTimer -= realDt;
      if (resultsTimer <= 0 && lastResult && screen === 'playing') showResults();
    }
  }

  function render(alpha, realDt, simDt) {
    const scale = loop.timeScale;
    view.update(sim.state, alpha, simDt);
    ui.update(sim.snapshot(), realDt);
    const a = sim.audioState();
    safeAudio((au) => au.update(realDt, { screen, fill: a.fill, drumOmega: a.drumOmega, aliveCount: a.aliveCount, sawLoad: a.sawLoad, grinderLoad: a.grinderLoad, timeScale: scale, intensity: a.intensity }));
  }

  // pause + mute on focus loss (not in debug runs: headless browsers blur freely)
  if (!DEBUG) {
    window.addEventListener('blur', () => setPaused(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { setPaused(true); safeAudio((a) => a.suspend()); } else safeAudio((a) => a.resume());
    });
  }
  window.addEventListener('resize', () => view.resize());

  // initial level behind the gate
  const auto = params.get('autostart');
  const firstRef = auto ? (auto === 'overtime' ? 'overtime' : Number(auto) || auto) : Math.min(save.progress.unlocked, 1);
  if (firstRef === 'overtime') sim.startOvertime(); else sim.loadLevel(firstRef);
  loop.setPaused(true);
  document.getElementById('boot')?.remove();
  if (auto) startLevel(firstRef);
  else ui.showGate(() => { unlockAudio(); startLevel(firstRef); });
  loop.start();

  if (DEBUG) {
    Object.assign(window.__edc, {
      sim, bus, view, loop, input, ui, audio, TUNABLES,
      loadLevel: (id) => startLevel(id),
      startOvertime: () => startLevel('overtime'),
      getState: () => ({
        screen,
        ...sim.snapshot(),
        fps: Math.round(loop.stats.fps * 10) / 10,
        stepMs: { mean: +loop.stats.stepMsMean.toFixed(3), max: +loop.stats.stepMsMax.toFixed(3), last: +loop.stats.stepMsLast.toFixed(3) },
        timeScale: loop.timeScale,
        render: view.info(),
        droplets: view.ctx.blood.dropletCount,
        quality: view.qualityName,
        audio: !!audio,
        errors: errors.length,
      }),
      setInput: (o) => { input.setOverride(o); sim.setInput(o || { rotate: 0, brake: false }); },
      // step(n) advances n fixed steps then renders once; step(n, false) skips the render (fast tooling)
      step: (n = 1, render = true) => { loop.stepNow(n, render); return window.__edc.getState(); },
      setTimeScale: (x) => loop.setTimeScale(x),
      setQuality: (name) => view.setQuality(name),
      pause: (p = true) => setPaused(p),
    });
  }
  resolveReady(true);
}

boot().catch((err) => {
  console.error('[edc] boot failed', err);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'Boot failed — see console.';
  rejectReady(err);
});
