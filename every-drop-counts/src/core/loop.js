/**
 * Fixed-step game loop with render interpolation and time-scale support.
 *
 *   const loop = createLoop({ dt: 1/60, step(dt) {...}, render(alpha, frameDt) {...} });
 *   loop.start();
 *   loop.setTimeScale(0.5);         // user/debug base scale (0 = frozen)
 *   loop.slowMo(0.35, 0.6);         // temporary scale for 0.6 s of REAL time
 *   loop.hitStop(3);                // freeze sim for 3 render frames (~50 ms)
 *   loop.setPaused(true);
 *   loop.stepNow(n);                // advance n fixed steps synchronously (debug harness)
 *
 * Sim time advances in fixed dt; render(alpha, realDt, simDt) gets alpha in [0,1] to interpolate
 * prev->current state, the real frame time, and the scaled (sim-coupled) time for visual effects.
 * Effective scale = paused ? 0 : (hitStop ? 0 : baseScale * slowMoScale).
 * No DOM except requestAnimationFrame / performance.now (core is browser-side).
 */
export function createLoop({ dt = 1 / 60, maxStepsPerFrame = 5, step, render, onFrameStart }) {
  let running = false;
  let rafId = 0;
  let last = 0;
  let acc = 0;
  let baseScale = 1;
  let paused = false;
  let slowScale = 1;
  let slowLeft = 0;
  let hitStopLeft = 0;

  const stats = {
    fps: 0, frames: 0, steps: 0,
    stepMsMean: 0, stepMsMax: 0, stepMsLast: 0,
    frameMs: 0,
  };
  let fpsAcc = 0; let fpsFrames = 0;
  let windowMax = 0; let windowCount = 0; let windowSum = 0;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function doStep() {
    const t0 = now();
    step(dt);
    const ms = now() - t0;
    stats.steps++;
    stats.stepMsLast = ms;
    windowSum += ms; windowCount++;
    if (ms > windowMax) windowMax = ms;
    if (windowCount >= 120) {
      stats.stepMsMean = windowSum / windowCount;
      stats.stepMsMax = windowMax;
      windowSum = 0; windowCount = 0; windowMax = 0;
    }
  }

  function effectiveScale() {
    if (paused || hitStopLeft > 0) return 0;
    return baseScale * slowScale;
  }

  function frame(t) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    let real = (t - last) / 1000;
    last = t;
    if (!(real >= 0)) real = 0;
    if (real > 0.25) real = 0.25; // tab was hidden / debugger: don't fast-forward
    stats.frameMs = real * 1000;
    fpsAcc += real; fpsFrames++;
    if (fpsAcc >= 0.5) { stats.fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
    stats.frames++;

    if (onFrameStart) onFrameStart(real);

    if (hitStopLeft > 0) hitStopLeft -= real;
    if (slowLeft > 0) { slowLeft -= real; if (slowLeft <= 0) slowScale = 1; }

    acc += real * effectiveScale();
    let n = 0;
    while (acc >= dt && n < maxStepsPerFrame) {
      doStep();
      acc -= dt;
      n++;
    }
    if (n >= maxStepsPerFrame) acc = Math.min(acc, dt);
    render(acc / dt, real, real * effectiveScale());
  }

  return {
    stats,
    get dt() { return dt; },
    get timeScale() { return effectiveScale(); },
    get baseTimeScale() { return baseScale; },
    get paused() { return paused; },
    start() {
      if (running) return;
      running = true;
      last = now();
      rafId = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(rafId); },
    setTimeScale(x) { baseScale = Math.max(0, Number(x) || 0); },
    setPaused(p) { paused = !!p; if (paused) acc = 0; },
    slowMo(scale, seconds) { slowScale = scale; slowLeft = seconds; },
    hitStop(frames) { hitStopLeft = Math.max(hitStopLeft, frames / 60); },
    resetAccumulator() { acc = 0; },
    /** Advance n fixed steps synchronously, then render once unless doRender === false (debug harness). */
    stepNow(n = 1, doRender = true) {
      for (let i = 0; i < n; i++) doStep();
      if (doRender) render(1, 0, n * dt);
    },
  };
}
