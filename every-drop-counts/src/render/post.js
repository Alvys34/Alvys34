/**
 * Post-processing (VFX owns). A small hand-rolled pipeline (no EffectComposer, no per-frame
 * allocation, CSP-safe: shaders only):
 *
 *   scene -> HDR target (HalfFloat, MSAA per preset)
 *        -> bloom: soft-threshold prefilter at 1/2 res, dual-filter (Kawase) down/up chain
 *        -> composite to screen: chromatic aberration, accent radial blur, bloom add,
 *           desaturate-except-blood accent, fill-driven grade, ACES (renderer.toneMappingExposure),
 *           sRGB, vignette (+ red edge on slam / high fill), grain.
 *
 *   createPost(ctx) -> { render(dt, state), resize(w, h), setQuality(q), stats(), dispose() }
 *
 * Escalation with pool fill (GDD §8): cool clinical white balance -> sickly, red-shifted; vignette,
 * chromatic aberration (medium/high) and grain grow as fill -> 1.
 * Accents: slam = damage flash (exposure pop + red edges); >= 2 simultaneous severs (hit-stop) =
 * brief desaturate-except-blood; slow-mo kill streaks (same rule as src/core/feel.js) = desaturate
 * + radial blur for the slow-mo duration; big combos (x4+) = radial blur pulse.
 * "Blood" pixels are detected with bloodUniforms.uBloodKey, so the green blood setting keeps working.
 */
import { bloodUniforms } from './blood/palette.js';
import { TUNABLES } from '../core/tunables.js';

