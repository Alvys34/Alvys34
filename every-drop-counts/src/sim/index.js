/**
 * EVERY DROP COUNTS — headless game simulation (no three, no DOM, no wall-clock).
 *
 *   import RAPIER from '@dimforge/rapier3d-compat';
 *   await RAPIER.init();
 *   const sim = createSim({ RAPIER, bus, seed: 123 });
 *   sim.loadLevel(1);                         // or 'shift-2', or an inline level object
 *   sim.setInput({ rotate: -1..1, brake, slam });   // slam = one-shot request
 *   sim.step();                               // one fixed 60 Hz step
 *   sim.state                                 // live read-only view for render/ui (see README)
 *   sim.snapshot()                            // plain JSON summary (tests, debug getState)
 *   sim.audioState()                          // { fill, drumOmega, aliveCount, sawLoad, grinderLoad, intensity }
 *
 * All positions in sim state/events are DRUM-LOCAL (rotate by drum.theta for world/screen).
 */
import { TUNABLES, deepMerge } from '../core/tunables.js';
import { createRng } from '../core/rng.js';
import { createPhysicsWorld, buildDrumShell, readback, applyFrameForces, clampAngular, resetUids } from './physics.js';
import { createDrumState, stepDrum, trySlam } from './drum.js';
import { createBloodState, stepBleeding } from './blood.js';
import { donorPreStep, donorPostStep, removePart, resetDonorIds } from './donor.js';
import { processContacts } from './contacts.js';
import { createPoolState, stepPool } from './pool.js';
import { createScoring } from './scoring.js';
import { createHazard } from './hazards/index.js';
import { createProp } from './props/index.js';
import { getLevel } from './levels/index.js';
import shiftMode from './modes/shift.js';
import overtimeMode, { OVERTIME_LEVEL } from './modes/overtime.js';

export const MODES = { shift: shiftMode, overtime: overtimeMode };

