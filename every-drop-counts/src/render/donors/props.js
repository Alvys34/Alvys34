/**
 * Prop visuals (ART owns): oxygen tanks and the Inspector's personal safety sphere, plus a small
 * render-only shard burst (sphere shatter, tank explosion). Driven by state.props[i].view:
 *   oxygenTank:   { kind, dyn (pose), radius, halfLength, state: intact|punctured|exploded, fuse, thrust }
 *   safetySphere: { kind, dyn (pose), radius, hits, maxHits, cracks 0..1, shattered }
 * Unknown kinds fall back to PROP_BUILDERS (others may register) or a striped placeholder.
 *
 * createPropViews(ctx) -> { update(dt, state, alpha), onLevel(state), setQuality(q, name), dispose() }
 * Builders: PROP_BUILDERS[kind] = (ctx, view, kit) => ({ group, update(view, dt, alpha, state), dispose? })
 */
import { PAL, sharedMaterials, makeRng } from '../environment/palette.js';
import { builder, rbox } from '../environment/geo.js';
import { makeCanvas, toTexture, stripeTexture } from '../environment/textures.js';
import { getSigns } from '../environment/index.js';

export const PROP_BUILDERS = {
  oxygenTank: buildTank,
  safetySphere: buildSphere,
};

const MAX_SHARDS = 220;

