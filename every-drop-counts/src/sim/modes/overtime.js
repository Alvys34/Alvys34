/**
 * OVERTIME (endless, GDD §10). The pool is your life.
 *
 *  - The TANK starts with `startVolume` L. Everything you score flows into it (litres released,
 *    Sponsor Match / bonuses); fines are deducted from it. A DEMAND PUMP drains it at a rate that
 *    starts after `grace` s and rises every second: drain = drainBase + drainGrowth * (t - grace),
 *    stepping up a little at every wave too. The tank never overfills (excess still scores).
 *  - An ESCALATING WAVE GENERATOR mixes all content: waves get bigger and closer together, and
 *    Thin-Bloods, Big Givers, oxygen tanks and Inspectors join at fixed wave numbers (never in the
 *    first minute, so a run cannot be lost to bad luck early).
 *  - The run ends when the tank runs dry. Score = total litres delivered (scoring.liters).
 *
 * HUD fields (mode.summary() / sim.snapshot().overtime):
 *   { tank, tankMax, drainRate, wave, nextWaveIn, demandLevel 0..1 }
 * shift:end payload: { result: 'failed', mode: 'overtime', liters, stars: 0, time, waves, kills,
 *   drownings, bestCombo, inspectorDeaths, report: { title, lines } }
 */
import { createSpawner } from '../spawner.js';
import { createPaScript } from './pa.js';
import { overtimeReport } from './report.js';

export const OVERTIME_LEVEL = {
  id: 'overtime',
  number: 0,
  name: 'Overtime',
  subtitle: 'The tank must not run dry.',
  duration: Infinity,
  capacity: 150,
  quota: [0, 0, 0],
  hatch: { wall: 'back', x: 5.2, y: 1.2, offset: 1.2 }, // over bare floor: idle must not get free yield
  hazards: [
    { type: 'spikes', wall: 'floor', from: -1.8, to: 2.8, z: [-2.5, 2.5] },
    { type: 'saw', wall: 'left', at: -2.2, z: [-2.5, 0.6], radius: 1.1, dir: 1 },
    { type: 'grinder', wall: 'right', at: 0.4, width: 2.4, z: [-2.2, 2.2] },
    { type: 'crusher', wall: 'ceiling', at: -5.4, width: 2.6, z: [-2.5, 2.5], period: 6.0 },
    { type: 'railSaw', wall: 'ceiling', from: -1.5, to: 5.0, z: [-2.5, 2.5], radius: 1.0, period: 7 },
  ],
  waves: [],
  overtime: {
    startVolume: 32,       // L in the tank at the start
    grace: 22,             // s before the pump starts (first wave lands, player gets going)
    drainBase: 0.32,       // L/s when the pump starts
    drainGrowth: 0.0042,   // L/s added per second of overtime after the grace period
    drainPerWave: 0.02,    // L/s added per wave opened
    firstWaveAt: 1.5,
    waveEvery: [19, 9],    // s between waves: start -> minimum
    waveEveryRamp: 300,    // s to go from the first to the second
    waveCount: [4, 10],    // donors per wave: start -> maximum (+1 every `countEvery` waves)
    countEvery: 2,
    // wave index at which each type joins, and its share of later waves
    mix: [
      { type: 'thinBlood', from: 2, share: 0.25 },
      { type: 'bigGiver', from: 4, share: 0.15 },
    ],
    tanksFrom: 3, tanksEvery: 2, tanksMax: 3,     // oxygen tanks: from wave 3, every 2nd wave
    inspectorFrom: 6, inspectorEvery: 3,          // an Inspector every 3rd wave from wave 6
  },
  pa: [
    { at: 0.2, text: 'Overtime authorised. The tank must not run dry.', mood: 'calm' },
    { at: 20, text: 'The demand pump is now active. Thank you for your flexibility.', mood: 'calm' },
    { at: 120, text: 'Demand is rising. Demand is always rising.', mood: 'calm' },
    { at: 240, text: 'Overtime is voluntary. Stopping is not.', mood: 'urgent' },
    { at: 360, text: 'Please continue. Please continue. Please continue.', mood: 'glitch' },
    { at: 480, text: 'Operator, your dedication has been noted in your file.', mood: 'glitch' },
  ],
};

