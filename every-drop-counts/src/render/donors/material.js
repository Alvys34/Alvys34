/**
 * Donor shader (ART owns): MeshStandardMaterial + onBeforeCompile. Per-instance data (all
 * InstancedBufferAttributes on each role geometry):
 *   aColA = (cloth, skin, trim, feet)   aColB = (band, hair, arm, leg)   aColC = (lower, accent, hairStyle, pattern)
 *     colours are 0xRRGGBB packed in a float (exact up to 2^24); a NEGATIVE colour = the shared
 *     blood tint uniform (Thin-Blood wristband).
 *   aState = (damage [+2 if the wound is open], faceCell, drained, seed)
 * Per-vertex: aSlot (colour slot), aFace (face-atlas u, v, mask), aStyle (hair only).
 * Shadows: hair uses a matching customDepthMaterial so unused hairstyles cast nothing.
 */
const COMMON = /* glsl */`
uniform vec3 uBlood;
attribute float aSlot;
attribute vec3 aFace;
attribute vec4 aColA; attribute vec4 aColB; attribute vec4 aColC; attribute vec4 aState;
varying vec3 vDCol; varying vec3 vObj; varying vec3 vFace; varying vec4 vState; varying float vSlot; varying float vSkin; varying float vPattern;
vec3 edcHex(float h) {
  if (h < 0.0) return uBlood;
  vec3 c = vec3(floor(h / 65536.0), mod(floor(h / 256.0), 256.0), mod(h, 256.0)) / 255.0;
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;

const VERT_MAIN = /* glsl */`
  #include <begin_vertex>
  {
    int s = int(aSlot + 0.5);
    float hx = aColA.x; float sk = 0.0;
    if (s == 1) { hx = aColA.y; sk = 1.0; }
    else if (s == 2) hx = aColA.z;
    else if (s == 3) hx = aColA.w;
    else if (s == 4) hx = aColB.x;
    else if (s == 5) hx = aColB.y;
    else if (s == 6) { hx = aColB.z; sk = aColB.z == aColA.y ? 1.0 : 0.0; }
    else if (s == 7) { hx = aColB.w; sk = aColB.w == aColA.y ? 1.0 : 0.0; }
    else if (s == 8) hx = aColC.x;
    else if (s == 9) hx = aColC.y;
    vDCol = edcHex(hx);
    vSkin = sk; vObj = position; vFace = aFace; vState = aState; vSlot = float(s);
    vPattern = (s == 0 || s == 8) ? aColC.w : 0.0;
    #ifdef EDC_HAIR
      if (abs(aStyle - aColC.z) > 0.5) transformed = vec3(0.0);
    #endif
  }
`;

const FRAG_PARS = /* glsl */`
uniform vec3 uBlood;
uniform sampler2D uFaceMap;
varying vec3 vDCol; varying vec3 vObj; varying vec3 vFace; varying vec4 vState; varying float vSlot; varying float vSkin; varying float vPattern;
float edcHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float edcNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(edcHash(i), edcHash(i + vec3(1,0,0)), f.x), mix(edcHash(i + vec3(0,1,0)), edcHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(edcHash(i + vec3(0,0,1)), edcHash(i + vec3(1,0,1)), f.x), mix(edcHash(i + vec3(0,1,1)), edcHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

const FRAG_MAIN = /* glsl */`
  {
    vec3 col = vDCol;
    float dead = step(4.5, vState.y);
    // drained / dead skin goes pale and cool
    if (vSkin > 0.5) {
      col = mix(col, vec3(0.62, 0.66, 0.70) * (0.55 + 0.45 * max(col.r, max(col.g, col.b))), clamp(vState.z * 0.6 + dead * 0.18, 0.0, 0.8));
    }
    // hospital-gown print: tiny lighter dots
    if (vPattern > 0.5) {
      vec2 q = vObj.xy * 34.0 + vec2(vObj.z * 21.0, 0.0);
      vec2 cell = fract(q + vec2(0.5 * mod(floor(q.y), 2.0), 0.0)) - 0.5;
      float d = smoothstep(0.2, 0.14, length(cell));
      col = mix(col, min(vec3(1.0), col * 1.22 + 0.05), d * 0.55);
    }
    // painted face
    if (vFace.z > 0.0) {
      float cell = vState.y;
      vec2 fuv = clamp(vFace.xy, 0.01, 0.99);
      vec2 auv = vec2((mod(cell, 3.0) + fuv.x) / 3.0, 1.0 - (floor(cell / 3.0) + 1.0 - fuv.y) / 2.0);
      vec4 f = texture2D(uFaceMap, auv);
      col = mix(col, f.rgb, f.a * vFace.z);
    }
    // wounds: bruise patches grow with damage, open wounds get a glossy blood core
    float dmgRaw = vState.x;
    float opened = step(1.5, dmgRaw);
    float dmg = dmgRaw - 2.0 * opened;
    if (dmg > 0.02) {
      float n = edcNoise(vObj * 15.0 + vState.w) * 0.65 + edcNoise(vObj * 41.0 + vState.w * 1.7) * 0.35;
      float th = 1.0 - dmg * 0.8;
      float bruise = smoothstep(th, th + 0.07, n);
      col = mix(col, col * vec3(0.42, 0.36, 0.48), bruise * 0.85);
      float core = smoothstep(th + 0.1, th + 0.16, n) * opened;
      col = mix(col, uBlood * 0.85, core);
    }
    // dead: a touch desaturated
    col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), dead * 0.3);
    diffuseColor.rgb = col;
  }
`;

export function createDonorMaterials(THREE, faceTexture) {
  const uniforms = { uBlood: { value: new THREE.Color(0xb4001c) }, uFaceMap: { value: faceTexture } };
  const make = (hair) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.68, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${COMMON}${hair ? 'attribute float aStyle;\n' : ''}`)
        .replace('#include <begin_vertex>', VERT_MAIN);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_MAIN}`);
      if (hair) sh.vertexShader = `#define EDC_HAIR\n${sh.vertexShader}`;
    };
    m.customProgramCacheKey = () => (hair ? 'edc-donor-hair' : 'edc-donor');
    return m;
  };
  const body = make(false);
  const hair = make(true);
  // hair shadow: collapse unused styles in the depth pass too
  const hairDepth = new THREE.MeshDepthMaterial();
  hairDepth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStyle;\nattribute vec4 aColC;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (abs(aStyle - aColC.z) > 0.5) transformed = vec3(0.0);');
  };
  hairDepth.customProgramCacheKey = () => 'edc-hair-depth';
  return { body, hair, hairDepth, uniforms };
}
