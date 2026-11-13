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

export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, droplets: 500, splats: 250 },
  medium: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, droplets: 1000, splats: 450 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, droplets: 1600, splats: 700 },
};

export function createRenderer({ canvas, bus, settings = {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!settings.preserveDrawingBuffer });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const worldGroup = new THREE.Group(); worldGroup.name = 'world';
  const drumGroup = new THREE.Group(); drumGroup.name = 'drum';
  scene.add(worldGroup, drumGroup);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 200);

  const ctx = {
    THREE, renderer, scene, camera, worldGroup, drumGroup, bus, settings,
    quality: QUALITY[settings.quality] || QUALITY.high, qualityName: settings.quality || 'high',
    drumAngle: 0,
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
    ctx.pool = createPoolView(ctx),
    ctx.blood = createBlood(ctx),
  ];
  const post = createPost(ctx);
  let lastLevel = null;
  let lastState = null;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ctx.quality.pixelRatio));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (ctx.cameraRig.resize) ctx.cameraRig.resize(w, h);
    post.resize(w, h);
  }

  function setQuality(name) {
    const q = QUALITY[name];
    if (!q) return false;
    ctx.quality = q; ctx.qualityName = name;
    renderer.shadowMap.enabled = q.shadows;
    for (const p of pieces) if (p.setQuality) p.setQuality(q, name);
    resize();
    return true;
  }

  function update(state, alpha = 1, dt = 1 / 60) {
    if (!state) { post.render(dt); return; }
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
    post.render(dt);
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
    dispose() {
      for (const p of pieces) p.dispose();
      post.dispose();
      renderer.dispose();
    },
  };
}
