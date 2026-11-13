/**
 * Shader pre-compilation (VFX plumbing; LOCAL-REPORT-1 §1 "Start-of-shift stall"): three compiles a
 * material's program lazily on its first draw, which cost a 0.6-0.8 s first frame and 145-215 ms
 * hitches on the first donor / blood / tank / sphere crack (1-8 s on a weak iGPU).
 *
 *   const pre = createPrecompiler(ctx, { post });
 *   pre.request(state, reason)   start a warm-up for this level (async; returns the promise)
 *   pre.beforeRender(state, frame)  call at the top of every view.update(): runs the pending steps
 *   pre.busy / pre.blocking      a warm-up is pending / a LEVEL warm-up is pending (hold the sim)
 *   pre.stats                    { runs, programs, lastMs, pinned }
 *
 * A warm-up, all inside view.update() so nothing odd is ever presented:
 *  1. one hidden instance of every prop kind (oxygen tank, safety sphere) is built through the real
 *     prop views from a fake state, the whole scene (hidden objects included: donor instanced meshes
 *     with 0 instances, blood particles, pool slices, hazards, glass/wall blood overlays) is compiled
 *     with renderer.compile() — non-blocking where KHR_parallel_shader_compile exists — and the real
 *     props are restored. Every program that exists is then PINNED (usedTimes + 1), so disposing a
 *     level's hazards / a shattered sphere never deletes a program that the next shift needs again.
 *  2. wait until the programs report ready (polled, like renderer.compileAsync()).
 *  3. one hidden frame with every mesh forced visible and unculled, rendered through post (shadow
 *     depth programs, every post pass) plus one empty blood-atlas stamp batch, then the normal frame
 *     is drawn on top in the same task. Pin again.
 */
import { floatTargetsOK } from './quality.js';

export function createPrecompiler(ctx, { post }) {
  const { THREE, renderer, scene, camera } = ctx;
  const pinned = new Set();
  // post.js renders the scene into an HDR target (linear output, no tone mapping: part of the program
  // key), so compile against a target too; the 8-bit fallback renders straight to the canvas
  const compileTarget = floatTargetsOK(renderer) ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true }) : null;
  let pending = null; // { reason, phase: 'compile'|'wait'|'frame', materials, resolve, t0, promise }
  const stats = { runs: 0, programs: 0, lastMs: 0, pinned: 0, last: null };

  function pin() {
    const list = renderer.info.programs || [];
    for (const p of list) if (!pinned.has(p)) { p.usedTimes++; pinned.add(p); }
    stats.pinned = pinned.size;
  }
  function fakePropsState(state) {
    const T = state.T || {};
    const P = T.props || {};
    const sp = P.safetySphere || {}; const tk = P.oxygenTank || {};
    return {
      ...state,
      props: [
        { id: -1, view: { kind: 'oxygenTank', dyn: null, radius: tk.radius || 0.2, halfLength: tk.halfLength || 0.5, state: 'punctured', fuse: 0.5, thrust: 0.5 } },
        { id: -2, view: { kind: 'safetySphere', dyn: null, radius: sp.radius || 1, hits: 1, maxHits: sp.hits || 3, cracks: 0.9, shattered: false, donorId: null } },
      ],
    };
  }
  // one hidden instance of each prop kind, built by the real prop views from a fake state; restore()
  // puts the real props back (the warm items are disposed, their programs stay pinned)
  function withWarmProps(state, fn) {
    const pv = ctx.propViews;
    let built = false;
    try { if (pv && state && state.props && state.drum) { pv.update(0, fakePropsState(state), 1); built = true; } } catch (e) { console.warn('[edc] warm props failed', e); }
    try { return fn(); } finally {
      try { if (built) pv.update(0, state, 1); } catch (e) { console.warn(e); }
    }
  }
  function compileNow(state) {
    return withWarmProps(state, () => {
      let materials = null;
      const prev = renderer.getRenderTarget();
      try {
        if (compileTarget) renderer.setRenderTarget(compileTarget);
        materials = renderer.compile(scene, camera);
      } catch (e) { console.warn('[edc] precompile failed', e); }
      renderer.setRenderTarget(prev);
      pin();
      return materials;
    });
  }
  function ready(materials) {
    if (!materials) return true;
    for (const m of materials) {
      const prog = renderer.properties.get(m).currentProgram;
      if (prog === undefined || prog.isReady()) materials.delete(m);
    }
    return materials.size === 0;
  }
  function hiddenFrame(state, frame) {
    const undo = [];
    scene.traverse((o) => {
      if (o.isLight) return;
      if (!o.visible) { undo.push(o, 'visible', false); o.visible = true; }
      if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.frustumCulled) { undo.push(o, 'frustumCulled', true); o.frustumCulled = false; }
    });
    withWarmProps(state, () => {
      // warm props are new objects: force them visible / unculled too
      const extra = [];
      scene.traverse((o) => { if (!o.isLight && !o.visible) { extra.push(o); o.visible = true; } if ((o.isMesh || o.isPoints) && o.frustumCulled) { undo.push(o, 'frustumCulled', true); o.frustumCulled = false; } });
      try {
        const atlas = ctx.blood && ctx.blood.atlas;
        if (atlas && atlas.stamp && atlas.flush) { atlas.stamp(0, 0, 0, 1, 0, 1e-4, 1e-4, 0, 0, 0, 0.5); atlas.flush(0); }
        post.render(0, state, frame);
      } catch (e) { console.warn('[edc] warm frame failed', e); }
      pin();
    });
    for (let i = 0; i < undo.length; i += 3) undo[i][undo[i + 1]] = undo[i + 2];
    pin();
  }

  return {
    get busy() { return !!pending; },
    /** a level warm-up is pending: the caller should hold the sim (first interactive frame after it) */
    get blocking() { return !!pending && pending.reason === 'level'; },
    get stats() { return { ...stats, programs: (renderer.info.programs || []).length }; },
    request(state, reason = 'level') {
      if (pending) { if (reason === 'level') pending.reason = 'level'; pending.phase = 'compile'; pending.state = state; return pending.promise; }
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      pending = { reason, phase: 'compile', state, materials: null, resolve, promise, t0: performance.now(), waitT: 0 };
      return promise;
    },
    /** run the pending warm-up steps; returns true when it drew the hidden frame this call */
    beforeRender(state, frame) {
      const p = pending;
      if (!p || !state) return false;
      if (p.phase === 'compile') { p.materials = compileNow(state); p.phase = 'wait'; p.waitT = performance.now(); return false; }
      if (p.phase === 'wait') {
        // programs still linking in parallel: do not touch them (that would block); give up after 8 s
        if (!ready(p.materials) && performance.now() - p.waitT < 8000) return false;
        hiddenFrame(state, frame);
        pending = null;
        stats.runs++; stats.lastMs = Math.round(performance.now() - p.t0); stats.last = p.reason;
        p.resolve(stats.lastMs);
        return true;
      }
      return false;
    },
    dispose() { pending = null; if (compileTarget) compileTarget.dispose(); },
  };
}
