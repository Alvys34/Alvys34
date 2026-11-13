/**
 * Shift mode: waves, clock, quota thresholds -> stars, complete / timeout / failed.
 *
 * Mode interface (see src/sim/README.md "Adding a mode"):
 *   create(ctx, level) -> {
 *     id, status: 'running'|'ended', result: null | {result, liters, stars, ...},
 *     clock: { t, duration, left },
 *     preStep(ctx, dt), postStep(ctx, dt), onBlood?(ctx, liters), summary()
 *   }
 */
import { createSpawner } from '../spawner.js';
import { starsFor } from '../scoring.js';
import { createPaScript } from './pa.js';
import { shiftReport } from './report.js';

export default {
  id: 'shift',
  create(ctx, level) {
    const T = ctx.T;
    const spawner = createSpawner(ctx, level.hatch);
    const waves = level.waves.map((w, i) => ({ ...w, index: i, due: w.at, warned: false, opened: false }));
    const warnings = [...T.levels.timerWarnings].sort((a, b) => b - a);
    const pa = createPaScript(ctx, level.pa || []);
    let nextWave = 0;
    let lastActivity = 0;
    // one-off teaching hints (level.hints): pa:announce { text, mood, hint: true, hintId }
    //   pinned:  { text }            drum held near max speed ~3 s with live donors and no kills
    //   noBlood: { after: s, text }  donors alive, nothing collected after `after` s
    // Each fires at most once per shift and never once the player has scored a kill.
    const hints = level.hints || {};
    const hintDone = {};
    let pinT = 0;

    const mode = {
      id: 'shift',
      status: 'running',
      result: null,
      spawner,
      clock: { t: 0, duration: level.duration, left: level.duration },
      waves: { total: waves.length, opened: 0 },
      donorsTotal: waves.reduce((s, w) => s + (w.count || 0), 0),
      /** donors still to process (queued + alive), Inspectors excluded (they are not product) */
      get donorsLeft() {
        const queued = spawner.pendingTargets + waves.slice(nextWave).reduce((s, w) => s + targetCount(w), 0);
        return queued + ctx.donors.filter((d) => d.alive && !d.mustSurvive).length;
      },

      preStep(c, dt) {
        if (mode.status !== 'running') { spawner.step(dt); return; }
        mode.clock.t += dt;
        mode.clock.left = Math.max(0, level.duration - mode.clock.t);
        const t = mode.clock.t;
        const alive = c.aliveTargets;
        if (alive > 0 || spawner.pending > 0) lastActivity = t;

        const w = waves[nextWave];
        if (w) {
          if (level.advanceWhenClear !== false && alive === 0 && spawner.pending === 0 && t - lastActivity > 2.5 && nextWave > 0) {
            w.due = Math.min(w.due, t + T.levels.waveWarning);
          }
          if (!w.warned && t >= w.due - T.levels.waveWarning) {
            w.warned = true;
            c.emit('wave:incoming', { count: w.count, wave: w.index });
          }
          if (t >= w.due) {
            w.opened = true;
            spawner.openWave(w);
            nextWave++;
            mode.waves.opened = nextWave;
            lastActivity = t;
          }
        }
        spawner.step(dt);

        while (warnings.length && mode.clock.left <= warnings[0]) {
          const s = warnings.shift();
          if (mode.clock.left > 0) c.emit('timer:warning', { secondsLeft: s });
        }
        pa.step(c, t);
        if (c.scoring.kills > 0) { hintDone.pinned = true; hintDone.noBlood = true; }
        if (hints.pinned && !hintDone.pinned) {
          const pinned = Math.abs(c.drum.omega) > 0.85 * T.drum.maxOmega && c.aliveTargets > 0;
          pinT = pinned ? pinT + dt : 0;
          if (pinT > (hints.pinned.after || 3)) { hintDone.pinned = true; hint(c, 'pinned'); }
        }
        if (hints.noBlood && !hintDone.noBlood && t > hints.noBlood.after && c.aliveTargets > 0 && c.blood.collected < 0.5) {
          hintDone.noBlood = true; hint(c, 'noBlood');
        }
      },

      postStep(c) {
        c.pool.volume = c.blood.collected;
        if (mode.status !== 'running') return;
        const allSpawned = nextWave >= waves.length && spawner.pending === 0;
        const lastDeath = c.donors.reduce((m, d) => Math.max(m, d.deathTime), -1);
        if (allSpawned && c.aliveTargets === 0 && c.donors.length > 0 && mode.clock.t - Math.max(lastDeath, lastActivity) >= T.scoring.processedDelay) {
          const bonus = mode.clock.left * T.scoring.earlyFinishPerSecond;
          if (bonus > 0) c.scoring.addBonus(bonus, 'early-finish');
          end(c, 'failed');
        } else if (mode.clock.left <= 0) {
          end(c, 'timeout');
        }
      },

      summary() {
        return {
          levelId: level.id, mode: 'shift', status: mode.status, result: mode.result,
          clock: { ...mode.clock }, waves: { ...mode.waves }, donorsLeft: mode.donorsLeft, donorsTotal: mode.donorsTotal,
          quota: level.quota, inspectorsAlive: ctx.donors.filter((d) => d.alive && d.mustSurvive).length,
        };
      },
    };

    /** failKind: what the result is if the quota is missed ('failed' = all processed, 'timeout') */
    function end(c, failKind) {
      mode.status = 'ended';
      // end-of-shift hooks first (Inspector compliance bonus) so they count toward the rating
      for (const d of c.donors) if (d.def.onShiftEnd) d.def.onShiftEnd(c, d);
      const liters = Math.round(c.scoring.liters * 10) / 10;
      const result = liters >= level.quota[0] ? 'complete' : failKind;
      const stars = result === 'complete' ? starsFor(liters, level.quota) : 0;
      mode.result = {
        result, liters, stars, levelId: level.id, levelNumber: level.number,
        collected: Math.round(c.blood.collected * 10) / 10,
        bonus: Math.round(c.scoring.bonus * 10) / 10, fines: Math.round(c.scoring.fines * 10) / 10,
        kills: c.scoring.kills, drownings: c.scoring.drownings, bestCombo: c.scoring.combo.best,
        time: Math.round(mode.clock.t * 10) / 10, timeLeft: Math.round(mode.clock.left * 10) / 10,
        donorsTotal: mode.donorsTotal, causes: { ...c.scoring.causes },
        inspectorDeaths: c.scoring.inspectorDeaths, inspectorsSaved: c.scoring.inspectorsSaved,
        quota: level.quota.slice(), name: level.name, variant: level.variant || null,
      };
      mode.result.report = shiftReport(c, level, mode.result);
      // shift 8: the ending sting (UI plays it after the results screen; only on a pass)
      mode.result.ending = level.ending && stars >= 1 ? { ...level.ending } : null;
      c.emit('shift:end', { ...mode.result });
    }

    function hint(c, id) {
      c.emit('pa:announce', { text: hints[id].text, mood: 'calm', hint: true, hintId: id });
    }

    function targetCount(w) {
      if (!w.types || Array.isArray(w.types)) return (w.count || 0) - (Array.isArray(w.types) ? w.types.filter((t) => t === 'inspector').length : 0);
      return (w.count || 0) - (w.types.inspector || 0);
    }

    return mode;
  },
};
