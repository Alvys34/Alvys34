/**
 * Baseline three.js renderer — a thin orchestrator over swappable pieces (see src/render/README.md).
 *
 *   const view = createRenderer({ canvas, bus, settings });
 *   view.update(simState, alpha, frameDt, frame?);   // every render frame (alpha = interpolation 0..1)
 *        frame = { realDt, timeScale, paused, slowMo, hitStop } (the loop's real time state, optional)
 *   view.resize(); view.setQuality('low'|'medium'|'high'); view.info(); view.dispose();
 *   view.setReduceFlashing(bool); view.setHudInsets({ top, left, right } | null);
 *   view.playEnding() / view.stopEnding()   (shift-8 ending camera, see camera.js)
 *
 * Scene graph:
 *   scene
 *    ├─ worldGroup      level facility (does NOT rotate), droplets in flight (world space)
 *    └─ drumGroup       rotates by the interpolated drum angle (+ slam jolt); everything
 *                       authored in DRUM-LOCAL coords (same frame as the sim) lives here
 *
 * Piece contract: createX(ctx) -> { update(dt, state, alpha), onLevel?(state), setQuality?(q), dispose() }
 * ctx = { THREE, renderer, scene, camera, worldGroup, drumGroup, bus, settings, quality,
 *         drumAngle (interpolated, set each frame), toWorld(x,y,z) }
 */
import * as THREE from 'three';
import { createEnvironment } from './environment/index.js';
import { createDonorViews } from './donors/index.js';
import { createHazardViews } from './donors/hazards.js';
import { createBlood } from './blood/index.js';
import { createPoolView } from './blood/pool.js';
import { createCameraRig } from './camera.js';
import { createPost } from './post.js';
import { createPropViews } from './donors/props.js'; // ART props (oxygen tank, safety sphere); replaces CONTENT placeholders

import { QUALITY, LOAD_STEPS, createQualityGovernor } from './quality.js'; // presets + auto-degradation (VFX)
import { createPrecompiler } from './precompile.js'; // shader warm-up at level load (no first-use hitches)
import { setBloodColor, getBloodColor } from './blood/palette.js'; // the one blood colour source (VFX)

export { QUALITY };

