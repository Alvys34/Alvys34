/**
 * Render quality presets + automatic degradation (VFX plumbing; re-exported as QUALITY by
 * src/render/index.js). Every piece receives the preset object in setQuality(q, name).
 *
 * Fields: pixelRatio (cap), shadows/shadowSize (ART), droplets/mist (particle caps), runners (wall
 * drips), stamps (blood-map stamps per frame), bloodMap (atlas width in texels; height = 0.625 x),
 * emitScale (particles spawned per litre), poolSlices (pool absorption layers), msaa (post samples),
 * bloom (bloom mip levels, 0 = off), ca (chromatic aberration), grain, splats (legacy).
 *
 * Governor (createQualityGovernor, pure: no DOM / three, unit-tested in tests/quality.test.mjs).
 * Three independent levers, each kept across the others' changes:
 *   pixel  pixel-ratio scale 1 -> 0.85 -> 0.72 -> 0.6 (the only lever that helps a fill-bound GPU)
 *   preset high -> medium -> low (never above the player's choice)
 *   load   ctx.loadScale 1 -> 0.7 -> 0.45 (+ bloom/CA off at 2): particle caps, emission, stamps
 * Stepping DOWN: GPU-bound frames (sim time small next to the frame) use pixel -> preset -> load,
 * CPU-bound frames load -> preset -> pixel. One step after ~1.5 s over budget; when the frame is
 * more than 2x over budget it steps after a 0.4 s measurement. Stepping UP undoes the last step
 * after 10 s of headroom, at most once per 10 s; an up-step that has to be taken back doubles that
 * wait (up to 80 s: no ping-pong). benchmark(): picks the starting preset/pixel scale from ~1.5 s of
 * frames (quality 'auto', behind the boot screen).
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

export const PIXEL_STEPS = [1, 0.85, 0.72, 0.6];
export const LOAD_STEPS = [1, 0.7, 0.45];

/**
 * Starting point from a benchmark: mean frame ms measured at the player's preset -> how many
 * preset steps and pixel steps to take down.
 */
export function pickStart(meanMs, budgetMs = 21) {
  const r = meanMs / budgetMs;
  const presetSteps = r <= 1 ? 0 : r <= 1.6 ? 1 : 2;
  const pixelSteps = r <= 2.4 ? 0 : r <= 3.2 ? 1 : r <= 4 ? 2 : 3;
  return { presetSteps, pixelSteps };
}

/**
 * createQualityGovernor({ getPreset, applyPreset, applyLevel, applyPixelScale, budgetMs, goodMs })
 *   frame(realDt, cost?)  every rendered frame; cost (optional) = { simMs, busyMs, skip }:
 *                         simMs = sim time this frame, busyMs = main-thread work this frame (sim +
 *                         render submit + UI), skip = ignore this frame (shader warm-up, loading)
 *   applyLevel(0..2)      load level (ctx.loadScale, bloom/CA off at 2); re-sent after a preset change
 *   applyPreset(name)     preset change (must keep the pixel scale and load level)
 *   applyPixelScale(s)    pixel-ratio multiplier (PIXEL_STEPS)
 *   reset(preset)         the player picked a preset: new ceiling, full quality
 *   benchmark(seconds)    measure ~seconds of frames, then start from pickStart()
 */
