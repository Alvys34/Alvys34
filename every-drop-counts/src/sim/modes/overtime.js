/**
 * OVERTIME (endless, GDD §10) — BASELINE implementation for CONTENT to deepen.
 * The pool is your life: a demand pump drains it at a rising rate; waves get denser.
 * The tank running dry (after a grace period) ends the run. Score = total litres delivered.
 *
 * Uses the overtime level (levels/overtime-arena below) for hatch + hazards.
 */
import { createSpawner } from '../spawner.js';
import { createPaScript } from './pa.js';

export const OVERTIME_LEVEL = {
  id: 'overtime',
  number: 0,
  name: 'Overtime',
  duration: Infinity,
  capacity: 140,
  quota: [0, 0, 0],
  hatch: { wall: 'ceiling', at: 0, offset: 1.0 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -6, to: 6, z: [-2.5, 2.5] },
    { type: 'saw', wall: 'left', at: -2.5, z: [-2.5, 0.5], radius: 1.1, dir: 1 },
    { type: 'saw', wall: 'right', at: -2.5, z: [-0.5, 2.5], radius: 1.1, dir: -1 },
  ],
  waves: [],
  overtime: {
    startVolume: 25,      // L in the tank at the start
    grace: 15,            // s before the pump starts
    drainBase: 0.25,      // L/s
    drainGrowth: 0.006,   // L/s added per second survived
    waveEvery: [18, 8],   // s between waves: start -> minimum
    waveCount: [3, 8],
  },
  pa: [
    { at: 0.2, text: 'Overtime authorised. The tank must not run dry.', mood: 'calm' },
    { at: 60, text: 'Demand is rising. Thank you for your flexibility.', mood: 'urgent' },
  ],
};

export default {
  id: 'overtime',
  create(ctx, level = OVERTIME_LEVEL) {
    const O = level.overtime || OVERTIME_LEVEL.overtime;
    const spawner = createSpawner(ctx, level.hatch);
    const pa = createPaScript(ctx, level.pa || []);
    let drained = 0;
    let nextWaveAt = 1.5;
    let waveIndex = 0;
    const mode = {
      id: 'overtime',
      status: 'running',
      result: null,
      spawner,
      clock: { t: 0, duration: Infinity, left: Infinity },
      waves: { total: Infinity, opened: 0 },
      donorsTotal: 0,
      drainRate: 0,
      get donorsLeft() { return spawner.pending + ctx.donors.filter((d) => d.alive).length; },
      preStep(c, dt) {
        if (mode.status !== 'running') { spawner.step(dt); return; }
        const t = (mode.clock.t += dt);
        if (t >= nextWaveAt - c.T.levels.waveWarning && !mode._warned) {
          mode._warned = true;
          c.emit('wave:incoming', { count: waveCount(waveIndex) });
        }
        if (t >= nextWaveAt) {
          const count = waveCount(waveIndex);
          spawner.openWave({ count, index: waveIndex });
          mode.donorsTotal += count;
          waveIndex++;
          mode.waves.opened = waveIndex;
          mode._warned = false;
          const k = Math.min(1, t / 240);
          nextWaveAt = t + O.waveEvery[0] + (O.waveEvery[1] - O.waveEvery[0]) * k;
        }
        spawner.step(dt);
        pa.step(c, t);
        mode.drainRate = t < O.grace ? 0 : O.drainBase + O.drainGrowth * (t - O.grace);
        drained += mode.drainRate * dt;
      },
      postStep(c) {
        c.pool.volume = Math.max(0, O.startVolume + c.blood.collected - drained);
        if (mode.status !== 'running') return;
        if (mode.clock.t > O.grace && c.pool.volume <= 0) {
          mode.status = 'ended';
          const liters = Math.round(c.scoring.liters * 10) / 10;
          mode.result = { result: 'failed', liters, stars: 0, levelId: 'overtime', mode: 'overtime', time: Math.round(mode.clock.t), kills: c.scoring.kills };
          c.emit('shift:end', { ...mode.result });
        }
      },
      summary() {
        return { levelId: 'overtime', mode: 'overtime', status: mode.status, result: mode.result, clock: { ...mode.clock }, drainRate: mode.drainRate, donorsLeft: mode.donorsLeft, quota: level.quota };
      },
    };
    function waveCount(i) { return Math.min(O.waveCount[1], O.waveCount[0] + Math.floor(i / 2)); }
    return mode;
  },
};