export function createRenderer({ canvas, bus, settings = {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!settings.preserveDrawingBuffer });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false; // several render passes per frame (blood maps, post): reset per frame in update()
  setBloodColor(settings.bloodColor || 'red');

  const scene = new THREE.Scene();
  const worldGroup = new THREE.Group(); worldGroup.name = 'world';
  const drumGroup = new THREE.Group(); drumGroup.name = 'drum';
  scene.add(worldGroup, drumGroup);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 200);

  const ctx = {
    THREE, renderer, scene, camera, worldGroup, drumGroup, bus, settings,
    quality: QUALITY[settings.quality] || QUALITY.high, qualityName: settings.quality || 'high',
    drumAngle: 0,
    loadScale: 1, pixelScale: 1, // set by the quality governor (quality.js)
    toWorld(x, y, z = 0) {
      const c = Math.cos(ctx.drumAngle); const s = Math.sin(ctx.drumAngle);
      return [c * x - s * y + drumGroup.position.x, s * x + c * y + drumGroup.position.y, z];
    },
  };

  const pieces = [
    ctx.cameraRig = createCameraRig(ctx),
    ctx.environment = createEnvironment(ctx),
    ctx.hazardViews = createHazardViews(ctx),
    ctx.donorViews = createDonorViews(ctx),
    ctx.propViews = createPropViews(ctx),
    ctx.pool = createPoolView(ctx),
    ctx.blood = createBlood(ctx),
  ];
  const post = createPost(ctx);
  let lastLevel = null;
  let lastState = null;

  let lastW = 0; let lastH = 0;
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.max(0.5, Math.min(window.devicePixelRatio || 1, ctx.quality.pixelRatio) * (ctx.pixelScale || 1)));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    // only a real size change re-frames the camera (a pixel-ratio change must not snap the zoom)
    if ((w !== lastW || h !== lastH) && ctx.cameraRig.resize) ctx.cameraRig.resize(w, h);
    lastW = w; lastH = h;
    post.resize(w, h);
  }

  // post quality = the preset, minus bloom/CA while the governor's load level is 2
  let postLite = false;
  function applyPostQuality() {
    const q = QUALITY[ctx.qualityName];
    if (post.setQuality) post.setQuality(postLite ? { ...q, bloom: 0, ca: false } : q, ctx.qualityName);
  }
  function applyPreset(name) {
    const q = QUALITY[name];
    if (!q) return false;
    ctx.quality = q; ctx.qualityName = name;
    renderer.shadowMap.enabled = q.shadows;
    for (const p of pieces) if (p.setQuality) p.setQuality(q, name);
    applyPostQuality();
    resize();
    return true;
  }
  const precompiler = createPrecompiler(ctx, { post });
  ctx.precompiler = precompiler;
  // automatic quality (quality.js): pixel ratio / preset / load levers, kept across each other's changes
  const governor = createQualityGovernor({
    getPreset: () => ctx.qualityName,
    applyPreset(name) { applyPreset(name); precompiler.request(lastState, 'quality'); },
    applyLevel(level) {
      ctx.loadScale = LOAD_STEPS[Math.max(0, Math.min(LOAD_STEPS.length - 1, level))];
      const lite = level >= 2;
      if (lite !== postLite) { postLite = lite; applyPostQuality(); }
    },
    applyPixelScale(s) { if (s !== ctx.pixelScale) { ctx.pixelScale = s; resize(); } },
  });
  let autoqParam = false; let noPrewarm = false;
  try {
    const sp = new URLSearchParams(location.search);
    autoqParam = sp.has('autoq');
    noPrewarm = sp.has('noprewarm'); // A/B the shader warm-up (tools/qa/shaders.mjs)
    governor.enabled = !sp.has('debug') || autoqParam;
  } catch { /* no location */ }
  function setQuality(name) {
    if (!QUALITY[name]) return false;
    governor.reset(name); // full quality at the player's preset (pixel scale 1, load 0)
    ctx.loadScale = 1; ctx.pixelScale = 1; postLite = false;
    applyPreset(name);
    if (lastState) precompiler.request(lastState, 'quality');
    return true;
  }
  let lastFrameAt = 0; let skipCost = false; let lastHazards = null; let outlineMeshes = null;
  const cost = { simMs: 0, busyMs: 0, skip: false };

  function update(state, alpha = 1, dt = 1 / 60, frame = null) {
    renderer.info.reset();
    const now = performance.now();
    if (lastFrameAt) {
      // frame cost from the loop (main.js): sim ms this frame, main-thread ms of the previous frame
      cost.simMs = frame && frame.simMs != null ? frame.simMs : null;
      cost.busyMs = frame && frame.busyMs != null ? frame.busyMs : null;
      cost.skip = skipCost || precompiler.busy;
      governor.frame((now - lastFrameAt) / 1000, cost);
    }
    lastFrameAt = now; skipCost = false;
    if (!state) { post.render(dt, null, frame); return; }
    lastState = state; ctx.lastState = state;
    if (state.level !== lastLevel) {
      lastLevel = state.level;
      for (const p of pieces) if (p.onLevel) p.onLevel(state);
    }
    // a new sim context (level load, retry, Overtime): warm every shader it can show
    if (state.hazards !== lastHazards) { lastHazards = state.hazards; if (!noPrewarm) precompiler.request(state, 'level'); }
    const d = state.drum;
    ctx.drumAngle = d.prevTheta + (d.theta - d.prevTheta) * alpha;
    drumGroup.rotation.z = ctx.drumAngle;
    // slam jolt: drum kicks along world-up then settles
    const jolt = (d.prevJolt + (d.jolt - d.prevJolt) * alpha);
    drumGroup.position.y = Math.sin(jolt * Math.PI) * (state.T ? state.T.slam.jolt : 0.3) * jolt;
    for (const p of pieces) p.update(dt, state, alpha);
    // low preset: no donor outlines (inverted hulls double the donor triangles; LOCAL-REPORT-1 §1)
    if (ctx.qualityName === 'low') {
      if (!outlineMeshes) outlineMeshes = drumGroup.children.filter((o) => o.isInstancedMesh && /-outline$/.test(o.name));
      for (const o of outlineMeshes) o.visible = false;
    }
    if (precompiler.busy && precompiler.beforeRender(state, frame)) { skipCost = true; renderer.info.reset(); }
    post.render(dt, state, frame);
  }

  resize();
  setQuality(ctx.qualityName);
  if (autoqParam) governor.benchmark(1.5); // ?autoq=1 (debug): as with the 'auto' setting (setAutoQuality)

  return {
    ctx, update, resize, setQuality,
    get qualityName() { return ctx.qualityName; },
    info() {
      const i = renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
    },
    get lastState() { return lastState; },
    /** blood colour setting: 'red' | 'green' (streamer-safe); source of truth: render/blood/palette.js */
    setBloodColor(name) { settings.bloodColor = setBloodColor(name); return settings.bloodColor; },
    get bloodColor() { return getBloodColor(); },
    /** screen shake 0..1 (booleans accepted); scales sway, shake, kicks and zoom punch */
    setScreenShake(v) { settings.screenShake = v; },
    /** photosensitivity: no slam flash / red edges / CA / desaturate snaps, no light strobing (live) */
    setReduceFlashing(on) { settings.reduceFlashing = !!on; return settings.reduceFlashing; },
    /**
     * HUD plates in the top corners, as fractions of the viewport: { top, left, right } (plate
     * bottom edge / left plate width / right plate width), or null while the HUD is hidden.
     * The camera reserves a top band when a drum corner would sit under a plate.
     */
    setHudInsets(ins) {
      const v = ins && ins.top > 0 ? { top: Math.min(0.4, +ins.top || 0), left: Math.min(0.5, +ins.left || 0), right: Math.min(0.5, +ins.right || 0) } : null;
      settings.hudInsets = v;
    },
    /** shift-8 ending: camera drifts into the intake hatch. Only after the shift has ended. */
    playEnding() { return ctx.cameraRig.playEnding(); },
    stopEnding() { ctx.cameraRig.stopEnding(); },
    /** automatic quality degradation on/off (on by default outside ?debug=1) */
    /**
     * Automatic quality on/off (on by default outside ?debug=1). Turning it on from a fresh preset
     * (settings 'auto': the UI calls setQuality('high') first) starts a ~1.5 s benchmark on the frames
     * behind the boot screen / menus, which picks the starting preset and pixel scale.
     */
    setAutoQuality(on) {
      if (on) {
        governor.enabled = true;
        if (!governor.steps.length && !governor.benchmarking) governor.benchmark(1.5);
      } else {
        governor.enabled = false;
        if (governor.steps.length || ctx.pixelScale !== 1 || ctx.loadScale !== 1) setQuality(governor.userPreset);
      }
    },
    /** shader warm-up for the loaded level (also started automatically on every level load) */
    prewarm(reason = 'level') { return precompiler.request(lastState, reason); },
    /** a level warm-up is pending: hold the sim so the first interactive frame comes after it */
    get warming() { return precompiler.blocking; },
    /** perf/quality report for the game / debug HUD */
    perf() {
      return {
        quality: ctx.qualityName, userQuality: governor.userPreset, autoLevel: governor.level, auto: governor.enabled,
        frameMs: +governor.frameMs.toFixed(2), loadScale: ctx.loadScale, pixelScale: ctx.pixelScale, pixelRatio: renderer.getPixelRatio(),
        governor: { steps: governor.steps, history: governor.history, bench: governor.benchResult, benchmarking: governor.benchmarking, upWait: governor.upWait },
        shaders: precompiler.stats,
        camera: { distance: +ctx.cameraRig.distance.toFixed(3), base: +ctx.cameraRig.baseDistance.toFixed(3), scale: +ctx.cameraRig.scale.toFixed(4) },
        blood: ctx.blood.stats ? ctx.blood.stats() : null, post: post.stats ? post.stats() : null,
      };
    },
    dispose() {
      precompiler.dispose();
      for (const p of pieces) p.dispose();
      post.dispose();
      renderer.dispose();
    },
  };
}