export function createQualityGovernor({
  budgetMs = 21, goodMs = 13, getPreset,
  applyLevel = () => {}, applyPreset = () => {}, applyPixelScale = () => {},
  dwellS = 1.5, fastS = 0.4, settleS = 0.25, upDwellS = 10, upBackoffMaxS = 80,
} = {}) {
  let enabled = true;
  let userPreset = getPreset();
  let level = 0; let pix = 0;
  const stack = []; // down steps taken ('pixel' | 'preset' | 'load'); an up step undoes the last one
  let avg = 16.7;
  let wT = 0; let wN = 0; let wSum = 0; let wSim = 0; let wSimN = 0; let wBusy = 0; let wBusyN = 0;
  let settle = settleS; let underT = 0;
  let clock = 0; let lastUp = -1e9; let upWait = upDwellS;
  let bench = null; let benchResult = null;
  const history = []; // { t, dir, kind, ms } (last 32 decisions, for perf tools)

  const presetIdx = () => QUALITY_ORDER.indexOf(getPreset());
  function resetWindow() { wT = 0; wN = 0; wSum = 0; wSim = 0; wSimN = 0; wBusy = 0; wBusyN = 0; settle = settleS; }
  function note(dir, kind, ms) { history.push({ t: +clock.toFixed(2), dir, kind, ms: +ms.toFixed(1) }); if (history.length > 32) history.shift(); }
  function canDown(kind) {
    if (kind === 'pixel') return pix < PIXEL_STEPS.length - 1;
    if (kind === 'preset') return presetIdx() > 0;
    return level < LOAD_STEPS.length - 1;
  }
  function doDown(kind) {
    if (kind === 'pixel') { pix++; applyPixelScale(PIXEL_STEPS[pix]); } else if (kind === 'preset') { applyPreset(QUALITY_ORDER[presetIdx() - 1]); applyLevel(level); } else { level++; applyLevel(level); }
    stack.push(kind);
  }
  function doUp(kind) {
    if (kind === 'pixel') { if (pix <= 0) return false; pix--; applyPixelScale(PIXEL_STEPS[pix]); return true; }
    if (kind === 'preset') {
      const i = presetIdx();
      if (i < 0 || i >= QUALITY_ORDER.indexOf(userPreset)) return false;
      applyPreset(QUALITY_ORDER[i + 1]); applyLevel(level); return true;
    }
    if (level <= 0) return false;
    level--; applyLevel(level); return true;
  }
  function stepDown(gpuBound, ms) {
    const order = gpuBound ? ['pixel', 'preset', 'load'] : ['load', 'preset', 'pixel'];
    for (const k of order) {
      if (!canDown(k)) continue;
      doDown(k); note('down', k, ms);
      if (clock - lastUp < 2 * upDwellS) upWait = Math.min(upBackoffMaxS, upWait * 2); // the last up step did not hold
      underT = 0; resetWindow();
      return true;
    }
    return false;
  }
  function stepUp(ms) {
    while (stack.length) {
      const k = stack.pop();
      if (doUp(k)) { note('up', k, ms); lastUp = clock; underT = 0; resetWindow(); return true; }
    }
    return false;
  }
  function finishBench() {
    const mean = bench.sum / bench.n;
    const pick = pickStart(mean, budgetMs);
    benchResult = { ms: +mean.toFixed(2), frames: bench.n, ...pick };
    bench = null;
    for (let i = 0; i < pick.presetSteps && canDown('preset'); i++) doDown('preset');
    for (let i = 0; i < pick.pixelSteps && canDown('pixel'); i++) doDown('pixel');
    note('bench', `${getPreset()}@${PIXEL_STEPS[pix]}`, mean);
    underT = 0; resetWindow();
  }

  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; underT = 0; resetWindow(); },
    get level() { return level; },
    get pixelScale() { return PIXEL_STEPS[pix]; },
    get frameMs() { return avg; },
    get userPreset() { return userPreset; },
    get benchmarking() { return !!bench; },
    get benchResult() { return benchResult; },
    get steps() { return stack.slice(); },
    get history() { return history.slice(); },
    get upWait() { return upWait; },
    /** the player picked a preset: that is the new ceiling; full quality again */
    reset(preset) {
      userPreset = preset; level = 0; pix = 0; stack.length = 0; bench = null;
      upWait = upDwellS; underT = 0; resetWindow();
      applyLevel(0); applyPixelScale(1);
    },
    /** measure ~seconds of frames at the current preset, then step down to a sensible start */
    benchmark(seconds = 1.5) { bench = { t: 0, n: 0, sum: 0, seconds, skip: 6 }; },
    frame(realDt, cost = null) {
      if (!enabled || !(realDt > 0)) return;
      if (cost && cost.skip) { resetWindow(); if (bench) bench.skip = Math.max(bench.skip, 3); return; }
      if (bench) { // a very slow GPU must still conclude: long frames count here (capped at 1 s)
        if (bench.skip > 0) { bench.skip--; return; }
        const bms = Math.min(1000, realDt * 1000);
        bench.t += bms / 1000; bench.n++; bench.sum += bms;
        if ((bench.t >= bench.seconds && bench.n >= 8) || bench.t >= 4) finishBench();
        return;
      }
      if (realDt > 0.25) { resetWindow(); return; } // a stall (tab switch, compile, load), not the steady cost
      const ms = realDt * 1000;
      clock += realDt;
      avg += (ms - avg) * 0.05;
      if (settle > 0) { settle -= realDt; return; } // let the last change take effect
      wT += realDt; wN++; wSum += ms;
      if (cost && cost.simMs != null) { wSim += cost.simMs; wSimN++; }
      if (cost && cost.busyMs != null) { wBusy += cost.busyMs; wBusyN++; }
      if (wT < fastS || wN < 6) return;
      const mean = wSum / wN;
      // GPU-bound: the sim is a small part of the frame (render/GPU dominates) -> pixel ratio first
      const gpuBound = wSimN ? wSim / wSimN < 0.35 * mean : true;
      if (mean > 2 * budgetMs) { stepDown(gpuBound, mean); return; } // far over budget: step now
      if (wT < dwellS) return;
      if (mean > budgetMs) { stepDown(gpuBound, mean); return; }
      // headroom: comfortably fast frames, and (if known) little main-thread work so vsync is the limit
      const headroom = wBusyN ? mean <= budgetMs * 0.9 && wBusy / wBusyN < goodMs * 0.6 : mean < goodMs;
      underT = headroom ? underT + wT : 0;
      resetWindow(); settle = 0;
      if (underT >= upWait && stack.length) stepUp(mean);
    },
  };
}

/**
 * Can this GPU render to (and blend into) HalfFloat/Float targets? (EXT_color_buffer_float /
 * EXT_color_buffer_half_float). ?nofloat=1 forces the fallback path for testing.
 */
export function floatTargetsOK(renderer) {
  try { if (typeof location !== 'undefined' && /[?&]nofloat=1/.test(location.search)) return false; } catch { /* no location */ }
  try {
    const ext = renderer.extensions;
    return !!(ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
  } catch { return false; }
}
