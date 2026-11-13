/**
 * Blood particles (VFX): an instanced, allocation-free particle pool simulated in the DRUM'S
 * ROTATING FRAME (the same frame and forces as src/sim/physics.js applyFrameForces: rotating gravity,
 * centrifugal w^2 r, Euler -a z x r, Coriolis as an exact rotation of the in-plane velocity), with
 * analytic collisions against the drum's inner box and the pool surface. Lives in ctx.drumGroup,
 * so positions are drum-local and stains/drops rotate with the drum for free.
 *
 * Rendered as camera-facing quads stretched along the on-screen velocity (screen velocity includes
 * the drum's own rotation w x r): a glossy capsule/teardrop with a fake sphere normal + specular for
 * drops, soft blobs for mist, rings for bubbles.
 *
 *   const ps = createParticles(ctx, { cap, mist: false });
 *   ps.spawn(x, y, z, vx, vy, vz, size, life, kind)   // kind: 0 drop, 1 mist, 2 bubble
 *   ps.step(h, env, hooks)   // env: see blood/index.js; hooks.onHit/onPool/onPop
 *   ps.upload(omega)         // write instance buffers (once per frame)
 */
import { bloodUniforms } from './palette.js';

export const KIND_DROP = 0; export const KIND_MIST = 1; export const KIND_BUBBLE = 2;

