/**
 * Drowning meters (ART owns; PLAYTEST-1 M2 "make drowning a visible, timed threat"). For every LIVE
 * donor with `donor.drown01 > 0.05` (sim: progress toward drowning, 0..1, see src/sim/README.md):
 *   - a small screen-facing "air" gauge over the head: dark disc, pale blue-white ring, and a pale
 *     pie of the air that is LEFT (empties clockwise as drown01 -> 1; pulses in the last quarter);
 *   - bubbles rising from the head to the pool surface above it, popping there as a small ring.
 * Pale blue-white on a dark keyline: reads on mint tiles, on the red pool and on red walls; never red.
 * All meters + bubbles are ONE InstancedMesh (one draw call), drawn on top (after the pool/glass).
 *
 *   const meters = createDrownMeters(ctx, parent);
 *   meters.begin(); meters.add(x, y, z, drown01, id) per live donor head (drum-local); meters.end(dt, state);
 *   meters.debugValue = 0.6   // debug: force this value on every live donor (null = off)
 */
const MAX_METERS = 48;
const MAX_BUBBLES = 220;
const CAP = MAX_METERS + MAX_BUBBLES;
const METER_SIZE = 0.46; // m (diameter); ~23 px at the wide 720p framing (donor ~90 px tall)

export function createDrownMeters(ctx, parent) {
  const { THREE } = ctx;
  const geo = new THREE.PlaneGeometry(1, 1);
  const data = new Float32Array(CAP * 4);
  const aData = new THREE.InstancedBufferAttribute(data, 4); // kind (0 meter / 1 bubble / 2 pop), value, size (m), alpha
  aData.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aData', aData);
  const mat = new THREE.ShaderMaterial({
    name: 'drownMeters',
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute vec4 aData;
      varying vec2 vQ; varying vec4 vD;
      void main() {
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        c.xy += position.xy * aData.z;   // screen-facing quad
        vQ = position.xy * 2.0; vD = aData;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vQ; varying vec4 vD;
      const vec3 PALE = vec3(0.80, 0.93, 1.0);
      const vec3 INK = vec3(0.02, 0.05, 0.08);
      void main() {
        float r = length(vQ);
        if (r > 1.0) discard;
        float aa = 0.06;
        vec3 col; float a;
        if (vD.x < 0.5) {
          // air gauge: keyline, pale ring, dark well, pale pie of the air left (from 12 o'clock, clockwise)
          float left = 1.0 - clamp(vD.y, 0.0, 1.0);
          float t = fract(atan(vQ.x, vQ.y) / 6.2831853 + 1.0);
          float pie = (1.0 - smoothstep(0.62, 0.62 + aa, r)) * step(t, left);
          float ring = smoothstep(0.72, 0.72 + aa, r) * (1.0 - smoothstep(0.88, 0.88 + aa, r));
          float hurry = smoothstep(0.7, 0.8, vD.y) * (0.5 + 0.5 * sin(uTime * 14.0));
          col = INK; a = 0.72;
          col = mix(col, PALE * (0.95 + 0.25 * hurry), max(pie, ring));
          a = mix(a, 1.0, max(pie, ring));
          a *= 1.0 - smoothstep(1.0 - aa, 1.0, r);
          a *= vD.w;
        } else if (vD.x < 1.5) {
          // bubble: bright rim, clear middle, a highlight
          float rim = smoothstep(0.55, 0.85, r) * (1.0 - smoothstep(0.9, 1.0, r));
          float hl = 1.0 - smoothstep(0.0, 0.3, length(vQ - vec2(-0.32, 0.34)));
          col = mix(PALE, vec3(1.0), hl);
          a = max(rim * 0.9, hl * 0.95) + 0.12;
          a *= vD.w;
        } else {
          // pop at the surface: an expanding thin ring
          float w = 0.16;
          a = smoothstep(1.0 - w * 2.0, 1.0 - w, r) * (1.0 - smoothstep(1.0 - w * 0.5, 1.0, r)) * vD.w;
          col = PALE;
        }
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 13; mesh.name = 'drown-meters';
  mesh.castShadow = false; mesh.receiveShadow = false;
  parent.add(mesh);

  // meters this frame
  const mX = new Float32Array(MAX_METERS); const mY = new Float32Array(MAX_METERS); const mZ = new Float32Array(MAX_METERS);
  const mV = new Float32Array(MAX_METERS); const mId = new Float64Array(MAX_METERS);
  let nm = 0;
  // bubbles (drum-local)
  const bX = new Float32Array(MAX_BUBBLES); const bY = new Float32Array(MAX_BUBBLES); const bZ = new Float32Array(MAX_BUBBLES);
  const bS = new Float32Array(MAX_BUBBLES); const bL = new Float32Array(MAX_BUBBLES); const bP = new Float32Array(MAX_BUBBLES); // size, life, phase
  const bK = new Uint8Array(MAX_BUBBLES); // 1 rising, 2 pop
  let nb = 0;
  const emitAcc = new Map(); // donor id -> fractional bubble count
  let seed = 4242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const m4 = new THREE.Matrix4();
  let time = 0;

  function spawnBubble(x, y, z, size, kind = 1, life = 2.5) {
    if (nb >= MAX_BUBBLES) return;
    const i = nb++;
    bX[i] = x; bY[i] = y; bZ[i] = z; bS[i] = size; bL[i] = life; bP[i] = rnd() * 6.28; bK[i] = kind;
  }
  function killBubble(i) {
    const j = --nb;
    if (i !== j) { bX[i] = bX[j]; bY[i] = bY[j]; bZ[i] = bZ[j]; bS[i] = bS[j]; bL[i] = bL[j]; bP[i] = bP[j]; bK[i] = bK[j]; }
  }

  const api = {
    debugValue: null,
    begin() { nm = 0; },
    /** a live donor's head (drum-local, interpolated) and its drown progress 0..1 */
    add(x, y, z, v, id) {
      if (api.debugValue != null) v = api.debugValue;
      if (!(v > 0.05) || nm >= MAX_METERS) return;
      mX[nm] = x; mY[nm] = y; mZ[nm] = z; mV[nm] = Math.min(1, v); mId[nm] = id; nm++;
    },
    end(dt, state) {
      time += dt;
      mat.uniforms.uTime.value = time;
      const th = ctx.drumAngle || 0;
      const ux = Math.sin(th); const uy = Math.cos(th); // world-up in drum-local coords
      const fx = ctx.poolFx;
      const level = fx && fx.on ? fx.level : -1e9;
      // emit: faster as the air runs out
      for (let k = 0; k < nm; k++) {
        const h = ux * mX[k] + uy * mY[k];
        if (h > level - 0.05) continue; // head is out: no bubbles (the gauge refills)
        const acc = (emitAcc.get(mId[k]) || 0) + dt * (1.5 + 7 * mV[k]);
        let n = Math.floor(acc);
        emitAcc.set(mId[k], acc - n);
        while (n-- > 0) {
          spawnBubble(mX[k] + (rnd() - 0.5) * 0.18, mY[k] + (rnd() - 0.5) * 0.18, mZ[k] + 0.12, 0.07 + rnd() * 0.07);
        }
      }
      if (emitAcc.size > 256) emitAcc.clear();
      // bubbles rise along world-up, wobble, pop at the surface
      let i = 0;
      while (i < nb) {
        bL[i] -= dt;
        if (bL[i] <= 0) { killBubble(i); continue; }
        if (bK[i] === 1) {
          const sp = 1.1 + bS[i] * 6;
          bP[i] += dt * 9;
          const wob = Math.sin(bP[i]) * 0.35;
          bX[i] += (ux * sp + uy * wob) * dt; bY[i] += (uy * sp - ux * wob) * dt;
          const h = ux * bX[i] + uy * bY[i];
          if (h >= level - bS[i] * 0.3 || bL[i] < 0.05) { bK[i] = 2; bL[i] = 0.32; bS[i] *= 1.4; }
        } else {
          bS[i] += dt * 0.9;
        }
        i++;
      }
      // upload: meters first, then bubbles
      let c = 0;
      for (let k = 0; k < nm; k++, c++) {
        m4.makeTranslation(mX[k] + ux * 0.44, mY[k] + uy * 0.44, mZ[k] + 0.2);
        mesh.setMatrixAt(c, m4);
        const o = c * 4;
        data[o] = 0; data[o + 1] = mV[k]; data[o + 2] = METER_SIZE; data[o + 3] = Math.min(1, (mV[k] - 0.05) * 12);
      }
      for (let k = 0; k < nb && c < CAP; k++, c++) {
        m4.makeTranslation(bX[k], bY[k], bZ[k]);
        mesh.setMatrixAt(c, m4);
        const o = c * 4;
        data[o] = bK[k]; data[o + 1] = 0; data[o + 2] = bS[k] * 2;
        data[o + 3] = bK[k] === 2 ? Math.min(1, bL[k] / 0.32) : Math.min(1, bL[k] * 3);
      }
      mesh.count = c;
      mesh.visible = c > 0;
      if (c > 0) { mesh.instanceMatrix.needsUpdate = true; aData.needsUpdate = true; }
      void state;
    },
    clear() { nm = 0; nb = 0; emitAcc.clear(); mesh.count = 0; mesh.visible = false; },
    get count() { return { meters: nm, bubbles: nb }; },
    dispose() { parent.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
  return api;
}
