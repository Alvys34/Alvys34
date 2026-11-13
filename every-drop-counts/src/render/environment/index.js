/**
 * Environment (ART owns): facility backdrop (level, never rotates), the drum shell (rotates with
 * ctx.drumGroup), the intake hatch, and lighting. Baseline: procedural canvas textures only.
 *
 * createEnvironment(ctx) -> { update(dt, state, alpha), onLevel(state), setQuality(q), dispose() }
 */
import { tileTexture, stripeTexture, signTexture } from './textures.js';

export function createEnvironment(ctx) {
  const { THREE, worldGroup, drumGroup, scene } = ctx;
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const HW = 8; const HH = 5; const HD = 2.5;

  scene.background = new THREE.Color(0xdff3ea);
  scene.fog = new THREE.Fog(0xdff3ea, 45, 110);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xfffaf0, 0xb8dccb, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-9, 16, 22);
  sun.target.position.set(0, -1, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -13; sc.right = 13; sc.top = 13; sc.bottom = -13; sc.near = 5; sc.far = 60;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const fillLight = new THREE.PointLight(0xffffff, 40, 40, 1.6);
  fillLight.position.set(4, 2, 9);
  scene.add(fillLight);

  // ---------- facility backdrop (static) ----------
  const wallTex = track(tileTexture(THREE, { base: '#cfeee0', grout: '#b5ddca', tiles: 8, accent: '#e9f7f0' }));
  wallTex.repeat.set(10, 6);
  const backdrop = new THREE.Mesh(
    track(new THREE.PlaneGeometry(140, 80)),
    track(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 })),
  );
  backdrop.position.set(0, 8, -16);
  backdrop.receiveShadow = true;
  worldGroup.add(backdrop);

  const floorTex = track(tileTexture(THREE, { base: '#f4ecd8', grout: '#dccfb0', tiles: 6, accent: '#fbf6ea' }));
  floorTex.repeat.set(18, 10);
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(140, 60)), track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -11.5, 0);
  floor.receiveShadow = true;
  worldGroup.add(floor);

  // machine housing behind the drum (static ring + hub) so the rotation reads against it
  const housingMat = track(new THREE.MeshStandardMaterial({ color: 0x9aa7a6, metalness: 0.6, roughness: 0.35 }));
  const housing = new THREE.Mesh(track(new THREE.CylinderGeometry(10.6, 10.6, 0.8, 64)), housingMat);
  housing.rotation.x = Math.PI / 2;
  housing.position.z = -HD - 1.3;
  housing.receiveShadow = true;
  worldGroup.add(housing);
  const ringMat = track(new THREE.MeshStandardMaterial({ color: 0xf2c94c, metalness: 0.2, roughness: 0.5 }));
  const ring = new THREE.Mesh(track(new THREE.TorusGeometry(10.65, 0.18, 12, 96)), ringMat);
  ring.position.z = -HD - 0.85;
  worldGroup.add(ring);
  // support legs
  const legMat = track(new THREE.MeshStandardMaterial({ color: 0x7d8b8a, metalness: 0.5, roughness: 0.4 }));
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(track(new THREE.BoxGeometry(1.2, 6, 2.4)), legMat);
    leg.position.set(sx * 7.5, -9, -HD - 1.3);
    leg.castShadow = true; leg.receiveShadow = true;
    worldGroup.add(leg);
  }

  const sign = new THREE.Mesh(
    track(new THREE.PlaneGeometry(14, 1.75)),
    track(new THREE.MeshStandardMaterial({ map: track(signTexture(THREE, 'DRAINWELL™  COMMUNITY DONATION CENTER', '#2e6e5b', '#f7fbf9')), roughness: 0.6 })),
  );
  sign.position.set(0, 12.6, -15.9);
  worldGroup.add(sign);

  // ---------- drum shell (rotates) ----------
  const backTex = track(tileTexture(THREE, { base: '#f6f1e3', grout: '#d9d0b8', tiles: 8, accent: '#ffffff' }));
  backTex.repeat.set(4, 2.5);
  const back = new THREE.Mesh(track(new THREE.PlaneGeometry(HW * 2, HH * 2)), track(new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.75 })));
  back.position.z = -HD;
  back.receiveShadow = true;
  drumGroup.add(back);

  const upSign = new THREE.Mesh(
    track(new THREE.PlaneGeometry(3.2, 0.8)),
    track(new THREE.MeshStandardMaterial({ map: track(signTexture(THREE, '↑ THIS SIDE UP ↑', '#d9534f', '#fff8ee')), roughness: 0.6, transparent: true })),
  );
  upSign.position.set(0, HH - 1.0, -HD + 0.01);
  drumGroup.add(upSign);

  const innerTex = track(tileTexture(THREE, { base: '#e4efe9', grout: '#c4d6cc', tiles: 4, accent: '#f2f8f5' }));
  innerTex.repeat.set(8, 2.5);
  const innerMat = track(new THREE.MeshStandardMaterial({ map: innerTex, roughness: 0.7 }));
  const t = 0.5;
  const mkWall = (w, h, x, y) => {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, HD * 2)), innerMat);
    m.position.set(x, y, 0);
    m.receiveShadow = true;
    drumGroup.add(m);
    return m;
  };
  mkWall(HW * 2 + 2 * t, t, 0, -HH - t / 2);
  mkWall(HW * 2 + 2 * t, t, 0, HH + t / 2);
  mkWall(t, HH * 2, -HW - t / 2, 0);
  mkWall(t, HH * 2, HW + t / 2, 0);

  // chrome front frame with hazard-stripe edge and bolts (rotation cue)
  const frameMat = track(new THREE.MeshStandardMaterial({ color: 0xc9d3d2, metalness: 0.75, roughness: 0.28 }));
  const ft = 0.9;
  const mkFrame = (w, h, x, y) => {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, 0.5)), frameMat);
    m.position.set(x, y, HD + 0.2);
    m.castShadow = true;
    drumGroup.add(m);
  };
  mkFrame(HW * 2 + 2 * ft, ft, 0, -HH - ft / 2);
  mkFrame(HW * 2 + 2 * ft, ft, 0, HH + ft / 2);
  mkFrame(ft, HH * 2, -HW - ft / 2, 0);
  mkFrame(ft, HH * 2, HW + ft / 2, 0);
  const boltMat = track(new THREE.MeshStandardMaterial({ color: 0x5f6b6a, metalness: 0.8, roughness: 0.3 }));
  const boltGeo = track(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10));
  const bolts = new THREE.InstancedMesh(boltGeo, boltMat, 40);
  let bi = 0;
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  for (let i = 0; i <= 8; i++) {
    for (const sy of [-1, 1]) {
      m4.compose(new THREE.Vector3(-HW + (i * 2 * HW) / 8, sy * (HH + ft / 2), HD + 0.5), q, new THREE.Vector3(1, 1, 1));
      bolts.setMatrixAt(bi++, m4);
    }
  }
  for (let i = 1; i < 5; i++) {
    for (const sx of [-1, 1]) {
      m4.compose(new THREE.Vector3(sx * (HW + ft / 2), -HH + (i * 2 * HH) / 5, HD + 0.5), q, new THREE.Vector3(1, 1, 1));
      bolts.setMatrixAt(bi++, m4);
    }
  }
  bolts.count = bi;
  drumGroup.add(bolts);
  // one bright corner marker so the rotation is obvious at a glance
  const marker = new THREE.Mesh(track(new THREE.BoxGeometry(ft, ft, 0.55)), track(new THREE.MeshStandardMaterial({ map: track(stripeTexture(THREE)), roughness: 0.5 })));
  marker.position.set(-HW - ft / 2, HH + ft / 2, HD + 0.21);
  drumGroup.add(marker);

  const glass = new THREE.Mesh(
    track(new THREE.PlaneGeometry(HW * 2, HH * 2)),
    track(new THREE.MeshStandardMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.1, depthWrite: false })),
  );
  glass.position.z = HD;
  glass.renderOrder = 10;
  drumGroup.add(glass);

  // ---------- intake hatch ----------
  const hatchGroup = new THREE.Group();
  drumGroup.add(hatchGroup);
  const hatchFrame = new THREE.Mesh(track(new THREE.BoxGeometry(2.0, 0.12, HD * 2 - 0.4)), track(new THREE.MeshStandardMaterial({ map: track(stripeTexture(THREE)), roughness: 0.5 })));
  const hatchDoor = new THREE.Mesh(track(new THREE.BoxGeometry(1.6, 0.1, HD * 2 - 0.8)), track(new THREE.MeshStandardMaterial({ color: 0x4f5d5c, metalness: 0.6, roughness: 0.35 })));
  hatchDoor.position.y = 0.05;
  hatchGroup.add(hatchFrame, hatchDoor);
  hatchFrame.receiveShadow = true;

  const baseHemi = new THREE.Color(0xfffaf0);
  const redHemi = new THREE.Color(0xff6a5a);
  const tmpC = new THREE.Color();

  return {
    onLevel(state) {
      const h = state.hatch;
      if (!h) { hatchGroup.visible = false; return; }
      hatchGroup.visible = true;
      const w = h.wall; const at = h.at;
      if (w === 'back') { hatchGroup.position.set(h.x, h.y, -HD + 0.07); hatchGroup.rotation.set(Math.PI / 2, 0, 0); hatchGroup.scale.set(1, 1, 0.42); return; }
      hatchGroup.scale.set(1, 1, 1);
      // place on the wall surface, door normal pointing inward
      if (w === 'floor') { hatchGroup.position.set(at, -HH + 0.06, 0); hatchGroup.rotation.set(0, 0, 0); }
      if (w === 'ceiling') { hatchGroup.position.set(at, HH - 0.06, 0); hatchGroup.rotation.set(0, 0, Math.PI); }
      if (w === 'left') { hatchGroup.position.set(-HW + 0.06, at, 0); hatchGroup.rotation.set(0, 0, -Math.PI / 2); }
      if (w === 'right') { hatchGroup.position.set(HW - 0.06, at, 0); hatchGroup.rotation.set(0, 0, Math.PI / 2); }
    },
    update(dt, state) {
      const open = state.hatch ? state.hatch.open : 0;
      hatchDoor.position.x = open * 1.5;
      // tone escalation with fill: soft white -> emergency red
      const f = Math.min(1, (state.pool.fill || 0) / 0.6);
      tmpC.copy(baseHemi).lerp(redHemi, f * 0.55);
      hemi.color.copy(tmpC);
      sun.color.copy(tmpC);
    },
    setQuality(q) {
      sun.castShadow = !!q.shadows;
      if (q.shadowSize && sun.shadow.mapSize.x !== q.shadowSize) {
        sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    },
    dispose() {
      for (const d of disposables) if (d && d.dispose) d.dispose();
      for (const o of [hemi, sun, sun.target, fillLight]) scene.remove(o);
    },
  };
}
