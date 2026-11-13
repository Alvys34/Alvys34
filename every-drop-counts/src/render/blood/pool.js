/**
 * Pool liquid view (VFX owns). The sim owns the truth (state.pool.fill / level: a world-level plane
 * clipped by the rotating drum box); this adds the look:
 *
 *  - 1D wave simulation along WORLD x across the wet span (mean-free, so the sim's volume holds),
 *    driven by drum angular acceleration (slosh/tilt), angular velocity (liquid climbs the wall that
 *    moves up), slams, splashes, droplets landing, bodies bobbing, submerged saws churning.
 *  - the volume: N world-aligned "curtain" slices through the drum depth (one instanced draw),
 *    clipped to the drum box in the shader. Each slice absorbs a bit, so anything submerged fades
 *    into dark red with its distance from the glass (cheap depth-correct absorption, no depth
 *    texture). The front slice carries the meniscus line + foam band against the glass.
 *  - the surface: a grid sheet with fresnel reflection of the facility, a hot specular highlight,
 *    ripple rings, foam/froth, meniscus where it meets the walls.
 *  - bubbles (submerged saws/grinders, drowning donors, dissolving parts) and splash droplets go
 *    through the shared blood particle system (ctx.blood).
 *
 * createPoolView(ctx) -> { update(dt, state, alpha), onLevel(), setQuality(q), dispose() }
 * Exposes ctx.poolFx = { wave, waveR, waveInvDx, waveN, on, level, impulse(xw, a), addFoam(xw, a), ring(xw, z, amp) }
 */
import { bloodUniforms } from './palette.js';
import { TUNABLES } from '../../core/tunables.js';

const N = 160;
const NZ = 6;

