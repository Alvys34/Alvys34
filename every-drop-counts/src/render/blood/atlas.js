/**
 * Blood maps (VFX): one HalfFloat render-target ATLAS holding persistent blood for every interior
 * surface of the drum, painted by batched "stamps" (one instanced draw per frame) and shown by two
 * overlay meshes inside the drum group (walls: back/floor/ceiling/left/right; front glass).
 *
 * Atlas layout, in metres (drum interior 2HW x 2HH x 2HD):
 *   row 0  (v 0..2HH):          BACK (2HW x 2HH)          | GLASS (2HW x 2HH)
 *   row 1  (v 2HH..2HH+2HD):    FLOOR y=-HH (x, z)        | CEIL y=+HH (x, z)
 *   row 2  (v ..+2HD):          LEFT x=-HW (y, z) | RIGHT x=+HW (y, z) | (spare)
 * Texel channels: R = blood density (additive, unbounded; shown as 1-exp(-k R)),
 *                 G = "wet" density (decays as it dries; wet fraction = G / R).
 *
 * Stamp kinds: 0 splat (irregular crown blob), 1 streak (runner trail / drip), 2 smear (body slide,
 *              streaky), 3 film (soft wide wash: pool tide), 4 dot (fine speckle / bead).
 *
 * Glass rule (readability): glass stamps are budgeted (`glassLoad`), glass density decays (faster in
 * the middle than at the edges) and the glass overlay caps opacity (low in the centre, higher at the
 * edges), so the front glass smears but never hides play.
 */
import { bloodUniforms } from './palette.js';
import { floatTargetsOK } from '../quality.js';

export const SURF = { BACK: 0, GLASS: 1, FLOOR: 2, CEIL: 3, LEFT: 4, RIGHT: 5 };

/**
 * Back-wall "clean patches" (readability, LOCAL-REPORT-1 §2.2): a stable low-frequency mask over
 * the back wall (metres). 0 = clean patch (blood thins out there and is capped low on screen),
 * 1 = may be fully painted. About a third of the wall is patch, so even a long shift leaves the
 * pastel tiles showing through in blobs of 1-2 m; used by the decay pass and the wall overlay.
 */
const CLEAN_MASK_GLSL = /* glsl */`
  float edcH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float edcVN2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(edcH2(i), edcH2(i + vec2(1.0, 0.0)), f.x), mix(edcH2(i + vec2(0.0, 1.0)), edcH2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float edcCleanMask(vec2 m) {
    float n = edcVN2(m * 0.62 + vec2(3.1, 1.7)) * 0.65 + edcVN2(m * 1.45 + vec2(7.3, 2.9)) * 0.35;
    return smoothstep(0.38, 0.52, n);
  }`;