export default {
  id: 'overtime',
  create(ctx, level = OVERTIME_LEVEL) {
    const O = level.overtime || OVERTIME_LEVEL.overtime;
    const T = ctx.T;
    const spawner = createSpawner(ctx, level.hatch);
    const pa = createPaScript(ctx, level.pa || []);
    const rng = ctx.rng.fork(0x0e7);
    const tankMax = ctx.pool.capacity * T.pool.maxFill;
    let tank = O.startVolume;
    let lastLiters = 0;
    let nextWaveAt = O.firstWaveAt;
    let waveIndex = 0;
    let warned = false;
    let lowWarned = false;
    const mode = {
      id: 'overtime',
      status: 'running',
      result: null,
      spawner,
      clock: { t: 0, duration: Infinity, left: Infinity },
      waves: { total: Infinity, opened: 0 },
      donorsTotal: 0,
      drainRate: 0,
      drained: 0,
      get tank() { return tank; },
      get donorsLeft() { return spawner.pendingTargets + ctx.donors.filter((d) => d.alive && !d.mustSurvive).length; },

      preStep(c, dt) {
        if (mode.status !== 'running') { spawner.step(dt); return; }
        const t = (mode.clock.t += dt);
        if (!warned && t >= nextWaveAt - T.levels.waveWarning) {
          warned = true;
          c.emit('wave:incoming', { count: waveCount(waveIndex), wave: waveIndex });
        }
        if (t >= nextWaveAt) {
          const wave = buildWave(waveIndex);
          spawner.openWave(wave);
          mode.donorsTotal += wave.count;
          waveIndex++;
          mode.waves.opened = waveIndex;
          warned = false;
          const k = Math.min(1, t / O.waveEveryRamp);
          nextWaveAt = t + O.waveEvery[0] + (O.waveEvery[1] - O.waveEvery[0]) * k;
        }
        spawner.step(dt);
        pa.step(c, t);
        mode.drainRate = t < O.grace ? 0 : O.drainBase + O.drainGrowth * (t - O.grace) + O.drainPerWave * waveIndex;
        const d = Math.min(tank, mode.drainRate * dt);
        tank -= d;
        mode.drained += d;
      },

      postStep(c) {
        // everything scored flows into the tank (fines flow out); it never overfills
        const liters = c.scoring.liters;
        tank = Math.min(tankMax, tank + (liters - lastLiters));
        lastLiters = liters;
        c.pool.volume = Math.max(0, tank);
        if (mode.status !== 'running') return;
        if (!lowWarned && mode.clock.t > O.grace && tank < 10) {
          lowWarned = true;
          c.emit('pa:announce', { text: 'Tank level critical. Please donate more enthusiastically.', mood: 'urgent' });
        }
        if (tank > 18) lowWarned = false;
        if (mode.clock.t > O.grace && tank <= 0) {
          mode.status = 'ended';
          const r = {
            result: 'failed', mode: 'overtime', levelId: 'overtime', stars: 0,
            liters: Math.round(c.scoring.liters * 10) / 10,
            collected: Math.round(c.blood.collected * 10) / 10,
            bonus: Math.round(c.scoring.bonus * 10) / 10, fines: Math.round(c.scoring.fines * 10) / 10,
            time: Math.round(mode.clock.t * 10) / 10, waves: waveIndex, kills: c.scoring.kills,
            drownings: c.scoring.drownings, bestCombo: c.scoring.combo.best,
            inspectorDeaths: c.scoring.inspectorDeaths, causes: { ...c.scoring.causes },
            peakDrain: Math.round(mode.drainRate * 100) / 100,
          };
          r.report = overtimeReport(c, r);
          mode.result = r;
          c.emit('shift:end', { ...r });
        }
      },

      summary() {
        return {
          levelId: 'overtime', mode: 'overtime', status: mode.status, result: mode.result, clock: { ...mode.clock },
          drainRate: mode.drainRate, donorsLeft: mode.donorsLeft, quota: level.quota,
          overtime: {
            tank: Math.round(tank * 100) / 100, tankMax: Math.round(tankMax * 10) / 10,
            drainRate: Math.round(mode.drainRate * 1000) / 1000, wave: waveIndex,
            nextWaveIn: Math.max(0, Math.round((nextWaveAt - mode.clock.t) * 10) / 10),
            demandLevel: Math.min(1, mode.drainRate / 2.0),
            drained: Math.round(mode.drained * 10) / 10,
          },
        };
      },
    };

    function waveCount(i) { return Math.min(O.waveCount[1], O.waveCount[0] + Math.floor(i / O.countEvery)); }

    function buildWave(i) {
      const count = waveCount(i);
      const types = { standard: 0 };
      let inspector = 0;
      if (i >= O.inspectorFrom && (i - O.inspectorFrom) % O.inspectorEvery === 0) inspector = 1;
      let left = count - inspector;
      for (const m of O.mix) {
        if (i < m.from) continue;
        let n = Math.floor(left * m.share + rng.next());
        n = Math.min(n, left);
        if (n > 0) { types[m.type] = n; left -= n; }
      }
      types.standard = left;
      if (inspector) types.inspector = inspector;
      const props = [];
      if (i >= O.tanksFrom && (i - O.tanksFrom) % O.tanksEvery === 0) props.push({ type: 'oxygenTank', count: Math.min(O.tanksMax, 1 + Math.floor((i - O.tanksFrom) / 4)) });
      return { count, types, props, index: i };
    }

    return mode;
  },
};
