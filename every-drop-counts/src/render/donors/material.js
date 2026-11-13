/**
 * Donor shader (ART owns): MeshStandardMaterial + onBeforeCompile. Per-instance data (all
 * InstancedBufferAttributes on each role geometry):
 *   aColA = (cloth, skin, trim, feet)   aColB = (band, hair, arm, leg)   aColC = (lower, accent, hem, pattern)
 *     colours are 0xRRGGBB packed in a float (exact up to 2^24); a NEGATIVE colour = the shared
 *     blood colour (VFX bloodColors.fresh — Thin-Blood wristband).
 *   aState = (damage [+2 if the wound is open], faceCell, drained, seed)
 * Per-vertex: aSlot (colour slot), aFace (face-atlas u, v, mask).
 *
 * Readability: a soft rim light (fresnel, warm white) makes LIVE donors pop against dark blood;
 * the inverted-hull outline (createOutlineMaterial) separates them from pale tiles. Dead / drained
 * donors lose most of the rim and get darker + desaturated, so corpses read as "done".
 */
import { bloodColors } from '../blood/palette.js';

export const FACE_SCALE = 1.16; // face features drawn this much larger than the atlas layout

const COMMON = /* glsl */`
uniform vec3 uBlood;
attribute float aSlot;
attribute vec3 aFace;
attribute vec4 aColA; attribute vec4 aColB; attribute vec4 aColC; attribute vec4 aState;
varying vec3 vDCol; varying vec3 vObj; varying vec3 vFace; varying vec4 vState; varying float vSkin; varying float vPattern;
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
    else if (s == 10) hx = aColC.z;
    vDCol = edcHex(hx);
    vSkin = sk; vObj = position; vFace = aFace; vState = aState;
    vPattern = (s == 0 || s == 8) ? aColC.w : 0.0;
  }
`;

const FRAG_PARS = /* glsl */`
uniform vec3 uBlood;
uniform sampler2D uFaceMap;
varying vec3 vDCol; varying vec3 vObj; varying vec3 vFace; varying vec4 vState; varying float vSkin; varying float vPattern;
float edcHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float edcNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(edcHash(i), edcHash(i + vec3(1,0,0)), f.x), mix(edcHash(i + vec3(0,1,0)), edcHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(edcHash(i + vec3(0,0,1)), edcHash(i + vec3(1,0,1)), f.x), mix(edcHash(i + vec3(0,1,1)), edcHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float edcDead() { return step(4.5, vState.y + 0.01); }
`;

const FRAG_MAIN = /* glsl */`
  {
    vec3 col = vDCol;
    float dead = edcDead();
    float drained = clamp(vState.z, 0.0, 1.0);
    // drained / dead skin goes pale and cool
    if (vSkin > 0.5) {
      col = mix(col, vec3(0.62, 0.66, 0.70) * (0.55 + 0.45 * max(col.r, max(col.g, col.b))), clamp(drained * 0.6 + dead * 0.18, 0.0, 0.8));
    }
    // hospital-gown print: tiny lighter dots
    if (vPattern > 0.5) {
      vec2 q = vObj.xy * 34.0 + vec2(vObj.z * 21.0, 0.0);
      vec2 cell = fract(q + vec2(0.5 * mod(floor(q.y), 2.0), 0.0)) - 0.5;
      float d = smoothstep(0.2, 0.14, length(cell));
      col = mix(col, min(vec3(1.0), col * 1.22 + 0.05), d * 0.55);
    }
    // painted face (varyings are not exact integers: round the cell before splitting row / column)
    if (vFace.z > 0.0) {
      float cell = floor(vState.y + 0.5);
      float row = floor((cell + 0.5) / 3.0);
      float colm = cell - row * 3.0;
      vec2 fuv = clamp((vFace.xy - vec2(0.5, 0.47)) / ${FACE_SCALE.toFixed(3)} + vec2(0.5, 0.5), 0.01, 0.99);
      vec2 auv = vec2((colm + fuv.x) / 3.0, 1.0 - (row + 1.0 - fuv.y) / 2.0);
      vec4 f = texture2D(uFaceMap, auv);
      col = mix(col, f.rgb, f.a * vFace.z);
    }
    // wounds: bruise patches grow with damage, open wounds get a glossy blood core
    float dmgRaw = vState.x;
    float opened = step(1.5, dmgRaw);
    float dmg = dmgRaw - 2.0 * opened;
    if (dmg > 0.02) {
      float n = edcNoise(vObj * 15.0 + vState.w) * 0.65 + edcNoise(vObj * 41.0 + vState.w * 1.7) * 0.35;
      float tb = 1.0 - dmg * 0.62;
      float bruise = smoothstep(tb, tb + 0.06, n);
      col = mix(col, col * vec3(0.46, 0.4, 0.52), bruise * 0.8);
      float tc = 1.04 - dmg * 0.4;
      float core = smoothstep(tc, tc + 0.05, n) * opened;
      col = mix(col, uBlood * mix(0.55, 0.9, smoothstep(tc + 0.05, tc + 0.2, n)), core);
    }
    // corpses: desaturated and a little darker; the living stay saturated
    float spent = max(dead, drained * 0.6);
    col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), spent * 0.45);
    col *= 1.0 - 0.18 * spent;
    diffuseColor.rgb = col;
  }
`;

const RIM = /* glsl */`
  #include <emissivemap_fragment>
  {
    vec3 vdir = normalize(vViewPosition);
    float rim = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 2.6);
    float alive = 1.0 - max(edcDead(), clamp(vState.z, 0.0, 1.0) * 0.7);
    totalEmissiveRadiance += vec3(1.0, 0.96, 0.9) * rim * (0.06 + 0.32 * alive);
  }
`;

export function createDonorMaterials(THREE, faceTexture) {
  const uniforms = { uBlood: { value: bloodColors.fresh }, uFaceMap: { value: faceTexture } };
  const body = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  body.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON}`)
      .replace('#include <begin_vertex>', VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_MAIN}`)
      .replace('#include <emissivemap_fragment>', RIM);
  };
  body.customProgramCacheKey = () => 'edc-donor-2';
  return { body, outline: createOutlineMaterial(THREE), uniforms };
}

/**
 * Inverted-hull outline for instanced donor parts: back faces pushed out along the normal by a
 * constant object-space width, flat dark ink. Shares geometry + instanceMatrix with the body mesh.
 */
export function createOutlineMaterial(THREE, width = 0.012) {
  const m = new THREE.MeshBasicMaterial({ color: 0x1b2624, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWidth = { value: width };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWidth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uWidth;');
  };
  m.customProgramCacheKey = () => 'edc-donor-outline';
  return m;
}