const smoothstep01 = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export function createBloodAtlas(ctx, { HW, HH, HD }) {
  const { THREE, renderer, drumGroup } = ctx;
  const AW = 4 * HW; const AH = 2 * HH + 4 * HD;
  // region rects [u0, v0, w, h] in metres, and per-surface axes (drum-local) for a/b plane coords
  const REG = [
    [0, 0, 2 * HW, 2 * HH], [2 * HW, 0, 2 * HW, 2 * HH],
    [0, 2 * HH, 2 * HW, 2 * HD], [2 * HW, 2 * HH, 2 * HW, 2 * HD],
    [0, 2 * HH + 2 * HD, 2 * HH, 2 * HD], [2 * HH, 2 * HH + 2 * HD, 2 * HH, 2 * HD],
  ];

  // ---------------- render target ----------------
  let texW = 0; let texH = 0;
  let rt = null;
  // HalfFloat when the GPU can render to it; otherwise 8-bit with density stored at 1/ENC scale
  const FLOAT_OK = floatTargetsOK(renderer);
  const ENC = FLOAT_OK ? 1 : 0.2;
  function makeRT(w) {
    const h = Math.round((w * AH) / AW);
    const t = new THREE.WebGLRenderTarget(w, h, {
      type: FLOAT_OK ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    t.texture.name = 'bloodAtlas';
    return t;
  }

  // ---------------- stamp batch ----------------
  const CAP = 4096;
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const aA = new Float32Array(CAP * 4); const aB = new Float32Array(CAP * 4); const aC = new Float32Array(CAP * 4);
  const attA = new THREE.InstancedBufferAttribute(aA, 4).setUsage(THREE.DynamicDrawUsage);
  const attB = new THREE.InstancedBufferAttribute(aB, 4).setUsage(THREE.DynamicDrawUsage);
  const attC = new THREE.InstancedBufferAttribute(aC, 4).setUsage(THREE.DynamicDrawUsage);
  quad.setAttribute('iA', attA); quad.setAttribute('iB', attB); quad.setAttribute('iC', attC);
  quad.instanceCount = 0;
  const ATTS = [attA, attB, attC];
  const regionU = [];
  for (const r of REG) regionU.push(new THREE.Vector4(r[0], r[1], r[0] + r[2], r[1] + r[3]));

  const stampMat = new THREE.ShaderMaterial({
    name: 'bloodStamp',
    uniforms: { uRegion: { value: regionU }, uAtlas: { value: new THREE.Vector2(AW, AH) }, uEnc: { value: ENC } },
    vertexShader: /* glsl */`
      attribute vec4 iA; // u, v (atlas metres), region, seed
      attribute vec4 iB; // dir.xy, halfLen, halfWidth
      attribute vec4 iC; // amount, kind, wet, unused
      uniform vec4 uRegion[6];
      uniform vec2 uAtlas;
      varying vec2 vQ; varying vec2 vM; varying vec4 vReg; varying vec4 vC; varying float vSeed; varying float vAsp;
      void main() {
        vec2 d = iB.xy; vec2 p = vec2(-d.y, d.x);
        // splats get a little extra quad room for their irregular edge
        float grow = iC.y < 0.5 ? 1.25 : 1.0;
        vec2 q = position.xy * grow;
        vec2 m = iA.xy + d * q.x * iB.z + p * q.y * iB.w;
        vQ = q; vM = m; vReg = uRegion[int(iA.z + 0.5)]; vC = iC; vSeed = iA.w; vAsp = iB.z / max(iB.w, 1e-4);
        gl_Position = vec4(m / uAtlas * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vQ; varying vec2 vM; varying vec4 vReg; varying vec4 vC; varying float vSeed; varying float vAsp;
      uniform float uEnc;
      float h1(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        if (vM.x < vReg.x || vM.y < vReg.y || vM.x > vReg.z || vM.y > vReg.w) discard;
        float kind = vC.y; float amt = vC.x; float d = 0.0;
        vec2 q = vQ;
        if (kind < 0.5) {
          // splat: irregular crown edge, thicker centre, a few fingers
          float r = length(q); float a = atan(q.y, q.x); float s = vSeed * 6.2831;
          float edge = 0.80 + 0.10 * sin(a * 3.0 + s) + 0.07 * sin(a * 7.0 + s * 2.3) + 0.05 * sin(a * 13.0 + s * 5.1);
          float finger = pow(max(0.0, sin(a * 7.0 + s * 3.7)), 16.0) * 0.22 * step(0.7, h1(vSeed * 91.7));
          edge += finger;
          // feathered rim, thick domed centre (reads as a pooled drop, not a sticker)
          d = smoothstep(edge, edge - 0.45, r) * (0.4 + 1.15 * (1.0 - r * r));
          // a leading "head" on elongated splats (droplet hit at an angle)
          if (vAsp > 1.3) d += smoothstep(0.45, 0.25, length(q - vec2(0.55, 0.0))) * 0.5;
        } else if (kind < 1.5) {
          // streak: soft-edged line with a slightly wavy width
          float w = 1.0 - 0.15 * sin(q.x * 3.1 + vSeed * 40.0);
          d = smoothstep(w, w * 0.45, abs(q.y)) * smoothstep(1.0, 0.75, abs(q.x));
        } else if (kind < 2.5) {
          // smear: streaky along its length, feathered ends
          float lines = 0.45 + 0.55 * (0.5 + 0.5 * sin(q.y * 11.0 + vSeed * 30.0)) * (0.6 + 0.4 * sin(q.y * 27.0 + vSeed * 13.0));
          d = smoothstep(1.0, 0.55, abs(q.y)) * smoothstep(1.0, 0.35, abs(q.x)) * lines;
        } else if (kind < 3.5) {
          // film: broad soft wash
          d = (1.0 - q.x * q.x) * (1.0 - q.y * q.y);
          d *= d;
        } else {
          // dot / bead
          d = smoothstep(1.0, 0.6, length(q)) * 1.2;
        }
        d *= amt;
        if (d <= 0.0005) discard;
        gl_FragColor = vec4(d, d * vC.z, 0.0, 0.0) * uEnc;
      }`,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    depthTest: false, depthWrite: false, transparent: false, toneMapped: false,
  });
  const stampMesh = new THREE.Mesh(quad, stampMat);
  stampMesh.frustumCulled = false;

  // ---------------- decay (drying + glass clearing) pass: dst *= src ----------------
  const decayUniforms = {
    uDry: { value: 1 }, uGlassC: { value: 1 }, uGlassE: { value: 1 }, uAtlas: { value: new THREE.Vector2(AW, AH) },
    uGlass: { value: regionU[1] }, uBack: { value: regionU[0] }, uBackClean: { value: 1 },
  };
  const decayMat = new THREE.ShaderMaterial({
    name: 'bloodDecay',
    uniforms: decayUniforms,
    vertexShader: 'varying vec2 vM; uniform vec2 uAtlas; void main(){ vM = (position.xy * 0.5 + 0.5) * uAtlas; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      varying vec2 vM; uniform float uDry; uniform float uGlassC; uniform float uGlassE; uniform vec4 uGlass;
      uniform vec4 uBack; uniform float uBackClean;
      ${CLEAN_MASK_GLSL}
      void main() {
        float mr = 1.0;
        if (vM.x > uGlass.x && vM.x < uGlass.z && vM.y > uGlass.y && vM.y < uGlass.w) {
          vec2 g = (vM - uGlass.xy) / (uGlass.zw - uGlass.xy) * 2.0 - 1.0;
          float e = smoothstep(0.35, 0.95, max(abs(g.x), abs(g.y)));
          mr = mix(uGlassC, uGlassE, e);
        } else if (vM.x < uBack.z && vM.y < uBack.w) {
          // back wall: blood slides off / thins out in the "clean patches" (readability)
          mr = mix(uBackClean, 1.0, edcCleanMask(vM - uBack.xy));
        }
        gl_FragColor = vec4(mr, mr * uDry, 1.0, 1.0);
      }`,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const fsGeo = new THREE.PlaneGeometry(2, 2);
  const decayMesh = new THREE.Mesh(fsGeo, decayMat);
  decayMesh.frustumCulled = false;

  // copy pass (resolution change keeps the stains)
  const copyMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }',
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const copyMesh = new THREE.Mesh(fsGeo, copyMat);
  copyMesh.frustumCulled = false;

  const passScene = new THREE.Scene();
  passScene.add(stampMesh, decayMesh, copyMesh);
  const passCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const clearColor = new THREE.Color(0, 0, 0);
  const prevClear = new THREE.Color();

  function renderPass(mesh, clear) {
    stampMesh.visible = mesh === stampMesh; decayMesh.visible = mesh === decayMesh; copyMesh.visible = mesh === copyMesh;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    if (clear) {
      renderer.getClearColor(prevClear); const pa = renderer.getClearAlpha();
      renderer.setClearColor(clearColor, 0); renderer.clear(true, false, false);
      renderer.setClearColor(prevClear, pa);
    }
    renderer.render(passScene, passCam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.autoUpdate = prevShadow;
  }

  // ---------------- overlay materials ----------------
  const shared = {
    uBloodMap: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 640) },
    uBump: { value: 1.7 },
    uDec: { value: 1 / ENC },
    uAtlasM: { value: new THREE.Vector2(AW, AH) }, uBackUV: { value: new THREE.Vector2((2 * HW) / AW, (2 * HH) / AH) },
    uBackCap: { value: 0 }, // 0..1: how hard the clean patches are held back (grows with back-wall load)
  };
  function patch(material, glass) {
    material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared, bloodUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aBloodUv; attribute vec3 aBT; attribute vec3 aBB; attribute vec2 aLocal;\nvarying vec2 vBloodUv; varying vec3 vBT; varying vec3 vBB; varying vec2 vLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBloodUv = aBloodUv; vLocal = aLocal; vBT = normalize(normalMatrix * aBT); vBB = normalize(normalMatrix * aBB);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uBloodMap; uniform vec2 uTexel; uniform float uBump; uniform float uDec;
          uniform vec2 uAtlasM; uniform vec2 uBackUV; uniform float uBackCap;
          ${glass ? '' : CLEAN_MASK_GLSL}
          uniform vec3 uBloodFresh; uniform vec3 uBloodDeep; uniform vec3 uBloodDry; uniform vec3 uBloodHi;
          varying vec2 vBloodUv; varying vec3 vBT; varying vec3 vBB; varying vec2 vLocal;
          float bloodH(vec2 uv) { float d = texture2D(uBloodMap, uv).r * uDec; return 1.0 - exp(-d * 2.2); }
          float gBloodA; float gBloodWet; float gBloodCov;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec4 bm = texture2D(uBloodMap, vBloodUv) * uDec;
            float dens = max(bm.r, 0.0);
            float wet = clamp(bm.g / (dens + 1e-3), 0.0, 1.0);
            float cov = 1.0 - exp(-dens * 2.2);
            // feathered edge
            float a = smoothstep(0.03, 0.62, cov);
            // thin rim lighter + translucent, thick centre darker (liquid); dried = dull, dark, low contrast
            float thick = smoothstep(0.35, 0.97, cov);
            vec3 fresh = mix(uBloodFresh * 1.12, uBloodFresh * 0.6 + uBloodDeep * 0.4, thick);
            vec3 dry = uBloodDry * mix(1.0, 0.72, thick);
            vec3 col = mix(dry, fresh, smoothstep(0.0, 0.85, wet));
            // dried stains let the tiles show through: the back wall never becomes a solid red sheet
            a *= mix(0.68, 1.0, smoothstep(0.1, 0.7, wet));
            ${glass ? `
            // the glass is the player's window: low ceiling in the middle, a dirtier frame
            vec2 g = abs(vLocal * 2.0 - 1.0);
            float edge = smoothstep(0.30, 0.95, max(g.x, g.y));
            float cap = mix(0.2, 0.6, edge);
            a = min(a * 0.85, cap);
            col = mix(col * 0.55, col, wet * 0.4);` : `
            // back wall: the pastel tiles always show a little, and the clean patches a lot once
            // the wall is loaded (never a solid red sheet behind the hazards)
            if (vBloodUv.x < uBackUV.x && vBloodUv.y < uBackUV.y) {
              float cm = edcCleanMask(vBloodUv * uAtlasM);
              a = min(a, mix(mix(0.9, 0.24, uBackCap), 0.88, cm));
            }`}
            gBloodA = a; gBloodWet = wet; gBloodCov = cov;
            diffuseColor = vec4(col, a);
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(${glass ? '0.22' : '0.7'}, ${glass ? '0.04' : '0.05'}, smoothstep(0.15, 0.8, gBloodWet) * smoothstep(0.2, 0.6, gBloodCov));`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            float hC = bloodH(vBloodUv);
            float hU = bloodH(vBloodUv + vec2(uTexel.x, 0.0));
            float hV = bloodH(vBloodUv + vec2(0.0, uTexel.y));
            vec2 gr = vec2(hU - hC, hV - hC) * uBump * (0.25 + 0.75 * gBloodWet);
            normal = normalize(normal - gr.x * vBT - gr.y * vBB);
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += uBloodFresh * 0.04 * gBloodWet * gBloodA;`);
    };
    material.customProgramCacheKey = () => (glass ? 'edc-blood-glass' : 'edc-blood-walls');
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0, transparent: true, depthWrite: false });
  patch(wallMat, false);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.0, transparent: true, depthWrite: false });
  patch(glassMat, true);

  // overlay geometry: planes slightly inside each wall; attributes carry atlas uv + tangent frame
  function planeGeo(list) {
    const pos = []; const nrm = []; const buv = []; const bt = []; const bb = []; const loc = []; const idx = [];
    for (const s of list) {
      const { surf, segA = 24, segB = 12 } = s;
      const r = REG[surf];
      for (let j = 0; j <= segB; j++) {
        for (let i = 0; i <= segA; i++) {
          const a = (i / segA) * r[2]; const b = (j / segB) * r[3];
          const p = surfToLocal(surf, a, b, 0.006);
          pos.push(p[0], p[1], p[2]);
          // the glass overlay is seen from OUTSIDE (camera side): render it facing +z
          const n = surf === SURF.GLASS ? [0, 0, 1] : NORMALS[surf]; nrm.push(n[0], n[1], n[2]);
          buv.push((r[0] + a) / AW, (r[1] + b) / AH);
          const A = AXES_A[surf]; const B = AXES_B[surf];
          bt.push(A[0], A[1], A[2]); bb.push(B[0], B[1], B[2]);
          loc.push(i / segA, j / segB);
        }
      }
      const base = (pos.length / 3) - (segA + 1) * (segB + 1);
      for (let j = 0; j < segB; j++) {
        for (let i = 0; i < segA; i++) {
          const k = base + j * (segA + 1) + i;
          const a = k; const b2 = k + 1; const c = k + segA + 2; const d = k + segA + 1;
          // wind so the face points along the inward normal
          if (FLIP[surf] && surf !== SURF.GLASS) idx.push(a, c, b2, a, d, c); else idx.push(a, b2, c, a, c, d);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aBloodUv', new THREE.Float32BufferAttribute(buv, 2));
    g.setAttribute('aBT', new THREE.Float32BufferAttribute(bt, 3));
    g.setAttribute('aBB', new THREE.Float32BufferAttribute(bb, 3));
    g.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2));
    g.setIndex(idx);
    return g;
  }
  // a/b plane coords (metres from the region origin) -> drum-local point, nudged `off` inward
  const AXES_A = [[1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 0]];
  const AXES_B = [[0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]];
  const NORMALS = [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]];
  // winding: does (A x B) point against the inward normal?
  const FLIP = NORMALS.map((n, i) => {
    const A = AXES_A[i]; const B = AXES_B[i];
    const cx = A[1] * B[2] - A[2] * B[1]; const cy = A[2] * B[0] - A[0] * B[2]; const cz = A[0] * B[1] - A[1] * B[0];
    return cx * n[0] + cy * n[1] + cz * n[2] < 0;
  });
  function surfToLocal(surf, a, b, off = 0) {
    switch (surf) {
      case SURF.BACK: return [a - HW, b - HH, -HD + off];
      case SURF.GLASS: return [a - HW, b - HH, HD - off];
      case SURF.FLOOR: return [a - HW, -HH + off, b - HD];
      case SURF.CEIL: return [a - HW, HH - off, b - HD];
      case SURF.LEFT: return [-HW + off, a - HH, b - HD];
      default: return [HW - off, a - HH, b - HD];
    }
  }

  const wallGeo = planeGeo([
    { surf: SURF.BACK, segA: 32, segB: 20 }, { surf: SURF.FLOOR, segA: 32, segB: 6 }, { surf: SURF.CEIL, segA: 32, segB: 6 },
    { surf: SURF.LEFT, segA: 20, segB: 6 }, { surf: SURF.RIGHT, segA: 20, segB: 6 },
  ]);
  const glassGeo = planeGeo([{ surf: SURF.GLASS, segA: 16, segB: 10 }]);
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.name = 'bloodWalls'; walls.renderOrder = 1; walls.receiveShadow = true; walls.frustumCulled = false;
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  glassMesh.name = 'bloodGlass'; glassMesh.renderOrder = 11; glassMesh.frustumCulled = false;
  drumGroup.add(walls, glassMesh);

  // ---------------- API ----------------
  let n = 0;
  let stampCap = 1500;
  let dirty = true; // needs a clear
  let decayAcc = 0;
  let glassLoad = 0; // m^2-ish of glass coverage (CPU estimate, decays with the glass clearing)
  const GLASS_CAP = (2 * HW * 2 * HH) * 0.1; // hard cap: ~10 % "effective" coverage
  let backLoad = 0; // same estimate for the back wall (drives how hard the clean patches hold back)
  const BACK_REF = (2 * HW * 2 * HH) * 2.2; // ~ the stamp area of a heavily painted wall (load 1)
  let dropped = 0;

  function setResolution(w) {
    w = Math.max(256, Math.min(4096, Math.round(w)));
    if (rt && w === texW) return;
    const old = rt;
    rt = makeRT(w);
    texW = w; texH = rt.height;
    shared.uBloodMap.value = rt.texture;
    shared.uTexel.value.set(1 / texW, 1 / texH);
    renderPass(null, true);
    if (old) {
      copyMat.uniforms.tSrc.value = old.texture;
      renderPass(copyMesh, false);
      copyMat.uniforms.tSrc.value = null;
      old.dispose();
    }
    dirty = false;
  }

  /**
   * Queue one stamp. surf: SURF.*, (a,b) plane coords in metres, (da,db) unit direction in the
   * plane, halfLen/halfWidth metres, amount (density), kind 0..4, wet 0..1.
   * Returns false when dropped (batch full / glass budget).
   */
  function stamp(surf, a, b, da, db, halfLen, halfWidth, amount, kind, wet = 1, seed = Math.random()) {
    if (n >= stampCap) { dropped++; return false; }
    if (surf === SURF.GLASS) {
      const area = halfLen * halfWidth * 4 * Math.min(1.5, amount);
      if (glassLoad + area > GLASS_CAP && kind !== 1) { dropped++; return false; }
      glassLoad += area * 0.6;
    } else if (surf === SURF.BACK && kind !== 3) {
      backLoad += halfLen * halfWidth * 4 * Math.min(1.5, amount);
    }
    const r = REG[surf];
    const i4 = n * 4;
    aA[i4] = r[0] + a; aA[i4 + 1] = r[1] + b; aA[i4 + 2] = surf; aA[i4 + 3] = seed;
    aB[i4] = da; aB[i4 + 1] = db; aB[i4 + 2] = halfLen; aB[i4 + 3] = halfWidth;
    aC[i4] = amount; aC[i4 + 1] = kind; aC[i4 + 2] = wet; aC[i4 + 3] = 0;
    n++;
    return true;
  }

  function flush(dt) {
    if (!rt) return;
    if (dirty) { renderPass(null, true); dirty = false; }
    if (n > 0) {
      quad.instanceCount = n;
      for (let k = 0; k < 3; k++) { const at = ATTS[k]; at.clearUpdateRanges(); at.addUpdateRange(0, n * 4); at.needsUpdate = true; }
      renderPass(stampMesh, false);
      n = 0;
    }
    shared.uBackCap.value = smoothstep01((backLoad / BACK_REF - 0.25) / 0.6);
    decayAcc += dt;
    if (decayAcc >= (FLOAT_OK ? 0.1 : 1.0)) { // 8-bit: bigger, rarer steps so small factors still move a texel
      const t = decayAcc; decayAcc = 0;
      // drying: wet -> dry over ~25 s; glass: centre clears in ~35 s, edges ~140 s; faster when over budget
      const over = glassLoad > GLASS_CAP * 0.8 ? 2.5 : 1;
      decayUniforms.uDry.value = Math.exp(-t / 22);
      decayUniforms.uGlassC.value = Math.exp((-t / 24) * over);
      decayUniforms.uGlassE.value = Math.exp((-t / 110) * over);
      glassLoad *= Math.exp((-t / 40) * over);
      // back wall: clean patches shed their blood in ~12 s; the load estimate relaxes over ~90 s
      decayUniforms.uBackClean.value = Math.exp(-t / 12);
      backLoad *= Math.exp(-t / 90);
      renderPass(decayMesh, false);
    }
  }

  return {
    SURF, REG, AW, AH, NORMALS, AXES_A, AXES_B, surfToLocal,
    stamp, flush, setResolution,
    clear() { dirty = true; glassLoad = 0; backLoad = 0; shared.uBackCap.value = 0; n = 0; },
    setStampCap(c) { stampCap = Math.max(64, Math.min(CAP, c | 0)); },
    get pending() { return n; },
    get glassLoad() { return glassLoad / GLASS_CAP; },
    get backLoad() { return backLoad / BACK_REF; },
    get backCap() { return shared.uBackCap.value; },
    get dropped() { return dropped; },
    get resolution() { return [texW, texH]; },
    get texture() { return rt ? rt.texture : null; },
    get floatTargets() { return FLOAT_OK; },
    dispose() {
      drumGroup.remove(walls, glassMesh);
      wallGeo.dispose(); glassGeo.dispose(); wallMat.dispose(); glassMat.dispose();
      quad.dispose(); stampMat.dispose(); decayMat.dispose(); copyMat.dispose(); fsGeo.dispose();
      if (rt) rt.dispose();
    },
  };
}