const VS = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export function createPost(ctx) {
  const { THREE, renderer, scene, camera, bus } = ctx;
  let q = ctx.quality;
  const size = new THREE.Vector2();
  let W = 0; let H = 0;
  let rtScene = null;
  const bloom = []; // render targets, level 0 = 1/2 res
  let bloomLevels = 0; let msaa = 0;

  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsScene = new THREE.Scene();
  const fsGeo = new THREE.PlaneGeometry(2, 2);
  const fsQuad = new THREE.Mesh(fsGeo);
  fsQuad.frustumCulled = false;
  fsScene.add(fsQuad);

  const mk = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });

  const prefilter = mk(/* glsl */`
    uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
    varying vec2 vUv;
    vec3 pick(vec2 uv) {
      vec3 c = texture2D(tSrc, uv).rgb;
      float br = max(c.r, max(c.g, c.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      float w = max(soft, br - uThreshold) / max(br, 1e-4);
      return c * w / (1.0 + br * 0.25); // tame fireflies (tiny glossy drops)
    }
    void main() {
      vec2 o = uTexel;
      gl_FragColor = vec4((pick(vUv + vec2(-o.x, -o.y)) + pick(vUv + vec2(o.x, -o.y)) + pick(vUv + vec2(-o.x, o.y)) + pick(vUv + vec2(o.x, o.y))) * 0.25, 1.0);
    }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uKnee: { value: 0.5 } });

  const down = mk(/* glsl */`
    uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
    void main() {
      vec2 o = uTexel * 0.5;
      vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
      s += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb;
      s += texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb;
      gl_FragColor = vec4(s / 8.0, 1.0);
    }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });

  const up = mk(/* glsl */`
    uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uScatter; varying vec2 vUv;
    void main() {
      vec2 o = uTexel * 0.5;
      vec3 s = texture2D(tSrc, vUv + vec2(-o.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(o.x * 2.0, 0.0)).rgb;
      s += texture2D(tSrc, vUv + vec2(0.0, -o.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, o.y * 2.0)).rgb;
      s += (texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb
          + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb) * 2.0;
      gl_FragColor = vec4(s / 12.0 * uScatter, 1.0);
    }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.85 } },
  { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });

  const U = {
    tScene: { value: null }, tBloom: { value: null },
    uBloom: { value: 0.0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uFill: { value: 0 }, uVignette: { value: 0.22 }, uCA: { value: 0 }, uGrain: { value: 0.015 },
    uFlash: { value: 0 }, uRedEdge: { value: 0 }, uDesat: { value: 0 }, uRadial: { value: 0 }, uExposure: { value: 1 },
    uBloodKey: bloodUniforms.uBloodKey, uBloodFresh: bloodUniforms.uBloodFresh,
  };
  const composite = mk(/* glsl */`
    uniform float toneMappingExposure;
    // == three's ACESFilmicToneMapping (inlined: its chunk re-declares the colour-space helpers)
    vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 acesFilmic(vec3 color) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= toneMappingExposure / 0.6;
      return clamp(outM * RRTAndODTFit(inM * color), 0.0, 1.0);
    }
    uniform sampler2D tScene; uniform sampler2D tBloom;
    uniform float uBloom; uniform float uTime; uniform vec2 uRes;
    uniform float uFill; uniform float uVignette; uniform float uCA; uniform float uGrain;
    uniform float uFlash; uniform float uRedEdge; uniform float uDesat; uniform float uRadial; uniform float uExposure;
    uniform vec3 uBloodKey; uniform vec3 uBloodFresh;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec2 uv = vUv; vec2 d = uv - 0.5;
      vec3 col;
      if (uCA > 0.0001) {
        vec2 o = d * uCA;
        col = vec3(texture2D(tScene, uv + o).r, texture2D(tScene, uv).g, texture2D(tScene, uv - o).b);
      } else {
        col = texture2D(tScene, uv).rgb;
      }
      if (uRadial > 0.001) {
        vec3 acc = col; float wsum = 1.0;
        for (int i = 1; i < 10; i++) {
          float k = float(i) / 10.0; float w = 1.0 - k * 0.6;
          acc += texture2D(tScene, uv - d * k * 0.09 * uRadial).rgb * w; wsum += w;
        }
        col = acc / wsum;
      }
      if (uBloom > 0.0) col += texture2D(tBloom, uv).rgb * uBloom;
      // how much this pixel is "blood"
      float m = max(col.r, max(col.g, col.b));
      float sat = m > 1e-4 ? (m - min(col.r, min(col.g, col.b))) / m : 0.0;
      float bl = smoothstep(0.86, 0.97, dot(normalize(col + 1e-5), uBloodKey)) * smoothstep(0.35, 0.7, sat);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // grade: clinical cool -> sickly, red-shifted with fill
      float f = smoothstep(0.04, 0.9, uFill);
      vec3 wb = mix(vec3(0.965, 1.0, 1.045), vec3(1.05, 0.99, 0.87), f);
      col *= wb;
      col = mix(vec3(lum), col, mix(1.04, 0.9, f) + bl * (0.12 + 0.1 * f));
      col.r += lum * 0.04 * f;
      col = max(col - vec3(0.004 * f), 0.0) * (1.0 + 0.05 * f); // a touch of crush/contrast as it gets grim
      // accents: desaturate everything except blood
      col = mix(col, vec3(lum) * vec3(1.0, 1.0, 1.04), uDesat * (1.0 - bl));
      col *= uExposure;
      col = acesFilmic(col);
      // display space
      float r = length(d * vec2(1.0, 0.82)) * 2.0;
      float vig = smoothstep(0.55, 1.45, r);
      col *= 1.0 - uVignette * vig;
      vec3 edgeRed = uBloodFresh * 0.6 + vec3(0.06, 0.0, 0.0);
      col = mix(col, edgeRed, clamp(vig * (uRedEdge + 0.22 * f * f), 0.0, 0.85));
      vec4 o = sRGBTransferOETF(vec4(clamp(col, 0.0, 1.0), 1.0));
      float g = hash(uv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;
      o.rgb += g * uGrain;
      gl_FragColor = vec4(o.rgb, 1.0);
    }`, U);

  // ---------------- targets ----------------
  function disposeTargets() {
    if (rtScene) rtScene.dispose();
    rtScene = null;
    for (const b of bloom) b.dispose();
    bloom.length = 0;
  }
  function build() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, size.x | 0); const h = Math.max(1, size.y | 0);
    const wantMsaa = q.msaa | 0; const wantBloom = q.bloom | 0;
    if (rtScene && w === W && h === H && wantMsaa === msaa && wantBloom === bloomLevels) return;
    disposeTargets();
    W = w; H = h; msaa = wantMsaa; bloomLevels = wantBloom;
    rtScene = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: msaa, depthBuffer: true, stencilBuffer: false });
    rtScene.texture.name = 'postScene';
    let bw = w; let bh = h;
    for (let i = 0; i < bloomLevels; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      const t = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
      t.texture.name = `bloom${i}`;
      bloom.push(t);
    }
    U.uRes.value.set(w, h);
  }

  function pass(mat, target, clear = true) {
    fsQuad.material = mat;
    renderer.setRenderTarget(target);
    const ac = renderer.autoClear;
    renderer.autoClear = clear;
    renderer.render(fsScene, fsCam);
    renderer.autoClear = ac;
  }

  // ---------------- accents (event-driven, mirrors src/core/feel.js rules) ----------------
  const F = TUNABLES.feel;
  let flash = 0; let hit = 0; let slow = 0; let slowLeft = 0; let radial = 0; let paused = false;
  let severT = -1; let severN = 0;
  const kills = new Float64Array(16); let killN = 0; let slowCool = 0;
  const offs = [
    bus.on('slam', () => { flash = 1; }),
    bus.on('prop:explode', () => { flash = Math.max(flash, 0.8); radial = Math.max(radial, 0.8); }),
    bus.on('limb:sever', (p) => {
      if (p.t === severT) severN++; else { severT = p.t; severN = 1; }
      if (severN === F.hitStopMinEvents) hit = 1;
    }),
    bus.on('donor:death', (p) => {
      if (p.cause === 'drown') return;
      if (killN === kills.length) { kills.copyWithin(0, 1); killN--; }
      kills[killN++] = p.t;
      let k0 = 0; while (k0 < killN && p.t - kills[k0] > F.slowMoWindow) k0++;
      if (k0) { kills.copyWithin(0, k0, killN); killN -= k0; }
      if (killN >= F.slowMoKills && p.t >= slowCool) { slowLeft = F.slowMoDuration; slowCool = p.t + F.slowMoWindow; killN = 0; radial = Math.max(radial, 0.7); }
    }),
    bus.on('combo', (p) => { if ((p.multiplier || 0) >= 4) radial = Math.max(radial, 0.5 + Math.min(0.5, (p.multiplier - 4) * 0.12)); }),
    bus.on('game:pause', (p) => { paused = !!(p && p.paused); }),
    bus.on('shift:start', () => { flash = hit = slow = radial = 0; slowLeft = 0; killN = 0; slowCool = 0; }),
  ];

  let lastNow = 0; let time = 0; let fill = 0;
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function render(dt, state) {
    const now = nowMs();
    let real = lastNow ? (now - lastNow) / 1000 : 0;
    lastNow = now;
    if (!(real > 0) || real > 0.1) real = 1 / 60;
    if (paused) real = 0;
    time += real;
    if (state && state.pool) fill += ((state.pool.fill || 0) - fill) * Math.min(1, real * 3);
    flash = Math.max(0, flash - real / 0.28);
    hit = Math.max(0, hit - real / 0.2);
    radial = Math.max(0, radial - real / 0.45);
    if (slowLeft > 0) { slowLeft -= real; slow = Math.min(1, slow + real / 0.08); } else slow = Math.max(0, slow - real / 0.25);

    build();
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);

    const useBloom = bloomLevels > 0;
    if (useBloom) {
      prefilter.uniforms.tSrc.value = rtScene.texture;
      prefilter.uniforms.uTexel.value.set(1 / W, 1 / H);
      pass(prefilter, bloom[0]);
      for (let i = 1; i < bloomLevels; i++) {
        down.uniforms.tSrc.value = bloom[i - 1].texture;
        down.uniforms.uTexel.value.set(1 / bloom[i - 1].width, 1 / bloom[i - 1].height);
        pass(down, bloom[i]);
      }
      for (let i = bloomLevels - 1; i > 0; i--) {
        up.uniforms.tSrc.value = bloom[i].texture;
        up.uniforms.uTexel.value.set(1 / bloom[i].width, 1 / bloom[i].height);
        pass(up, bloom[i - 1], false);
      }
    }

    const f = Math.min(1, Math.max(0, fill / 0.82));
    U.tScene.value = rtScene.texture;
    U.tBloom.value = useBloom ? bloom[0].texture : null;
    U.uBloom.value = useBloom ? 0.32 + 0.12 * f : 0;
    U.uTime.value = time;
    U.uFill.value = f;
    U.uVignette.value = 0.2 + 0.3 * f + 0.1 * flash + 0.12 * slow;
    U.uCA.value = q.ca ? 0.001 + 0.0045 * f * f + 0.002 * flash + 0.002 * radial : 0;
    U.uGrain.value = q.grain === false ? 0 : 0.012 + 0.04 * f;
    U.uFlash.value = flash;
    U.uRedEdge.value = 0.55 * flash * flash;
    U.uDesat.value = Math.min(1, 0.85 * slow + 0.7 * hit);
    U.uRadial.value = q.bloom > 0 || q.radial ? Math.max(radial, slow * 0.5) : 0;
    U.uExposure.value = 1 + 0.14 * flash * flash + 0.08 * hit;
    pass(composite, null);
  }

  return {
    render,
    resize() { build(); },
    setQuality(qq) { q = qq; build(); },
    stats() { return { size: [W, H], msaa, bloomLevels, passes: 2 + (bloomLevels > 0 ? bloomLevels * 2 : 0) }; },
    dispose() {
      offs.forEach((o) => o());
      disposeTargets();
      fsGeo.dispose(); prefilter.dispose(); down.dispose(); up.dispose(); composite.dispose();
    },
  };
}