export function createPoolView(ctx) {
  const { THREE, worldGroup, drumGroup, bus, camera } = ctx;
  const HW = TUNABLES.drum.width / 2; const HH = TUNABLES.drum.height / 2; const HD = TUNABLES.drum.depth / 2;
  const R = Math.hypot(HW, HH) + 0.3;
  const dx = (2 * R) / (N - 1);
  const xs = new Float32Array(N);
  for (let i = 0; i < N; i++) xs[i] = -R + i * dx;

  // ---------------- wave state ----------------
  const H = new Float32Array(N); const V = new Float32Array(N); const F = new Float32Array(N);
  const IMP = new Float32Array(N); const SL = new Float32Array(N);
  let i0 = 0; let i1 = -1; let simAcc = 0; let time = 0;
  const corners = new Float64Array(8);

  const group = new THREE.Group();
  group.name = 'pool';
  worldGroup.add(group);

  // ---------------- curtain (volume slices) ----------------
  const cPos = []; const cIdx = [];
  for (let i = 0; i < N; i++) { cPos.push(xs[i], 1, 0, xs[i], 0, 0); }
  for (let i = 0; i < N - 1; i++) { const a = i * 2; cIdx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const curtainGeo = new THREE.InstancedBufferGeometry();
  curtainGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  curtainGeo.setIndex(cIdx);
  const cWave = new Float32Array(N * 2 * 3);
  const cWaveAttr = new THREE.BufferAttribute(cWave, 3).setUsage(THREE.DynamicDrawUsage);
  curtainGeo.setAttribute('aWave', cWaveAttr);
  const MAX_SLICES = 12;
  const iSlice = new Float32Array(MAX_SLICES * 3);
  const iSliceAttr = new THREE.InstancedBufferAttribute(iSlice, 3);
  curtainGeo.setAttribute('iSlice', iSliceAttr);

  const common = {
    uC: { value: 1 }, uS: { value: 0 }, uHW: { value: HW }, uHH: { value: HH }, uHD: { value: HD },
    uLevel: { value: 0 }, uTime: { value: 0 }, uBottom: { value: -R },
  };
  const curtainMat = new THREE.ShaderMaterial({
    name: 'poolVolume',
    uniforms: { ...bloodUniforms, ...common },
    vertexShader: /* glsl */`
      attribute vec3 aWave; attribute vec3 iSlice;
      uniform float uLevel; uniform float uBottom;
      varying vec2 vW; varying float vDepth; varying float vFoam; varying float vFront; varying float vAlpha;
      void main() {
        float top = uLevel + aWave.x;
        float y = position.y > 0.5 ? top : uBottom;
        vec3 p = vec3(position.x, y, iSlice.x);
        vW = p.xy; vDepth = top - y; vFoam = aWave.z; vFront = iSlice.y; vAlpha = iSlice.z;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uC; uniform float uS; uniform float uHW; uniform float uHH; uniform float uTime;
      uniform vec3 uBloodFresh; uniform vec3 uBloodDeep; uniform vec3 uBloodFoam; uniform vec3 uBloodHi;
      varying vec2 vW; varying float vDepth; varying float vFoam; varying float vFront; varying float vAlpha;
      void main() {
        float lx = uC * vW.x + uS * vW.y; float ly = -uS * vW.x + uC * vW.y;
        if (abs(lx) > uHW || abs(ly) > uHH) discard;
        float d = vDepth;
        vec3 col = mix(uBloodFresh * 0.62, uBloodDeep * 0.55, smoothstep(0.0, 3.2, d));
        float a = vAlpha;
        if (vFront > 0.5) {
          float men = smoothstep(0.08, 0.0, d);
          float n = 0.55 + 0.45 * sin(vW.x * 9.0 + uTime * 1.3) * sin(vW.x * 3.1 - uTime * 0.7 + d * 4.0);
          float foam = smoothstep(0.42, 0.04, d) * clamp(vFoam * 1.4 + 0.12, 0.0, 1.0) * n;
          col = mix(col, uBloodFoam * 0.8, foam * 0.65);
          col += uBloodHi * men * 0.55;
          a = max(a, max(men * 0.92, foam * 0.8));
          float sh = sin(vW.x * 2.3 + uTime * 1.1 + d * 3.0) * sin(vW.x * 5.7 - uTime * 1.7 - d * 2.0);
          col *= 1.0 + 0.16 * sh * smoothstep(1.6, 0.0, d);
          // glassy vertical sheen on the front face
          col += uBloodFresh * 0.08 * smoothstep(0.6, 1.0, sin(vW.x * 0.9 + 1.3));
        }
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const curtain = new THREE.Mesh(curtainGeo, curtainMat);
  curtain.frustumCulled = false; curtain.renderOrder = 5; curtain.name = 'poolVolume';
  group.add(curtain);

  // ---------------- surface sheet ----------------
  const sPos = []; const sIdx = [];
  for (let j = 0; j <= NZ; j++) for (let i = 0; i < N; i++) sPos.push(xs[i], 0, -HD + (2 * HD * j) / NZ);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i; const b = a + 1; const c = a + N; const d = c + 1;
      sIdx.push(a, c, b, b, c, d);
    }
  }
  const sheetGeo = new THREE.BufferGeometry();
  sheetGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  sheetGeo.setIndex(sIdx);
  const sWave = new Float32Array(N * (NZ + 1) * 3);
  const sWaveAttr = new THREE.BufferAttribute(sWave, 3).setUsage(THREE.DynamicDrawUsage);
  sheetGeo.setAttribute('aWave', sWaveAttr);
  const rings = []; for (let k = 0; k < 8; k++) rings.push(new THREE.Vector4(0, 0, -99, 0));
  let ringHead = 0;
  const sheetUniforms = {
    ...bloodUniforms, ...common,
    uRings: { value: rings },
    uSun: { value: new THREE.Vector3(-9, 16, 22).normalize() },
    uEnvTop: { value: new THREE.Color(0xe9f6ef) },
    uEnvBot: { value: new THREE.Color(0x6f7a76) },
    uEnvTint: { value: new THREE.Color(1, 1, 1) },
  };
  const sheetMat = new THREE.ShaderMaterial({
    name: 'poolSurface',
    uniforms: sheetUniforms,
    vertexShader: /* glsl */`
      attribute vec3 aWave;
      uniform float uLevel;
      varying vec3 vWorld; varying vec3 vP; varying float vSlope; varying float vFoam;
      void main() {
        vec3 p = vec3(position.x, uLevel + aWave.x, position.z);
        vP = p; vSlope = aWave.y; vFoam = aWave.z;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uC; uniform float uS; uniform float uHW; uniform float uHH; uniform float uHD; uniform float uTime;
      uniform vec4 uRings[8]; uniform vec3 uSun; uniform vec3 uEnvTop; uniform vec3 uEnvBot; uniform vec3 uEnvTint;
      uniform vec3 uBloodFresh; uniform vec3 uBloodDeep; uniform vec3 uBloodFoam; uniform vec3 uBloodHi;
      varying vec3 vWorld; varying vec3 vP; varying float vSlope; varying float vFoam;
      void main() {
        float lx = uC * vP.x + uS * vP.y; float ly = -uS * vP.x + uC * vP.y;
        if (abs(lx) > uHW + 0.01 || abs(ly) > uHH + 0.01) discard;
        vec2 q = vP.xz;
        // base normal from the simulated slope + small travelling ripples
        vec2 g = vec2(-vSlope, 0.0);
        g.x += 0.05 * cos(q.x * 6.0 + q.y * 2.0 + uTime * 2.3) + 0.03 * cos(q.x * 13.0 - q.y * 7.0 - uTime * 3.1);
        g.y += 0.05 * cos(q.y * 5.0 - q.x * 3.0 + uTime * 1.9) + 0.03 * cos(q.y * 11.0 + q.x * 9.0 + uTime * 2.7);
        for (int k = 0; k < 8; k++) {
          vec4 r = uRings[k];
          float age = uTime - r.z;
          if (age < 0.0 || age > 3.0) continue;
          vec2 v = q - r.xy; float dist = length(v) + 1e-4;
          float ph = dist - age * 2.4;
          float amp = r.w * exp(-age * 1.3) * exp(-ph * ph * 5.0);
          g += (v / dist) * sin(ph * 15.0) * amp;
        }
        vec3 n = normalize(vec3(g.x, 1.0, g.y));
        vec3 V = normalize(cameraPosition - vWorld);
        bool under = !gl_FrontFacing;
        if (under) n = -n;
        float ndv = max(dot(n, V), 0.0);
        float F = 0.025 + 0.975 * pow(1.0 - ndv, 5.0);
        vec3 Rv = reflect(-V, n);
        vec3 env = mix(uEnvBot, uEnvTop, smoothstep(-0.25, 0.55, Rv.y)) * uEnvTint;
        float sp = pow(max(dot(Rv, uSun), 0.0), 220.0) * 9.0 + pow(max(dot(Rv, uSun), 0.0), 24.0) * 0.45;
        vec3 body = uBloodDeep * 0.85 + uBloodFresh * 0.16;
        vec3 col = mix(body, env, F * 0.9) + (uBloodHi * 0.35 + vec3(0.65)) * sp * (under ? 0.3 : 1.0);
        // meniscus against the walls / glass + froth
        float e = min(min(uHW - abs(lx), uHH - abs(ly)), uHD - abs(vP.z));
        float men = smoothstep(0.16, 0.0, e);
        float nz = 0.5 + 0.5 * sin(q.x * 17.0 + uTime * 0.9) * sin(q.y * 13.0 - uTime * 1.3 + q.x * 3.0);
        float froth = smoothstep(0.35, 0.85, vFoam * (0.6 + 0.8 * nz));
        col = mix(col, uBloodFoam * 0.85 * uEnvTint, clamp(froth * 0.85 + men * 0.5, 0.0, 1.0));
        float a = under ? 0.96 : clamp(0.86 + F * 0.14 + froth * 0.1, 0.0, 1.0);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  sheet.frustumCulled = false; sheet.renderOrder = 6; sheet.name = 'poolSurface';
  group.add(sheet);

  // ---------------- quality ----------------
  let slices = 8;
  function buildSlices(nSl) {
    slices = Math.max(2, Math.min(MAX_SLICES, nSl | 0));
    // back -> front so blending order is right; total absorption ~0.9 at the back wall
    const back = slices - 1;
    const aBack = 1 - Math.pow(0.12 / 0.72, 1 / back);
    for (let k = 0; k < slices; k++) {
      const front = k === slices - 1;
      const z = front ? HD - 0.03 : -HD + 0.04 + ((HD * 2 - 0.25) * (k + 0.5)) / back;
      iSlice[k * 3] = z; iSlice[k * 3 + 1] = front ? 1 : 0; iSlice[k * 3 + 2] = front ? 0.28 : aBack;
    }
    iSliceAttr.needsUpdate = true;
    curtainGeo.instanceCount = slices;
  }
  buildSlices(ctx.quality.poolSlices || 8);

  // ---------------- events ----------------
  const pend = new Float32Array(32 * 5); let pendN = 0; // type, x, y, z, size
  const push = (type, p, size) => {
    if (!p || pendN >= 32) return;
    const o = pendN * 5; pend[o] = type; pend[o + 1] = p[0]; pend[o + 2] = p[1]; pend[o + 3] = p[2] || 0; pend[o + 4] = size;
    pendN++;
  };
  const offs = [
    bus.on('splash', (p) => push(1, p.pos, p.size ?? 0.5)),
    bus.on('slam', () => push(2, [0, 0, 0], 1)),
    bus.on('part:dissolve', (p) => push(3, p.pos, 0.4)),
    bus.on('prop:explode', (p) => push(4, p.pos, 1)),
  ];

  let rs = 2024;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  const colOf = (xw) => { const f = (xw + R) / dx; return f < 0 ? 0 : f > N - 1 ? N - 1 : Math.round(f); };

  const fx = {
    wave: H, waveR: R, waveInvDx: 1 / dx, waveN: N, on: false, level: -1e9,
    impulse(xw, a) { IMP[colOf(xw)] += a; },
    addFoam(xw, a) { const c = colOf(xw); F[c] = Math.min(2, F[c] + a); },
    ring(xw, z, amp) { const r = rings[ringHead]; ringHead = (ringHead + 1) % 8; r.set(xw, z, time, amp); },
  };
  ctx.poolFx = fx;

  function span(theta, level) {
    const c = Math.cos(theta); const s = Math.sin(theta);
    // rotated rectangle corners (CCW) in world, relative to the drum centre
    corners[0] = c * -HW - s * -HH; corners[1] = s * -HW + c * -HH;
    corners[2] = c * HW - s * -HH; corners[3] = s * HW + c * -HH;
    corners[4] = c * HW - s * HH; corners[5] = s * HW + c * HH;
    corners[6] = c * -HW - s * HH; corners[7] = s * -HW + c * HH;
    let lo = 1e9; let hi = -1e9;
    for (let k = 0; k < 4; k++) {
      const ax = corners[k * 2]; const ay = corners[k * 2 + 1];
      const bx = corners[((k + 1) % 4) * 2]; const by = corners[((k + 1) % 4) * 2 + 1];
      if ((ay - level) * (by - level) <= 0 && ay !== by) {
        const x = ax + ((level - ay) / (by - ay)) * (bx - ax);
        if (x < lo) lo = x; if (x > hi) hi = x;
      }
    }
    if (hi < lo) { i0 = 0; i1 = -1; return; }
    i0 = Math.max(1, Math.ceil((lo + R) / dx));
    i1 = Math.min(N - 2, Math.floor((hi + R) / dx));
  }

  function simulate(h, drum, level) {
    const n = i1 - i0 + 1;
    if (n < 3) { H.fill(0); V.fill(0); IMP.fill(0); return; }
    const cw = 4.6; const c2 = (cw * cw) / (dx * dx);
    const xmid = (xs[i0] + xs[i1]) * 0.5;
    const al = Math.max(-25, Math.min(25, drum.alpha));
    const w = drum.omega;
    const xl = xs[i0]; const xr = xs[i1];
    for (let i = i0; i <= i1; i++) {
      const hl = i > i0 ? H[i - 1] : H[i]; const hr = i < i1 ? H[i + 1] : H[i];
      let acc = c2 * (hl + hr - 2 * H[i]) - 0.9 * V[i];
      acc += -0.09 * al * (xs[i] - xmid);                            // slosh/tilt against angular acceleration
      const el = Math.exp(-(xs[i] - xl) / 0.6); const er = Math.exp(-(xr - xs[i]) / 0.6);
      acc += 1.6 * w * (xr * er + xl * el);                         // liquid dragged up the rising wall
      V[i] += acc * h - IMP[i];
      IMP[i] = 0;
    }
    let mean = 0;
    for (let i = i0; i <= i1; i++) { H[i] += V[i] * h; mean += H[i]; }
    mean /= n;
    for (let i = i0; i <= i1; i++) {
      let v = H[i] - mean;
      if (v > 1.3) { v = 1.3; V[i] *= 0.5; } else if (v < -1.3) { v = -1.3; V[i] *= 0.5; }
      H[i] = v;
    }
    const fd = Math.exp(-h / 3.2);
    for (let i = 0; i < N; i++) {
      if (i < i0 || i > i1) { H[i] = 0; V[i] = 0; IMP[i] = 0; F[i] *= 0.9; continue; }
      F[i] *= fd;
    }
  }

  // shared helpers for spawning through the blood particle system (drum-local)
  let C = 1; let S = 0; let UX = 0; let UY = 1; let LEVEL = 0;
  function spawnWorld(xw, yw, z, wvx, wvy, wvz, size, life, kind, mist) {
    const B = ctx.blood;
    if (!B || !B.emitLocal) return;
    const lx = C * xw + S * yw; const ly = -S * xw + C * yw;
    B.emitLocal(lx, ly, z, C * wvx + S * wvy, -S * wvx + C * wvy, wvz, size, life, kind, mist);
  }
  const surfAt = (xw) => LEVEL + H[colOf(xw)];

  function splashAt(xw, z, size) {
    const c = colOf(xw);
    for (let k = -4; k <= 4; k++) {
      const j = c + k;
      if (j >= i0 && j <= i1) V[j] -= size * 5.5 * Math.exp(-(k * k) / 6);
    }
    F[c] = Math.min(2, F[c] + size * 1.2);
    fx.ring(xw, z, 0.35 * Math.min(1, size + 0.2));
    const scale = ctx.blood ? ctx.blood.emitScale : 1;
    const nd = Math.round((8 + size * 70) * scale);
    const y = surfAt(xw) + 0.05;
    for (let k = 0; k < nd; k++) {
      const up = 2.5 + rnd() * (4 + size * 7);
      const spread = (rnd() - 0.5) * (2 + size * 5);
      spawnWorld(xw + (rnd() - 0.5) * 0.4, y, Math.max(-HD + 0.1, Math.min(HD - 0.1, z + (rnd() - 0.5) * 0.6)), spread, up, (rnd() - 0.5) * 2.5, 0.035 + rnd() * 0.07, 3, 0, false);
    }
    for (let k = 0; k < nd * 0.6; k++) {
      spawnWorld(xw + (rnd() - 0.5) * 0.6, y, z + (rnd() - 0.5), (rnd() - 0.5) * 4, 1.5 + rnd() * 4, (rnd() - 0.5) * 3, 0.06 + rnd() * 0.08, 0.8 + rnd() * 0.5, 1, true);
    }
  }

  function bubbles(x, y, z, n, spread, size = 0.05) {
    const B = ctx.blood;
    if (!B || !B.emitLocal) return;
    for (let k = 0; k < n; k++) {
      B.emitLocal(x + (rnd() - 0.5) * spread, y + (rnd() - 0.5) * spread, z + (rnd() - 0.5) * spread,
        (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.5, size * (0.6 + rnd() * 0.9), 5, 2, true);
    }
  }

  const envTop = new THREE.Color(0xe9f6ef); const red = new THREE.Color(0xff8a7a);

  return {
    update(dt, state, alpha) {
      const P = state.pool;
      const d = state.drum;
      const theta = ctx.drumAngle;
      C = Math.cos(theta); S = Math.sin(theta); UX = Math.sin(theta); UY = Math.cos(theta);
      group.position.copy(drumGroup.position);
      const on = !!P && P.fill > 0.0005;
      fx.on = on;
      if (!on) { curtain.visible = false; sheet.visible = false; fx.level = -1e9; pendN = 0; return; }
      curtain.visible = true; sheet.visible = true;
      const level = P.prevLevel + (P.level - P.prevLevel) * alpha;
      LEVEL = level;
      fx.level = level;
      time += dt;
      span(theta, level);

      // events
      for (let k = 0; k < pendN; k++) {
        const o = k * 5; const type = pend[o]; const x = pend[o + 1]; const y = pend[o + 2]; const z = pend[o + 3]; const size = pend[o + 4];
        const xw = C * x - S * y;
        if (type === 1) splashAt(xw, z, size);
        else if (type === 2) {
          for (let i = i0; i <= i1; i++) V[i] += (rnd() - 0.5) * 5 + 3.5 * Math.sin(xs[i] * 0.9 + rnd() * 6);
          const n = Math.max(2, Math.round((i1 - i0) / 12));
          for (let k2 = 0; k2 < n; k2++) splashAt(xs[i0] + rnd() * (xs[i1] - xs[i0]), (rnd() - 0.5) * 2 * HD * 0.8, 0.5 + rnd() * 0.4);
        } else if (type === 3) {
          if (UX * x + UY * y < level) { bubbles(x, y, z, 12, 0.3, 0.06); fx.addFoam(xw, 0.4); }
        } else if (type === 4) {
          if (UX * x + UY * y < level + 2) for (let i = i0; i <= i1; i++) V[i] += (rnd() - 0.3) * 6;
        }
      }
      pendN = 0;

      // bodies bobbing at / leaving the surface disturb it
      for (const dy of state.dyns) {
        if (dy.removed) continue;
        const sub = dy.sub;
        if (sub <= 0.03 && dy.prevSub <= 0.03) continue;
        const xw = C * dy.x - S * dy.y;
        const c = colOf(xw);
        if (c < i0 || c > i1) continue;
        const vUp = UX * dy.vx + UY * dy.vy;
        const mf = Math.min(1.5, dy.mass / 8);
        if (sub < 0.97) V[c] += Math.max(-8, Math.min(8, vUp)) * 1.1 * mf * dt;
        // a body leaving the liquid fast: a little sheet of blood follows it up
        if (dy.prevSub > 0.3 && sub <= 0.3 && vUp > 3) {
          const nd = Math.round(Math.min(25, vUp * 3 * mf) * (ctx.blood ? ctx.blood.emitScale : 1));
          for (let k = 0; k < nd; k++) spawnWorld(xw + (rnd() - 0.5) * 0.4, surfAt(xw) + 0.05, dy.z + (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 2, vUp * (0.4 + rnd() * 0.6), (rnd() - 0.5), 0.04 + rnd() * 0.05, 3, 0, false);
          F[c] = Math.min(2, F[c] + 0.3);
        }
      }

      // drowning donors burble
      const B = ctx.blood;
      const emitScale = B ? B.emitScale : 1;
      for (const p of state.parts) {
        if (p.removed || p.role !== 'head' || !p.donor.alive || p.sub < 0.6) continue;
        if (rnd() < dt * 7 * emitScale) bubbles(p.x, p.y, p.z, 1, 0.15, 0.05);
      }

      // submerged saws / grinders churn: bubbles + froth + chop
      for (const hz of state.hazards) {
        const v = hz.view;
        if (!v || v.x == null || v.y == null) continue;
        if (v.kind !== 'saw' && v.kind !== 'railSaw' && v.kind !== 'grinder') continue;
        const hw = UX * v.x + UY * v.y;
        const r = v.radius || 1;
        if (hw > level + r * 0.3) continue;
        const sub = Math.min(1, (level - hw + r * 0.3) / (r * 1.3));
        const churn = sub * (0.6 + 1.4 * (hz.load || 0)) * (v.spin != null && state.T ? Math.abs(v.spin) / state.T.hazards.saw.spin : 1);
        const xw = C * v.x - S * v.y;
        const c = colOf(xw);
        if (c >= i0 && c <= i1) {
          for (let k = -3; k <= 3; k++) { const j = c + k; if (j >= i0 && j <= i1) V[j] += (rnd() - 0.5) * churn * 18 * dt; }
          F[c] = Math.min(2, F[c] + churn * dt * 2.2);
          if (c > i0) F[c - 1] = Math.min(2, F[c - 1] + churn * dt * 1.2);
          if (c < i1) F[c + 1] = Math.min(2, F[c + 1] + churn * dt * 1.2);
        }
        if (B && rnd() < dt * 40 * churn * emitScale) {
          const a = rnd() * Math.PI * 2;
          const z0 = v.z0 ?? -HD; const z1 = v.z1 ?? HD;
          bubbles(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r, z0 + rnd() * (z1 - z0), 2, 0.1, 0.06);
        }
      }

      // integrate waves at <= 1/60 steps (debug steps can hand us large dt)
      simAcc = Math.min(simAcc + dt, 0.25);
      const h = 1 / 60;
      while (simAcc >= h) { simulate(h, d, level); simAcc -= h; }

      // upload: slope + foam per column
      for (let i = 0; i < N; i++) {
        const hl = H[i > 0 ? i - 1 : 0]; const hr = H[i < N - 1 ? i + 1 : N - 1];
        SL[i] = (hr - hl) / (2 * dx);
      }
      for (let i = 0; i < N; i++) {
        const o = i * 6;
        cWave[o] = H[i]; cWave[o + 1] = SL[i]; cWave[o + 2] = F[i];
        cWave[o + 3] = 0; cWave[o + 4] = 0; cWave[o + 5] = F[i];
      }
      cWaveAttr.needsUpdate = true;
      for (let j = 0; j <= NZ; j++) {
        const edge = j === 0 || j === NZ ? 0.25 : 0;
        for (let i = 0; i < N; i++) {
          const o = (j * N + i) * 3;
          sWave[o] = H[i]; sWave[o + 1] = SL[i]; sWave[o + 2] = F[i] + edge;
        }
      }
      sWaveAttr.needsUpdate = true;
      common.uC.value = C; common.uS.value = S; common.uLevel.value = level; common.uTime.value = time;
      common.uBottom.value = -R;
      const fill = P.fill;
      sheetUniforms.uEnvTint.value.setRGB(1, 1, 1).lerp(red, Math.min(1, fill / 0.6) * 0.5);
      sheetUniforms.uEnvTop.value.copy(envTop);
      // camera below the surface: draw the sheet first so the volume's front face covers it
      const camY = camera.position.y - group.position.y;
      sheet.renderOrder = camY < level ? 4.5 : 6;
    },
    onLevel() {
      H.fill(0); V.fill(0); F.fill(0); IMP.fill(0); pendN = 0; simAcc = 0;
      for (const r of rings) r.set(0, 0, -99, 0);
    },
    setQuality(q) { buildSlices(q.poolSlices || 8); },
    get waveEnergy() { let e = 0; for (let i = i0; i <= i1; i++) e += H[i] * H[i]; return e; },
    dispose() {
      offs.forEach((o) => o());
      worldGroup.remove(group);
      curtainGeo.dispose(); curtainMat.dispose(); sheetGeo.dispose(); sheetMat.dispose();
      if (ctx.poolFx === fx) ctx.poolFx = null;
    },
  };
}
