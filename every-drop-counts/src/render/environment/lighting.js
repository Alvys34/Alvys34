/**
 * Scene lighting (ART owns): procedural environment map (no HDR files), soft key + fill, ONE
 * shadow-casting light, and the fill-driven escalation (soft clinical white -> emergency red with
 * failing fluorescent tubes and a rotating warning beacon).
 *
 * createLighting(ctx, { tubes, beacon }) -> { update(dt, state), setQuality(q, name), dispose(), emergency }
 *   tubes:  [{ mat: MeshStandardMaterial (emissive), phase }]   failing fluorescent tubes
 *   beacon: { spinner: Object3D, dome: Material, pos: [x,y,z] } rotating warning beacon
 *
 * All lights exist from the start (intensity 0 when off) so shaders never recompile mid-shift.
 */
import { PAL } from './palette.js';

export function createLighting(ctx, { tubes = [], beacon = null } = {}) {
  const { THREE, scene, renderer } = ctx;
  const disposables = [];

  // ---------------- environment map (code-built room -> PMREM) ----------------
  const envScene = new THREE.Scene();
  const roomGeo = new THREE.BoxGeometry(30, 16, 30);
  const roomMat = new THREE.MeshBasicMaterial({ color: 0xbfd9cf, side: THREE.BackSide });
  envScene.add(new THREE.Mesh(roomGeo, roomMat));
  const floorMat = new THREE.MeshBasicMaterial({ color: 0x8a8370 });
  const floorM = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), floorMat);
  floorM.rotation.x = -Math.PI / 2; floorM.position.y = -7.9;
  envScene.add(floorM);
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  panelMat.color.setScalar(5);
  const panelGeo = new THREE.BoxGeometry(1.2, 0.2, 9);
  for (const x of [-7, 0, 7]) {
    const p = new THREE.Mesh(panelGeo, panelMat);
    p.position.set(x, 7.8, 0);
    envScene.add(p);
  }
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); winMat.color.setRGB(2.2, 2.4, 2.4);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), winMat);
  win.position.set(-6, 2, 14.9); win.rotation.y = Math.PI;
  envScene.add(win);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.035);
  pmrem.dispose();
  envScene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  for (const m of [roomMat, floorMat, panelMat, winMat]) m.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.42;
  disposables.push(envRT);

  scene.background = new THREE.Color(0xcfe6dc);
  scene.fog = new THREE.Fog(0xcfe6dc, 60, 140);

  // ---------------- lights ----------------
  const hemi = new THREE.HemisphereLight(0xfff8ec, 0x9fc7b8, 0.62);
  const key = new THREE.DirectionalLight(0xfff4e6, 1.85);
  key.position.set(-7, 15, 24);
  key.target.position.set(0, -1, -2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -13.5; sc.right = 13.5; sc.top = 12.5; sc.bottom = -13.5; sc.near = 4; sc.far = 70;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 3;
  const fill = new THREE.DirectionalLight(0xdff3ff, 0.5);
  fill.position.set(14, 4, 12);
  const rim = new THREE.DirectionalLight(0xe8fff4, 0.55);
  rim.position.set(4, 10, -20);
  // rotating beacon light (off until the tank gets full)
  const spot = new THREE.SpotLight(PAL.emergency, 0, 70, 0.42, 0.55, 1.2);
  const bpos = beacon ? beacon.pos : [12, 9, -13];
  spot.position.set(bpos[0], bpos[1], bpos[2]);
  spot.target.position.set(0, 0, 0);
  scene.add(hemi, key, key.target, fill, rim, spot, spot.target);

  // ---------------- escalation ----------------
  const C = {
    keyCalm: new THREE.Color(0xfff4e6), keyRed: new THREE.Color(0xff8f80),
    skyCalm: new THREE.Color(0xfff8ec), skyRed: new THREE.Color(0xc2423a),
    gndCalm: new THREE.Color(0x9fc7b8), gndRed: new THREE.Color(0x4a2422),
    fillCalm: new THREE.Color(0xdff3ff), fillRed: new THREE.Color(0xff5a48),
    bgCalm: new THREE.Color(0xcfe6dc), bgRed: new THREE.Color(0x5a3633),
    tubeCalm: new THREE.Color(0xf4fffb), tubeRed: new THREE.Color(0xff6a5a),
  };
  let t = 0;
  let flick = 0; let flickTimer = 1.5; let fillShown = 0;
  const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

  const api = {
    lights: { hemi, key, fill, rim, spot },
    /** 0..1 emergency amount actually shown (smoothed); other ART pieces may read it */
    emergency: 0,
    update(dt, state) {
      t += dt;
      const fillNow = state && state.pool ? state.pool.fill || 0 : 0;
      fillShown += (fillNow - fillShown) * Math.min(1, dt * 1.5);
      const f = fillShown;
      const e = smooth(0.18, 0.95, f);
      api.emergency = e;
      // slow pulse + failing flicker once things get bad
      const pulse = e > 0.4 ? 0.5 + 0.5 * Math.sin(t * 2.2) : 0;
      flickTimer -= dt;
      if (flickTimer <= 0) {
        flickTimer = 0.4 + hash(t) * (3.5 - 2.5 * e);
        if (e > 0.25 && hash(t + 3.1) < 0.35 + e * 0.5) flick = 0.12 + hash(t + 7.7) * 0.35;
      }
      flick = Math.max(0, flick - dt);
      const dip = flick > 0 && hash(Math.floor(t * 24)) < 0.6 ? 0.55 : 1;

      key.color.copy(C.keyCalm).lerp(C.keyRed, e * 0.75);
      key.intensity = (1.85 - 0.6 * e) * (e > 0.25 ? 0.85 + 0.15 * dip : 1);
      hemi.color.copy(C.skyCalm).lerp(C.skyRed, e * 0.8);
      hemi.groundColor.copy(C.gndCalm).lerp(C.gndRed, e);
      hemi.intensity = (0.62 - 0.17 * e) * (0.9 + 0.1 * dip) + pulse * 0.25 * e;
      fill.color.copy(C.fillCalm).lerp(C.fillRed, e * 0.8);
      fill.intensity = 0.5 + 0.5 * e * pulse;
      rim.intensity = 0.55 * (1 - 0.5 * e);
      scene.environmentIntensity = 0.42 - 0.18 * e;
      scene.background.copy(C.bgCalm).lerp(C.bgRed, e * 0.85);
      scene.fog.color.copy(scene.background);

      // beacon: on above ~45 % fill, sweeping
      const b = smooth(0.4, 0.6, f);
      spot.intensity = b * 260;
      const a = t * 3.4;
      spot.target.position.set(bpos[0] + Math.cos(a) * 14 - 6, bpos[1] - 6 + Math.sin(a * 0.5) * 2, bpos[2] + Math.sin(a) * 14 + 8);
      if (beacon) {
        beacon.spinner.rotation.y = b > 0 ? a : 0;
        beacon.spinner.visible = b > 0.01;
        beacon.dome.emissiveIntensity = b * (1.6 + 0.8 * Math.max(0, Math.cos(a)));
      }
      for (let i = 0; i < tubes.length; i++) {
        const tb = tubes[i];
        // tubes fail one by one as the tank fills; failing ones stutter
        const fail = smooth(tb.failAt ?? 0.5, (tb.failAt ?? 0.5) + 0.2, f);
        let on = 1;
        if (fail > 0) {
          const k = Math.floor(t * (9 + i * 3) + tb.phase * 10);
          on = hash(k + i * 17) < 0.5 + 0.45 * (1 - fail) ? 1 : 0.08;
          if (flick > 0) on *= 0.3;
        }
        tb.mat.emissive.copy(C.tubeCalm).lerp(C.tubeRed, e * 0.6);
        tb.mat.emissiveIntensity = (tb.base ?? 1.6) * on * (1 - 0.35 * e);
      }
    },
    setQuality(q) {
      key.castShadow = !!q.shadows;
      const size = q.shadowSize || 1024;
      if (key.shadow.mapSize.x !== size) {
        key.shadow.mapSize.set(size, size);
        if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      }
      key.shadow.radius = size >= 2048 ? 3.5 : 2.5;
    },
    dispose() {
      for (const o of [hemi, key, key.target, fill, rim, spot, spot.target]) scene.remove(o);
      if (key.shadow.map) key.shadow.map.dispose();
      scene.environment = null;
      for (const d of disposables) d.dispose();
    },
  };
  return api;
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