export function createPropViews(ctx) {
  const { THREE, drumGroup } = ctx;
  const root = new THREE.Group(); root.name = 'props';
  drumGroup.add(root);
  const M = sharedMaterials(ctx);
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const kit = makeKit(ctx, M, track);
  const items = new Map(); // prop -> item
  let lastProps = null;

  // ---- shard burst (instanced, drum-local ballistic) ----
  const shardGeo = track(new THREE.TetrahedronGeometry(1, 0));
  const shardMat = track(new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85 }));
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, MAX_SHARDS);
  shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shards.setColorAt(0, new THREE.Color(1, 1, 1));
  shards.frustumCulled = false; shards.count = 0;
  root.add(shards);
  const S = { x: new Float32Array(MAX_SHARDS), y: new Float32Array(MAX_SHARDS), z: new Float32Array(MAX_SHARDS),
    vx: new Float32Array(MAX_SHARDS), vy: new Float32Array(MAX_SHARDS), vz: new Float32Array(MAX_SHARDS),
    life: new Float32Array(MAX_SHARDS), size: new Float32Array(MAX_SHARDS), spin: new Float32Array(MAX_SHARDS),
    r: new Float32Array(MAX_SHARDS), g: new Float32Array(MAX_SHARDS), b: new Float32Array(MAX_SHARDS) };
  let nShards = 0;
  const rng = makeRng(17);
  const col = new THREE.Color(); const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
  const p3 = new THREE.Vector3(); const s3 = new THREE.Vector3();

  function burst(x, y, z, n, speed, size, palette) {
    for (let i = 0; i < n && nShards < MAX_SHARDS; i++) {
      const k = nShards++;
      const a = rng() * Math.PI * 2; const u = rng() * 2 - 1; const c = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + rng() * 0.8);
      S.x[k] = x + Math.cos(a) * c * size * 3; S.y[k] = y + Math.sin(a) * c * size * 3; S.z[k] = z + u * size * 2;
      S.vx[k] = Math.cos(a) * c * sp; S.vy[k] = Math.sin(a) * c * sp; S.vz[k] = u * sp * 0.5;
      S.life[k] = 1.2 + rng() * 0.9; S.size[k] = size * (0.5 + rng()); S.spin[k] = rng() * 10;
      col.setHex(palette[Math.floor(rng() * palette.length)]);
      S.r[k] = col.r; S.g[k] = col.g; S.b[k] = col.b;
    }
  }
  kit.burst = burst;

  function clear() {
    for (const it of items.values()) { root.remove(it.group); if (it.dispose) it.dispose(); }
    items.clear();
    nShards = 0;
  }

  return {
    onLevel() { clear(); },
    update(dt, state, alpha) {
      if (state.props !== lastProps) { if (lastProps) clear(); lastProps = state.props; }
      // sync items with props
      for (const p of state.props) {
        let it = items.get(p);
        if (!it) {
          if (!p.view || p.removed) continue;
          const b = PROP_BUILDERS[p.view.kind] || buildPlaceholder;
          it = b(ctx, p.view, kit);
          it.prop = p; it.seen = true;
          root.add(it.group);
          items.set(p, it);
        }
        it.seen = true;
      }
      for (const [p, it] of items) {
        const gone = p.removed || !state.props.includes(p);
        if (gone) {
          if (it.onRemove) it.onRemove(p.view, state);
          root.remove(it.group);
          if (it.dispose) it.dispose();
          items.delete(p);
          continue;
        }
        const d = p.view.dyn || (p.dyns && p.dyns[0]);
        if (d) {
          it.group.position.set(d.px + (d.x - d.px) * alpha, d.py + (d.y - d.py) * alpha, d.pz + (d.z - d.pz) * alpha);
          q.set(d.pqx, d.pqy, d.pqz, d.pqw); it.group.quaternion.set(d.qx, d.qy, d.qz, d.qw);
          q.slerp(it.group.quaternion, alpha); it.group.quaternion.copy(q);
        }
        if (it.update) it.update(p.view, dt, alpha, state);
      }
      // shards: gravity along drum-local "down", bounce off the chamber walls
      const gx = -state.drum.ux * 13; const gy = -state.drum.uy * 13;
      let i = 0;
      while (i < nShards) {
        S.life[i] -= dt;
        if (S.life[i] <= 0) {
          const j = --nShards;
          for (const key in S) S[key][i] = S[key][j];
          continue;
        }
        S.vx[i] += gx * dt; S.vy[i] += gy * dt;
        S.x[i] += S.vx[i] * dt; S.y[i] += S.vy[i] * dt; S.z[i] += S.vz[i] * dt;
        if (S.x[i] < -7.95 || S.x[i] > 7.95) { S.x[i] = Math.max(-7.95, Math.min(7.95, S.x[i])); S.vx[i] *= -0.35; S.vy[i] *= 0.7; }
        if (S.y[i] < -4.95 || S.y[i] > 4.95) { S.y[i] = Math.max(-4.95, Math.min(4.95, S.y[i])); S.vy[i] *= -0.35; S.vx[i] *= 0.7; }
        if (S.z[i] < -2.45 || S.z[i] > 2.45) { S.z[i] = Math.max(-2.45, Math.min(2.45, S.z[i])); S.vz[i] *= -0.4; }
        const sz = S.size[i] * Math.min(1, S.life[i] * 2);
        S.spin[i] += dt * 9;
        m4.compose(p3.set(S.x[i], S.y[i], S.z[i]), q.setFromEuler(e.set(S.spin[i], S.spin[i] * 0.7, S.spin[i] * 1.3)), s3.set(sz, sz * 0.25, sz * 0.8));
        shards.setMatrixAt(i, m4);
        col.setRGB(S.r[i], S.g[i], S.b[i]);
        shards.setColorAt(i, col);
        i++;
      }
      shards.count = nShards;
      shards.instanceMatrix.needsUpdate = true;
      if (shards.instanceColor) shards.instanceColor.needsUpdate = true;
    },
    setQuality() {},
    dispose() {
      clear();
      drumGroup.remove(root);
      shards.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

function makeKit(ctx, M, track) {
  const { THREE } = ctx;
  const stripes = track(new THREE.MeshStandardMaterial({ map: track(stripeTexture(THREE, { stripes: 4 })), roughness: 0.5 }));
  // crack layers for the safety sphere (R = first hit, G = second, B = third)
  const cc = makeCanvas(512, 256); const g = cc.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
  const rng = makeRng(5);
  const crack = (chan, n, x0, y0) => {
    g.strokeStyle = chan; g.lineWidth = 2.2; g.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      let x = x0 + (rng() - 0.5) * 30; let y = y0 + (rng() - 0.5) * 30;
      let a = rng() * Math.PI * 2;
      g.beginPath(); g.moveTo(x, y);
      const segs = 6 + Math.floor(rng() * 6);
      for (let s = 0; s < segs; s++) { a += (rng() - 0.5) * 1.1; x += Math.cos(a) * 12; y += Math.sin(a) * 12; g.lineTo(x, y); }
      g.stroke();
    }
  };
  g.globalCompositeOperation = 'lighter';
  crack('rgb(255,0,0)', 7, 130, 120);
  crack('rgb(0,255,0)', 9, 360, 90); crack('rgb(0,255,0)', 5, 140, 120);
  crack('rgb(0,0,255)', 10, 250, 190); crack('rgb(0,0,255)', 8, 450, 160); crack('rgb(0,0,255)', 8, 40, 60);
  const crackTex = track(toTexture(THREE, cc, { srgb: false, aniso: 4 }));
  return { M, stripes, crackTex, signs: getSigns(ctx), track };
}

// ---------------------------------------------------------------------------------------------
function buildTank(ctx, view, kit) {
  const { THREE } = ctx;
  const r = view.radius || 0.2; const hl = view.halfLength || 0.5;
  const group = new THREE.Group();
  const B = builder(THREE, { colors: true });
  B.add(new THREE.CylinderGeometry(r, r, hl * 2, 18), { pos: [0, -0.02, 0], color: PAL.mint3 });
  B.add(new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), { pos: [0, -hl - 0.02, 0], color: PAL.mint3 });
  B.add(new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), { pos: [0, hl - 0.02, 0], color: 0xf7f8f6 });
  B.add(new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.1, 18), { pos: [0, hl * 0.62, 0], color: 0xf7f8f6 });
  B.add(new THREE.CylinderGeometry(0.06, 0.08, 0.16, 10), { pos: [0, hl + r - 0.02, 0], color: PAL.chrome });
  B.add(new THREE.TorusGeometry(0.075, 0.02, 6, 12), { pos: [0, hl + r + 0.06, 0], rot: [Math.PI / 2, 0, 0], color: PAL.hazard });
  B.add(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), { pos: [0, -hl - r - 0.01, 0], color: PAL.steelDark }); // nozzle
  const geo = kit.track(B.build());
  const body = new THREE.Mesh(geo, kit.M.paintedMetal);
  body.castShadow = true;
  group.add(body);
  // warning stripe band + wrapped label
  const band = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(r * 1.015, r * 1.015, 0.12, 18, 1, true)), kit.stripes);
  band.position.y = -hl * 0.55;
  group.add(band);
  const rect = kit.signs.rects.o2.uv;
  const lg = new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.34, 16, 1, true, -Math.PI * 0.35 + Math.PI / 2, Math.PI * 0.7);
  const uv = lg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
  const label = new THREE.Mesh(kit.track(lg), kit.signs.material);
  label.position.y = 0.05;
  group.add(label);
  // puncture: exhaust jet (additive) out of the -y nozzle + amber warning pulse
  const jetMat = new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
  const jetGeo = new THREE.ConeGeometry(0.16, 1, 10, 1, true);
  jetGeo.translate(0, -0.5, 0);
  const jet = new THREE.Mesh(jetGeo, jetMat);
  jet.position.y = -hl - r - 0.03;
  group.add(jet);
  const glowMat = new THREE.MeshBasicMaterial({ color: PAL.amber, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 12, 8), glowMat);
  glow.scale.set(1, (hl + r) / r, 1);
  group.add(glow);
  let t = 0; let last = null;
  return {
    group,
    update(v, dt) {
      t += dt;
      const punct = v.state === 'punctured';
      const th = punct ? (v.thrust ?? 1) : 0;
      jetMat.opacity = th * (0.55 + 0.25 * Math.sin(t * 60));
      jet.scale.set(1 + 0.2 * Math.sin(t * 47), th * (0.9 + 0.5 * Math.abs(Math.sin(t * 31))), 1 + 0.2 * Math.sin(t * 53));
      jet.visible = th > 0.01;
      const fuse = v.fuse ?? 1;
      glowMat.opacity = punct ? 0.18 * (Math.sin(t * (10 + 30 / Math.max(0.2, fuse))) > 0 ? 1 : 0.2) : 0;
      last = v;
    },
    onRemove(v) {
      if (v && v.state === 'exploded') {
        const p = group.position;
        kit.burst(p.x, p.y, p.z, 26, 9, 0.09, [PAL.mint3, 0xf7f8f6, PAL.steel, PAL.hazard]);
      }
    },
    dispose() { jetMat.dispose(); jetGeo.dispose(); glowMat.dispose(); glow.geometry.dispose(); void last; },
  };
}

