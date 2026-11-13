/**
 * Game-feel time effects (GDD §4 feel rules), driven by bus events, applied to the loop:
 *  - hit-stop (feel.hitStopFrames) when >= hitStopMinEvents dismemberments land in the same sim step
 *  - slow-mo (feel.slowMoScale for feel.slowMoDuration real seconds) when >= slowMoKills kills
 *    happen within feel.slowMoWindow sim seconds
 *
 *   const feel = createFeel({ bus, loop, T });   feel.dispose();
 */
export function createFeel({ bus, loop, T }) {
  const F = T.feel;
  let severT = -1; let severN = 0;
  const kills = [];
  let slowCooldown = 0;
  const offs = [
    bus.on('limb:sever', (p) => {
      if (p.t === severT) severN++; else { severT = p.t; severN = 1; }
      if (severN === F.hitStopMinEvents) loop.hitStop(F.hitStopFrames);
    }),
    bus.on('donor:death', (p) => {
      if (p.cause === 'drown') return;
      kills.push(p.t);
      while (kills.length && p.t - kills[0] > F.slowMoWindow) kills.shift();
      if (kills.length >= F.slowMoKills && p.t >= slowCooldown) {
        loop.slowMo(F.slowMoScale, F.slowMoDuration);
        slowCooldown = p.t + F.slowMoWindow;
        kills.length = 0;
      }
    }),
    bus.on('shift:start', () => { kills.length = 0; slowCooldown = 0; }),
  ];
  return { dispose() { offs.forEach((o) => o()); } };
}