export function createSim({ RAPIER, bus, seed = 1, tunables = null } = {}) {
  if (!RAPIER) throw new Error('createSim: RAPIER (initialised) is required');
  if (!bus) throw new Error('createSim: bus is required');
  const baseTunables = tunables || TUNABLES;
  let ctx = null;
  let currentSeed = seed >>> 0;
  const pendingInput = { rotate: 0, brake: false };

  function disposeCtx() {
    if (!ctx) return;
    for (const fn of ctx.disposers) { try { fn(); } catch { /* ignore */ } }
    try { ctx.eventQueue.free(); } catch { /* ignore */ }
    try { ctx.world.free(); } catch { /* ignore */ }
    ctx = null;
  }

  function buildCtx(level, modeId) {
    disposeCtx();
    resetUids();
    resetDonorIds();
    const T = deepMerge(structuredClone(baseTunables), level.tunables || {});
    const { world, eventQueue } = createPhysicsWorld(RAPIER, T);
    const c = {
      R: RAPIER, world, eventQueue, T, bus,
      rng: createRng(currentSeed),
      dt: T.sim.dt,
      time: 0, stepIndex: 0,
      level, levelId: level.id,
      owners: new Map(),
      dyns: [], parts: [], donors: [], hazards: [], props: [],
      nextPropId: 1, debrisCount: 0,
      aliveCount: 0, aliveTargets: 0, intensity: 0,
      splashBudget: 4,
      deferred: [], disposers: [],
      drumBody: null, drumShell: null,
    };
    c.drum = createDrumState(T, level.startAngle || 0);
    world.gravity = { x: -T.drum.gravity * c.drum.ux, y: -T.drum.gravity * c.drum.uy, z: 0 };
    c.eventCounts = Object.create(null); // per-shift tallies (results report, achievements)
    c.emit = (type, payload = {}, pos = null) => {
      c.eventCounts[type] = (c.eventCounts[type] || 0) + 1;
      payload.t = Math.round(c.time * 1000) / 1000;
      if (pos) {
        const th = c.drum.theta;
        const wx = Math.cos(th) * pos[0] - Math.sin(th) * pos[1];
        payload.pan = Math.max(-1, Math.min(1, wx / 9));
        payload.pos = [round3(pos[0]), round3(pos[1]), round3(pos[2] || 0)];
      } else if (!('pan' in payload) && POSITIONAL.has(type)) {
        payload.pan = 0;
      }
      bus.emit(type, payload);
    };
    c.blood = createBloodState();
    c.pool = createPoolState(level.capacity || T.levels.defaultCapacity);
    c.scoring = createScoring(c);
    c.drumShell = buildDrumShell(c);
    c.drumBody = c.drumShell.body;
    (level.hazards || []).forEach((spec, i) => c.hazards.push(createHazard(c, spec, i + 1)));
    c.timedProps = (level.props || []).map((p) => ({ ...p, done: false }));
    c.mode = MODES[modeId].create(c, level);
    c.input = pendingInput;
    c.drum.input = pendingInput;
    return c;
  }

  function loadLevel(idOrDef, { seed: s } = {}) {
    if (s != null) currentSeed = s >>> 0;
    const level = getLevel(idOrDef);
    ctx = buildCtx(level, level.mode || 'shift');
    ctx.emit('shift:start', { levelId: level.id, mode: 'shift', name: level.name, number: level.number });
    stepPool(ctx, 0);
    return api.state;
  }

  function startOvertime({ seed: s } = {}) {
    if (s != null) currentSeed = s >>> 0;
    ctx = buildCtx(OVERTIME_LEVEL, 'overtime');
    ctx.emit('shift:start', { levelId: 'overtime', mode: 'overtime', name: OVERTIME_LEVEL.name });
    stepPool(ctx, 0);
    return api.state;
  }

  function setInput(inp = {}) {
    if ('rotate' in inp) pendingInput.rotate = Math.max(-1, Math.min(1, Number(inp.rotate) || 0));
    if ('brake' in inp) pendingInput.brake = !!inp.brake;
    if (inp.slam && ctx) ctx.drum.slamRequest = true;
  }

  function step() {
    const c = ctx;
    if (!c) return;
    const dt = c.dt;
    c.time += dt;
    c.stepIndex++;
    c.splashBudget = 3;
    c.stepSevers = 0; c.stepKills = 0;
    c.intensity *= Math.exp(-dt * 0.7);
    while (c.deferred.length) c.deferred.shift()();

    c.mode.preStep(c, dt);
    for (const p of c.timedProps) {
      if (!p.done && c.time >= p.at) { p.done = true; c.props.push(createProp(c, p, c.nextPropId++)); }
    }
    stepDrum(c, dt);
    trySlam(c);
    for (const d of c.donors) if (!d.gone) donorPreStep(c, d, dt);
    for (const h of c.hazards) if (h.preStep) h.preStep(c, dt);
    for (const p of c.props) if (!p.removed && p.preStep) p.preStep(c, dt);
    applyFrameForces(c, dt);
    if ((c.stepIndex & 7) === 0) clampAngular(c);

    c.world.step(c.eventQueue);

    readback(c.dyns);
    processContacts(c, dt);
    for (const h of c.hazards) if (h.postStep) h.postStep(c, dt);
    for (const p of c.props) if (!p.removed && p.postStep) p.postStep(c, dt);
    stepBleeding(c, dt);
    let alive = 0; let targets = 0;
    for (const d of c.donors) {
      if (d.gone) continue;
      donorPostStep(c, d, dt);
      if (d.alive) { alive++; if (!d.mustSurvive) targets++; }
    }
    c.aliveCount = alive;
    c.aliveTargets = targets;
    stepPool(c, dt);
    enforceBudgets(c);
    c.scoring.step(c, dt);
    c.mode.postStep(c, dt);
    if (c.removedThisStep) compact(c);
  }

  function enforceBudgets(c) {
    const T = c.T;
    // debris cap: oldest detached parts go first (drained ones preferred)
    let detached = 0;
    for (const p of c.parts) if (!p.removed && p.severed) detached++;
    if (detached > T.sim.debrisCap) {
      const cand = c.parts.filter((p) => !p.removed && p.severed)
        .sort((a, b) => (a.blood > 0) - (b.blood > 0) || a.detachedAt - b.detachedAt);
      for (let i = 0; i < detached - T.sim.debrisCap; i++) removePart(c, cand[i], { release: false });
    }
    // body budget: dissolve the oldest corpses
    let bodies = 0;
    for (const d of c.dyns) if (!d.removed) bodies++;
    if (bodies > T.sim.maxBodies - 22) {
      const dead = c.donors.filter((d) => !d.alive && !d.gone).sort((a, b) => a.deathTime - b.deathTime);
      if (dead.length) for (const p of dead[0].partList) if (!p.removed) removePart(c, p, { release: false });
    }
  }

  function compact(c) {
    c.removedThisStep = false;
    c.dyns = c.dyns.filter((d) => !d.removed);
    c.parts = c.parts.filter((p) => !p.removed);
  }

  function audioState() {
    const c = ctx;
    if (!c) return { fill: 0, drumOmega: 0, aliveCount: 0, sawLoad: 0, grinderLoad: 0, intensity: 0 };
    let saw = 0; let grinder = 0;
    for (const h of c.hazards) {
      if (h.type === 'saw' || h.type === 'railSaw' || h.type === 'rail-saw') saw = Math.max(saw, h.load);
      if (h.type === 'grinder') grinder = Math.max(grinder, h.load);
    }
    return {
      fill: c.pool.fill, drumOmega: c.drum.omega, aliveCount: c.aliveCount,
      sawLoad: saw, grinderLoad: grinder, intensity: Math.min(1, c.intensity + c.pool.fill * 0.3),
    };
  }

  function snapshot() {
    const c = ctx;
    if (!c) return null;
    const m = c.mode.summary();
    let bodies = 0;
    for (const d of c.dyns) if (!d.removed) bodies++;
    return {
      levelId: c.levelId, mode: m.mode, status: m.status, result: m.result,
      time: round3(c.time), step: c.stepIndex,
      clock: { t: round3(m.clock.t), left: Number.isFinite(m.clock.left) ? round3(m.clock.left) : null, duration: Number.isFinite(m.clock.duration) ? m.clock.duration : null },
      liters: round3(m.result ? m.result.liters : c.scoring.liters), collected: round3(c.blood.collected), bonus: round3(c.scoring.bonus), fines: round3(c.scoring.fines),
      donorBloodTotal: round3(c.blood.donorTotal),
      fill: round3(c.pool.fill), poolLevel: round3(c.pool.level), poolVolume: round3(c.pool.volume),
      quota: m.quota, stars: m.result ? m.result.stars : null,
      alive: c.aliveCount, dead: c.donors.filter((d) => !d.alive).length, donors: c.donors.length,
      donorsLeft: m.donorsLeft, kills: c.scoring.kills, drownings: c.scoring.drownings,
      combo: { count: c.scoring.combo.count, multiplier: c.scoring.combo.multiplier, best: c.scoring.combo.best },
      bodies, debris: c.parts.filter((p) => !p.removed && p.severed).length,
      drum: { theta: round3(c.drum.theta), omega: round3(c.drum.omega) },
      slam: { cooldown: round3(c.drum.slamCooldown), ready: c.drum.slamCooldown <= 0, count: c.drum.slamCount },
      hazards: c.hazards.map((h) => ({ id: h.id, type: h.type, load: round3(h.load) })),
      props: c.props.filter((p) => !p.removed).map((p) => ({ id: p.id, type: p.type, state: p.view && p.view.state, hits: p.view && p.view.hits })),
      inspectors: c.donors.filter((d) => d.mustSurvive).map((d) => ({ id: d.id, alive: d.alive, encased: !!d.encased, hits: d.sphere ? d.sphere.view.hits : null })),
      aliveTargets: c.aliveTargets,
      overtime: m.overtime || null,
      blood: { pending: round3(c.blood.pending), dissolved: round3(c.blood.dissolved) },
    };
  }

  const api = {
    loadLevel, startOvertime, setInput, step, snapshot, audioState,
    get ctx() { return ctx; },
    get seed() { return currentSeed; },
    setSeed(s) { currentSeed = s >>> 0; },
    /** Live, read-only view (do not mutate). Positions are drum-local. */
    get state() {
      const c = ctx;
      if (!c) return null;
      return {
        time: c.time, stepIndex: c.stepIndex, level: c.level, levelId: c.levelId,
        mode: c.mode, status: c.mode.status, result: c.mode.result,
        clock: c.mode.clock, drum: c.drum, pool: c.pool, blood: c.blood, scoring: c.scoring,
        donors: c.donors, parts: c.parts, dyns: c.dyns, hazards: c.hazards, props: c.props,
        hatch: c.mode.spawner ? c.mode.spawner.hatch : null,
        hatchPos: c.mode.spawner ? c.mode.spawner.position() : null,
        aliveCount: c.aliveCount, donorsLeft: c.mode.donorsLeft,
        T: c.T,
      };
    },
    dispose() { disposeCtx(); },
  };
  return api;
}

const POSITIONAL = new Set(['hatch:open', 'donor:spawn', 'donor:hurt', 'donor:death', 'limb:sever', 'limb:break', 'impact', 'blood:spurt', 'blood:splat', 'splash', 'hazard:contact', 'hazard:telegraph', 'grinder:clog', 'grinder:clear', 'prop:puncture', 'prop:explode', 'sphere:crack', 'sphere:shatter']);

function round3(v) { return Math.round(v * 1000) / 1000; }
