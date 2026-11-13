/**
 * Render quality presets + automatic degradation (VFX plumbing; re-exported as QUALITY by
 * src/render/index.js). Every piece receives the preset object in setQuality(q, name).
 *
 * Fields: pixelRatio (cap), shadows/shadowSize (ART), droplets/mist (particle caps), runners (wall
 * drips), stamps (blood-map stamps per frame), bloodMap (atlas width in texels; height = 0.625 x),
 * emitScale (particles spawned per litre), poolSlices (pool absorption layers), msaa (post samples),
 * bloom (bloom mip levels, 0 = off), ca (chromatic aberration), grain, splats (legacy).
 *
 * Governor: watches real frame time; when the average stays above budget it steps DOWN through
 *   level 1: ctx.loadScale 0.7 (particle caps, emission, stamps)
 *   level 2: ctx.loadScale 0.45 + bloom/CA off
 *   level 3: pixel ratio x0.75
 *   level 4: next lower preset (high -> medium -> low)
 * and steps back UP (never above the user's preset) after a long stretch of headroom.
 * Disabled by default under ?debug=1 (SwiftShader is always "slow"); enable with ?autoq=1, or
 * view.setAutoQuality(bool).
 */
export const QUALITY = {
  low: {
    pixelRatio: 1, shadows: false, droplets: 1100, mist: 500, splats: 250, runners: 90, stamps: 700,
    bloodMap: 1024, emitScale: 0.55, poolSlices: 4, msaa: 0, bloom: 0, ca: false, grain: true,
  },
  medium: {
    pixelRatio: 1.25, shadows: true, shadowSize: 1024, droplets: 2600, mist: 1200, splats: 450, runners: 190, stamps: 1500,
    bloodMap: 1536, emitScale: 0.8, poolSlices: 7, msaa: 2, bloom: 4, ca: true, grain: true,
  },
  high: {
    pixelRatio: 2, shadows: true, shadowSize: 2048, droplets: 5000, mist: 2600, splats: 700, runners: 320, stamps: 2400,
    bloodMap: 2048, emitScale: 1, poolSlices: 10, msaa: 4, bloom: 5, ca: true, grain: true,
  },
};

export const QUALITY_ORDER = ['low', 'medium', 'high'];

/**
 * createQualityGovernor({ getPreset, applyPreset, applyLevel }) -> { frame(realDt), level, ... }
 *   applyLevel(level) is called with 0..3 for in-preset degradation; applyPreset(name) for level 4.
 */
export function createQualityGovernor({ budgetMs = 21, goodMs = 13, applyLevel, applyPreset, getPreset }) {
  let enabled = true;
  let userPreset = getPreset();
  let level = 0;
  let avg = 16.7; let over = 0; let under = 0; let samples = 0;
  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; if (!enabled) { over = 0; under = 0; } },
    get level() { return level; },
    get frameMs() { return avg; },
    get userPreset() { return userPreset; },
    /** the player picked a preset: that is the new ceiling, reset degradation */
    reset(preset) { userPreset = preset; level = 0; over = 0; under = 0; samples = 0; applyLevel(0); },
    frame(realDt) {
      if (!enabled || !(realDt > 0) || realDt > 0.25) return;
      const ms = realDt * 1000;
      avg += (ms - avg) * 0.05;
      samples++;
      if (samples < 90) return; // warm-up after load / preset change
      if (avg > budgetMs) { over += realDt; under = 0; } else if (avg < goodMs) { under += realDt; over = 0; } else { over = Math.max(0, over - realDt); under = 0; }
      if (over > 2.5) {
        over = 0; samples = 30;
        if (level < 3) { level++; applyLevel(level); } else {
          const i = QUALITY_ORDER.indexOf(getPreset());
          if (i > 0) { applyPreset(QUALITY_ORDER[i - 1]); level = 0; applyLevel(0); }
        }
      } else if (under > 12) {
        under = 0; samples = 30;
        if (level > 0) { level--; applyLevel(level); } else {
          const i = QUALITY_ORDER.indexOf(getPreset()); const u = QUALITY_ORDER.indexOf(userPreset);
          if (i < u) { applyPreset(QUALITY_ORDER[i + 1]); level = 2; applyLevel(2); }
        }
      }
    },
  };
}
