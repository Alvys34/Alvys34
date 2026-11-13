/**
 * Scoring (GDD §9). Single currency: litres.
 *   liters = blood.collected + bonus - fines
 * Sponsor Match: each kill within comboWindow of the previous raises the multiplier (x2..x8);
 * each such kill grants comboBase * (multiplier - 1) bonus litres. Drownings never combo (waste).
 *
 * Content hooks: ctx.scoring.addBonus(liters, reason) / addFine(liters, reason).
 */
export function createScoring(ctx) {
  const S = ctx.T.scoring;
  const sc = {
    bonus: 0, fines: 0, kills: 0, drownings: 0, deaths: 0, inspectorDeaths: 0, inspectorsSaved: 0,
    combo: { count: 0, multiplier: 1, timer: 0, best: 0 },
    killTimes: [],
    causes: {},
    get liters() { return ctx.blood.collected + sc.bonus - sc.fines; },
    addBonus(liters, reason) {
      if (!(liters > 0)) return;
      sc.bonus += liters;
      ctx.emit('bonus', { liters: round(liters), reason });
    },
    addFine(liters, reason) {
      if (!(liters > 0)) return;
      sc.fines += liters;
      ctx.emit('fine', { liters: round(liters), reason });
    },
    onDeath(c, donor, cause) {
      sc.deaths++;
      sc.causes[cause] = (sc.causes[cause] || 0) + 1;
      if (donor.def.mustSurvive) return; // Inspectors: fines, never kills/combos
      if (cause === 'drown') { sc.drownings++; return; }
      sc.kills++;
      sc.killTimes.push(c.time);
      // Sponsor Match only counts PROCESSED donors: a donor bruised to death against bare metal
      // ('impact') does not keep the chain going (CONTENT balance: no reward for wall-slamming).
      if (S.comboCauses && !S.comboCauses.includes(cause)) return;
      if (sc.combo.timer > 0) sc.combo.count++; else sc.combo.count = 1;
      sc.combo.timer = S.comboWindow;
      const mult = Math.min(S.comboMax, sc.combo.count);
      sc.combo.multiplier = mult;
      sc.combo.best = Math.max(sc.combo.best, mult);
      if (mult >= 2) {
        c.emit('combo', { count: sc.combo.count, multiplier: mult });
        sc.addBonus(S.comboBase * (mult - 1), 'sponsor-match');
      }
    },
    step(c, dt) {
      if (sc.combo.timer > 0) {
        sc.combo.timer -= dt;
        if (sc.combo.timer <= 0) { sc.combo.timer = 0; sc.combo.count = 0; sc.combo.multiplier = 1; }
      }
      // slow-mo hint for the feel layer: kills within the window
      const F = c.T.feel;
      while (sc.killTimes.length && c.time - sc.killTimes[0] > F.slowMoWindow) sc.killTimes.shift();
    },
    recentKills() { return sc.killTimes.length; },
  };
  return sc;
}

function round(v) { return Math.round(v * 100) / 100; }

/** Stars for a litre total against [q1, q2, q3]. */
export function starsFor(liters, quota) {
  let s = 0;
  for (const q of quota) if (liters >= q) s++;
  return s;
}