export function createParticles(ctx, { cap, mist = false, renderOrder = 0 }) {
  const { THREE, drumGroup } = ctx;
  const px = new Float32Array(cap); const py = new Float32Array(cap); const pz = new Float32Array(cap);
  const vx = new Float32Array(cap); const vy = new Float32Array(cap); const vz = new Float32Array(cap);
  const sz = new Float32Array(cap); const life = new Float32Array(cap); const life0 = new Float32Array(cap);
  const kind = new Uint8Array(cap); const seed = new Float32Array(cap);
  let count = 0;
  let limit = cap;

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const iPos = new Float32Array(cap * 3); const iVel = new Float32Array(cap * 3); const iMisc = new Float32Array(cap * 4);
  const aPos = new THREE.InstancedBufferAttribute(iPos, 3).setUsage(THREE.DynamicDrawUsage);
  const aVel = new THREE.InstancedBufferAttribute(iVel, 3).setUsage(THREE.DynamicDrawUsage);
  const aMisc = new THREE.InstancedBufferAttribute(iMisc, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos); geo.setAttribute('iVel', aVel); geo.setAttribute('iMisc', aMisc);
  geo.instanceCount = 0;

  const uniforms = {
    ...bloodUniforms,
    uOmega: { value: 0 },
    uStretch: { value: mist ? 0.02 : 0.03 },
    uMaxLen: { value: mist ? 0.5 : 0.75 },
    uLight: { value: 1 },
    uSize: { value: mist ? 1.4 : 1.85 }, // rendered size vs physical size (readability at gameplay zoom)
  };
  const mat = new THREE.ShaderMaterial({
    name: mist ? 'bloodMist' : 'bloodDrops',
    defines: mist ? { MIST: 1 } : {},
    uniforms,
    vertexShader: /* glsl */`
      attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iMisc; // size, kind, fade, seed
      uniform float uOmega; uniform float uStretch; uniform float uMaxLen; uniform float uSize;
      varying vec2 vQ; varying float vKind; varying float vFade; varying float vRatio; varying float vSeed;
      void main() {
        vec3 vel = iVel + vec3(-uOmega * iPos.y, uOmega * iPos.x, 0.0);
        vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
        vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz;
        float r = iMisc.x * uSize;
        float sp = length(vv.xy);
        vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
        float k = iMisc.y > 1.5 ? 0.0 : 1.0; // bubbles do not stretch
        float len = min(r + sp * uStretch * k, max(r, uMaxLen));
        float wid = r * mix(1.0, 0.62, clamp((len / r - 1.0) * 0.3, 0.0, 1.0)); // stringy at speed
        vec2 perp = vec2(-dir.y, dir.x);
        // head at the particle position, tail trailing behind it
        mv.xy += dir * (position.y * len - (len - r)) + perp * position.x * wid;
        vQ = position.xy; vKind = iMisc.y; vFade = iMisc.z; vRatio = len / wid; vSeed = iMisc.w;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uBloodFresh; uniform vec3 uBloodHi; uniform vec3 uBloodMist; uniform vec3 uBloodFoam; uniform vec3 uBloodDeep;
      uniform float uLight;
      varying vec2 vQ; varying float vKind; varying float vFade; varying float vRatio; varying float vSeed;
      void main() {
        // capsule in quad space: x across (radius 1), y along (half length vRatio, in widths)
        float L = vRatio;
        float yy = vQ.y * L;
        // teardrop: the tail (y < 0) narrows
        float taper = mix(0.45, 1.0, clamp((vQ.y + 1.0) * 0.5 + 0.35, 0.0, 1.0));
        float cy = clamp(yy, -(L - 1.0), L - 1.0);
        vec2 p = vec2(vQ.x / taper, (yy - cy));
        float d2 = dot(p, p);
        if (d2 > 1.0) discard;
      #ifdef MIST
        if (vKind > 1.5) {
          // bubble: bright rim, clear centre, one glint
          float r = sqrt(d2);
          float ring = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
          float glint = smoothstep(0.35, 0.0, length(vQ - vec2(-0.35, 0.4)));
          gl_FragColor = vec4(uBloodFoam * (0.6 + 0.8 * ring) * uLight + vec3(glint), (ring * 0.75 + glint) * vFade);
        } else {
          float a = (1.0 - d2) * (1.0 - d2) * 0.55 * vFade;
          gl_FragColor = vec4(uBloodMist * (0.55 + 0.25 * (1.0 - d2)) * uLight, a);
        }
      #else
        vec3 n = vec3(p.x, p.y * 0.6 + vQ.y * 0.25, 0.0);
        n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
        n = normalize(n);
        vec3 Ld = normalize(vec3(-0.45, 0.7, 0.55));
        float dif = 0.38 + 0.62 * max(dot(n, Ld), 0.0);
        float spec = pow(max(dot(n, normalize(Ld + vec3(0.0, 0.0, 1.0))), 0.0), 48.0);
        float rim = 0.55 + 0.45 * n.z;
        vec3 base = mix(uBloodDeep, uBloodFresh, 0.35 + 0.65 * dif) * 1.35;
        vec3 col = (base * rim + uBloodHi * spec * 2.4) * uLight;
        gl_FragColor = vec4(col, 1.0);
      #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: mist,
    depthWrite: !mist,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.name = mist ? 'bloodMist' : 'bloodDrops';
  drumGroup.add(mesh);

  let seedState = mist ? 777 : 4242;
  const rnd = () => { seedState = (seedState * 1664525 + 1013904223) >>> 0; return seedState / 4294967296; };

  function spawn(x, y, z, ivx, ivy, ivz, size, lifeS, k = 0) {
    if (count >= limit) return -1;
    const i = count++;
    px[i] = x; py[i] = y; pz[i] = z; vx[i] = ivx; vy[i] = ivy; vz[i] = ivz;
    sz[i] = size; life[i] = lifeS; life0[i] = lifeS; kind[i] = k; seed[i] = rnd();
    return i;
  }

  function kill(i) {
    const j = --count;
    if (i !== j) {
      px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
      sz[i] = sz[j]; life[i] = life[j]; life0[i] = life0[j]; kind[i] = kind[j]; seed[i] = seed[j];
    }
  }

  /**
   * One sub-step. env: { gx, gy (rotating gravity, drum-local), w2 (omega^2), al (alpha),
   *   cph, sph (Coriolis rotation for this h), HW, HH, HD, ux, uy, c, s (drum angle cos/sin),
   *   level (world height of the pool surface, -1e9 when empty), wave (Float32Array), waveR, waveInvDx, waveN, waveOn }
   * hooks: onHit(surf, x, y, z, vx, vy, vz, size, kind) ; onPool(xw, size, speed, kind) ; onPop(xw, x, y, z)
   */
  function step(h, env, hooks) {
    const { gx, gy, w2, al, cph, sph, HW, HH, HD, ux, uy, c, s, level, wave, waveR, waveInvDx, waveN, waveOn } = env;
    const dragMist = Math.exp(-h * 1.8);
    const dragDrop = Math.exp(-h * 0.12);
    const dragBub = Math.exp(-h * 3.5);
    let i = 0;
    while (i < count) {
      let x = px[i]; let y = py[i]; let z = pz[i];
      let ax = vx[i]; let ay = vy[i]; let az = vz[i];
      const k = kind[i];
      life[i] -= h;
      if (life[i] <= 0) { kill(i); continue; }
      // world height of this point and the pool surface right above/below it
      const xw = c * x - s * y;
      let surfY = level;
      if (waveOn) {
        let f = (xw + waveR) * waveInvDx;
        if (f < 0) f = 0; else if (f > waveN - 1.001) f = waveN - 1.001;
        const i0 = f | 0; const t = f - i0;
        surfY += wave[i0] + (wave[i0 + 1] - wave[i0]) * t;
      }
      if (k === KIND_BUBBLE) {
        // buoyant: accelerate along world up, heavy drag, wobble
        ax = ax * dragBub + ux * 9 * h + Math.sin(life[i] * 13 + seed[i] * 40) * 0.6 * h;
        ay = ay * dragBub + uy * 9 * h + Math.cos(life[i] * 11 + seed[i] * 30) * 0.6 * h;
        az *= dragBub;
        x += ax * h; y += ay * h; z += az * h;
        if (ux * x + uy * y > surfY - 0.02 || x < -HW || x > HW || y < -HH || y > HH) {
          if (hooks.onPop) hooks.onPop(xw, x, y, z);
          kill(i); continue;
        }
        if (z < -HD + 0.05) z = -HD + 0.05; else if (z > HD - 0.05) z = HD - 0.05;
        px[i] = x; py[i] = y; pz[i] = z; vx[i] = ax; vy[i] = ay; vz[i] = az;
        i++; continue;
      }
      // Coriolis: exact rotation of in-plane velocity by -2 w h (energy preserving, as the sim)
      const rx = ax * cph - ay * sph; const ry = ax * sph + ay * cph;
      ax = rx + (gx + w2 * x + al * y) * h;
      ay = ry + (gy + w2 * y - al * x) * h;
      const dr = k === KIND_MIST ? dragMist : dragDrop;
      ax *= dr; ay *= dr; az *= dr;
      x += ax * h; y += ay * h; z += az * h;
      // pool surface (world-level plane + visual waves)
      if (ux * x + uy * y < surfY) {
        if (hooks.onPool) hooks.onPool(xw, sz[i], Math.hypot(ax, ay), k);
        kill(i); continue;
      }
      // drum box: pick the wall with the deepest penetration (relative)
      let surf = -1; let pen = 0; let q;
      if ((q = x + HW) < 0 && -q > pen) { pen = -q; surf = 4; }
      if ((q = HW - x) < 0 && -q > pen) { pen = -q; surf = 5; }
      if ((q = y + HH) < 0 && -q > pen) { pen = -q; surf = 2; }
      if ((q = HH - y) < 0 && -q > pen) { pen = -q; surf = 3; }
      if ((q = z + HD) < 0 && -q > pen) { pen = -q; surf = 0; }
      if ((q = HD - z) < 0 && -q > pen) { pen = -q; surf = 1; }
      if (surf >= 0) {
        if (x < -HW) x = -HW; else if (x > HW) x = HW;
        if (y < -HH) y = -HH; else if (y > HH) y = HH;
        if (z < -HD) z = -HD; else if (z > HD) z = HD;
        if (hooks.onHit) hooks.onHit(surf, x, y, z, ax, ay, az, sz[i], k);
        kill(i); continue;
      }
      px[i] = x; py[i] = y; pz[i] = z; vx[i] = ax; vy[i] = ay; vz[i] = az;
      i++;
    }
  }

  /** Add a velocity change to every particle (slam). */
  function kick(dx, dy, dz) {
    for (let i = 0; i < count; i++) { if (kind[i] !== KIND_BUBBLE) { vx[i] += dx; vy[i] += dy; vz[i] += dz; } }
  }

  function upload(omega, light = 1) {
    for (let i = 0; i < count; i++) {
      const i3 = i * 3; const i4 = i * 4;
      iPos[i3] = px[i]; iPos[i3 + 1] = py[i]; iPos[i3 + 2] = pz[i];
      iVel[i3] = vx[i]; iVel[i3 + 1] = vy[i]; iVel[i3 + 2] = vz[i];
      const l = life[i]; const l0 = life0[i];
      let fade = 1;
      if (kind[i] !== KIND_DROP) fade = Math.min(1, l / 0.35, (l0 - l) / 0.06 + 0.2);
      iMisc[i4] = sz[i]; iMisc[i4 + 1] = kind[i]; iMisc[i4 + 2] = fade; iMisc[i4 + 3] = seed[i];
    }
    geo.instanceCount = count;
    if (count > 0) {
      aPos.clearUpdateRanges(); aPos.addUpdateRange(0, count * 3); aPos.needsUpdate = true;
      aVel.clearUpdateRanges(); aVel.addUpdateRange(0, count * 3); aVel.needsUpdate = true;
      aMisc.clearUpdateRanges(); aMisc.addUpdateRange(0, count * 4); aMisc.needsUpdate = true;
    }
    uniforms.uOmega.value = omega;
    uniforms.uLight.value = light;
    mesh.visible = count > 0;
  }

  return {
    spawn, step, kick, upload,
    clear() { count = 0; geo.instanceCount = 0; mesh.visible = false; },
    setLimit(n) { limit = Math.max(16, Math.min(cap, n | 0)); if (count > limit) count = limit; },
    get count() { return count; },
    get limit() { return limit; },
    get cap() { return cap; },
    mesh,
    dispose() { drumGroup.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