function buildSphere(ctx, view, kit) {
  const { THREE } = ctx;
  const R = view.radius || 1.0;
  const group = new THREE.Group();
  // shell: faint glass + fresnel rim + crack layers (one shader, additive)
  const shellMat = new THREE.ShaderMaterial({
    uniforms: { cracks: { value: 0 }, crackMap: { value: kit.crackTex }, tint: { value: new THREE.Color(0xe8fbff) } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float cracks; uniform sampler2D crackMap; uniform vec3 tint;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.6) * 0.75 + 0.035;
        vec3 c = texture2D(crackMap, vUv).rgb;
        float cr = c.r * step(0.05, cracks) + c.g * step(0.45, cracks) + c.b * step(0.8, cracks);
        // a highlight that stays in view space (gloss)
        float spec = pow(max(0.0, dot(normalize(vN), normalize(vec3(-0.45, 0.6, 0.66)))), 40.0) * 0.9;
        gl_FragColor = vec4(tint * (rim + spec + cr * 0.9), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20), shellMat);
  shell.renderOrder = 12;
  group.add(shell);
  // faint tinted body so the ball reads against pale walls
  const tintMat = new THREE.MeshStandardMaterial({ color: 0xcff3ee, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const body = new THREE.Mesh(new THREE.SphereGeometry(R * 0.995, 24, 16), tintMat);
  body.renderOrder = 11;
  group.add(body);
  // hazard-yellow structural hoops + axle hubs (show the roll)
  const B = builder(THREE, { colors: true });
  B.add(new THREE.TorusGeometry(R * 1.005, 0.045, 6, 48), { color: PAL.hazard });
  B.add(new THREE.TorusGeometry(R * 1.005, 0.045, 6, 48), { rot: [0, Math.PI / 2, 0], color: PAL.hazard });
  B.add(new THREE.TorusGeometry(R * 1.005, 0.03, 6, 48), { rot: [Math.PI / 2, 0, 0], color: 0xf7f8f6 });
  for (const s of [-1, 1]) B.add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12), { pos: [0, 0, s * R], rot: [Math.PI / 2, 0, 0], color: PAL.steelDark });
  const hoopGeo = B.build();
  const hoops = new THREE.Mesh(hoopGeo, kit.M.paintedMetal);
  hoops.castShadow = true;
  group.add(hoops);
  let lastCr = 0;
  return {
    group,
    update(v) {
      const cr = v.cracks ?? (v.maxHits ? (v.hits || 0) / v.maxHits : 0);
      shellMat.uniforms.cracks.value = cr;
      tintMat.opacity = 0.12 + cr * 0.08;
      lastCr = cr;
    },
    onRemove(v) {
      const p = group.position;
      if (!v || v.shattered !== false) kit.burst(p.x, p.y, p.z, 70, 6, R * 0.11, [0xe9fbff, 0xd5f2ee, 0xffffff, PAL.hazard]);
      void lastCr;
    },
    dispose() {
      shellMat.dispose(); tintMat.dispose(); shell.geometry.dispose(); body.geometry.dispose(); hoopGeo.dispose();
    },
  };
}

function buildPlaceholder(ctx, view, kit) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  const s = view.radius ? view.radius * 2 : 0.5;
  const geo = rbox(THREE, s, s, s, s * 0.15);
  group.add(new THREE.Mesh(geo, kit.stripes));
  return { group, dispose() { geo.dispose(); } };
}
