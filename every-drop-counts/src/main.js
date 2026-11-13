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
import { getSave } from './core/save.js';
import { createSim } from './sim/index.js';
import { createRenderer } from './render/index.js';
import { createUI } from './ui/index.js';
import { createSimBus } from './ui/attract.js';

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
  // the sim talks through a gated bus: menus run it in attract mode without reaching audio/VFX
  const simBus = createSimBus(bus);
  const sim = createSim({ RAPIER, bus: simBus, seed });
  const quality = params.get('quality') || (save.settings.quality === 'auto' ? 'high' : save.settings.quality);
  const view = createRenderer({ canvas, bus, settings: { ...save.settings, quality, screenShake: ({ off: 0, reduced: 0.4, full: 1 })[save.settings.screenShake] ?? 1, preserveDrawingBuffer: DEBUG } });
  const input = createInput(window);

  const audio = await loadAudio();
  const safeAudio = (fn) => { if (!audio) return; try { fn(audio); } catch (e) { console.warn('[edc] audio call failed', e); } };
  safeAudio((a) => {
    a.attach(bus);
    a.setVolume('master', save.settings.master);
    a.setVolume('music', save.settings.music);
    a.setVolume('sfx', save.settings.sfx);
  });
  // ---- APP FLOW (owner: UI — src/ui/index.js holds the state machine, menus, HUD, results) ----
  const loop = createLoop({
    dt: TUNABLES.sim.dt,
    maxStepsPerFrame: TUNABLES.sim.maxStepsPerFrame,
    step: () => sim.step(),
    onFrameStart: (realDt) => ui.frame(realDt),
    render,
  });
  const ui = createUI({ root: uiRoot, bus, simBus, sim, view, loop, input, audio: safeAudio, canvas, params, debug: DEBUG });
  createFeel({ bus, loop, T: TUNABLES });

  function render(alpha, realDt, simDt) {
    const scale = loop.timeScale;
    view.update(sim.state, alpha, simDt);
    ui.update(realDt);
    const a = ui.audioState(sim.audioState());
    safeAudio((au) => au.update(realDt, { screen: ui.audioScreen, fill: a.fill, drumOmega: a.drumOmega, aliveCount: a.aliveCount, sawLoad: a.sawLoad, grinderLoad: a.grinderLoad, timeScale: scale, intensity: a.intensity }));
  }

  window.addEventListener('resize', () => view.resize());

  // boot splash + attract mode (or straight into a shift with ?autostart=N|overtime)
  const auto = params.get('autostart');
  document.getElementById('boot')?.remove();
  ui.boot({ autostart: auto ? (auto === 'overtime' ? 'overtime' : Number(auto) || auto) : null });
  loop.start();

  if (DEBUG) {
    Object.assign(window.__edc, {
      sim, bus, view, loop, input, ui, audio, TUNABLES,
      loadLevel: (id) => ui.startRun(id),
      startOvertime: () => ui.startRun('overtime'),
      getState: () => ({
        ...sim.snapshot(),
        screen: ui.screen,
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
      pause: (p = true) => ui.setPaused(p),
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
