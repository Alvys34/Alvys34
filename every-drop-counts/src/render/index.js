/**
 * Baseline three.js renderer — a thin orchestrator over swappable pieces (see src/render/README.md).
 *
 *   const view = createRenderer({ canvas, bus, settings });
 *   view.update(simState, alpha, frameDt);   // every render frame (alpha = interpolation 0..1)
 *   view.resize(); view.setQuality('low'|'medium'|'high'); view.info(); view.dispose();
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

import { QUALITY, createQualityGovernor } from './quality.js'; // presets + auto-degradation (VFX)
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

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.max(0.5, Math.min(window.devicePixelRatio || 1, ctx.quality.pixelRatio) * (ctx.pixelScale || 1)));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (ctx.cameraRig.resize) ctx.cameraRig.resize(w, h);
    post.resize(w, h);
  }

  function applyPreset(name) {
    const q = QUALITY[name];
    if (!q) return false;
    ctx.quality = q; ctx.qualityName = name;
    renderer.shadowMap.enabled = q.shadows;
    for (const p of pieces) if (p.setQuality) p.setQuality(q, name);
    if (post.setQuality) post.setQuality(q, name);
    resize();
    return true;
  }
  // automatic degradation (quality.js): level 1-2 shrink particle/stamp budgets, 2 drops bloom, 3 pixel ratio
  const governor = createQualityGovernor({
    getPreset: () => ctx.qualityName,
    applyPreset,
    applyLevel(level) {
      ctx.loadScale = level >= 2 ? 0.45 : level >= 1 ? 0.7 : 1;
      const ps = level >= 3 ? 0.75 : 1;
      const q = level >= 2 ? { ...QUALITY[ctx.qualityName], bloom: 0, ca: false } : QUALITY[ctx.qualityName];
      if (post.setQuality) post.setQuality(q, ctx.qualityName);
      if (ps !== ctx.pixelScale) { ctx.pixelScale = ps; resize(); }
    },
  });
  try { governor.enabled = !new URLSearchParams(location.search).has('debug') || new URLSearchParams(location.search).has('autoq'); } catch { /* no location */ }
  function setQuality(name) {
    if (!QUALITY[name]) return false;
    ctx.loadScale = 1; ctx.pixelScale = 1;
    applyPreset(name);
    governor.reset(name);
    return true;
  }
  let lastFrameAt = 0;

  function update(state, alpha = 1, dt = 1 / 60) {
    renderer.info.reset();
    const now = performance.now();
    if (lastFrameAt) governor.frame((now - lastFrameAt) / 1000);
    lastFrameAt = now;
    if (!state) { post.render(dt, null); return; }
    lastState = state;
    if (state.level !== lastLevel) {
      lastLevel = state.level;
      for (const p of pieces) if (p.onLevel) p.onLevel(state);
    }
    const d = state.drum;
    ctx.drumAngle = d.prevTheta + (d.theta - d.prevTheta) * alpha;
    drumGroup.rotation.z = ctx.drumAngle;
    // slam jolt: drum kicks along world-up then settles
    const jolt = (d.prevJolt + (d.jolt - d.prevJolt) * alpha);
    drumGroup.position.y = Math.sin(jolt * Math.PI) * (state.T ? state.T.slam.jolt : 0.3) * jolt;
    for (const p of pieces) p.update(dt, state, alpha);
    post.render(dt, state);
  }

  resize();
  setQuality(ctx.qualityName);

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
    /** automatic quality degradation on/off (on by default outside ?debug=1) */
    setAutoQuality(on) { governor.enabled = on; if (!on) { ctx.loadScale = 1; ctx.pixelScale = 1; applyPreset(ctx.qualityName); } },
    /** perf/quality report for the game / debug HUD */
    perf() {
      return {
        quality: ctx.qualityName, userQuality: governor.userPreset, autoLevel: governor.level, auto: governor.enabled,
        frameMs: +governor.frameMs.toFixed(2), loadScale: ctx.loadScale, pixelRatio: renderer.getPixelRatio(),
        blood: ctx.blood.stats ? ctx.blood.stats() : null, post: post.stats ? post.stats() : null,
      };
    },
    dispose() {
      for (const p of pieces) p.dispose();
      post.dispose();
      renderer.dispose();
    },
  };
}
