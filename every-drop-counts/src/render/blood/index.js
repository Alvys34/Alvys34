/**
 * Blood (VFX owns). Purely visual: the sim already credited the litres. Pieces:
 *
 *  - droplets.js  instanced particles (drops + mist/bubbles) simulated in the drum's ROTATING frame
 *                 (same gravity / centrifugal / Euler / Coriolis as the sim), analytic collisions
 *                 with the drum box and the pool surface (incl. its visual waves).
 *  - atlas.js     persistent blood maps for back wall, side walls and front glass (one HalfFloat RT,
 *                 one batched stamp draw per frame, drying + glass-clearing pass).
 *  - runners.js   drips that crawl along walls/glass under the current gravity -> curved streaks;
 *                 on down-facing surfaces they let go (ceiling drips).
 *
 * Sources: state.blood.bleeders (arterial spurts that follow the moving stump, heartbeat-pulsed while
 * the donor lives), bus `blood:spurt` (burst), `limb:sever`, `donor:death`, `prop:explode` (fat
 * bursts), `hazard:contact` (saw spray flung tangentially off the blade, grinder spray, spike
 * spatter), `impact`, `slam` (droplets kicked + wet ceiling shakes loose). Marks: every landing drop
 * stamps a splat (elongated by impact angle, satellites at speed, maybe a runner), mist leaves
 * speckle, bloody bodies sliding on walls smear, the pool leaves tide films + bathtub rings, walls
 * the pool wetted drip once they rotate up.
 *
 * createBlood(ctx) -> { update(dt, state, alpha), onLevel(), setQuality(q), emitLocal(...), stats(), dispose() }
 */
import { createBloodAtlas, SURF } from './atlas.js';
import { createParticles, KIND_DROP, KIND_MIST } from './droplets.js';
import { createRunners } from './runners.js';
import { TUNABLES } from '../../core/tunables.js';

const DROP_CAP = 6000;
const MIST_CAP = 3000;
const RUN_CAP = 360;
const MASK = 4095;

export function createBlood(ctx) {
  const { bus } = ctx;
  const HW = TUNABLES.drum.width / 2; const HH = TUNABLES.drum.height / 2; const HD = TUNABLES.drum.depth / 2;
  const dims = { HW, HH, HD };
  const atlas = createBloodAtlas(ctx, dims);
  const drops = createParticles(ctx, { cap: DROP_CAP, mist: false, renderOrder: 0 });
  const mist = createParticles(ctx, { cap: MIST_CAP, mist: true, renderOrder: 4 });
  const runners = createRunners(atlas, dims, RUN_CAP);

  let q = ctx.quality;
  let emitScale = 1;
  let loadScale = 1;
  let frame = 0;
  let time = 0;

  let rs = 12345;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };

  // ---------------- event queue (no per-frame allocation) ----------------
  const EV = 96; const EVW = 8;
  const ev = new Float32Array(EV * EVW); let evN = 0;
  const T_BURST = 1; const T_SEVER = 2; const T_DEATH = 3; const T_EXPLODE = 4; const T_SAW = 5; const T_GRIND = 6; const T_SPIKE = 7; const T_IMPACT = 8; const T_ONSET = 9;
  function pushEv(type, pos, a = 0, d = null) {
    if (!pos || evN >= EV) return;
    const o = evN * EVW;
    ev[o] = type; ev[o + 1] = pos[0]; ev[o + 2] = pos[1]; ev[o + 3] = pos[2] || 0; ev[o + 4] = a;
    ev[o + 5] = d ? d[0] : 0; ev[o + 6] = d ? d[1] : 0; ev[o + 7] = d ? (d[2] || 0) : 0;
    evN++;
  }
  let slamPending = false;
  const offs = [
    bus.on('blood:spurt', (p) => { if (p.burst) pushEv(T_BURST, p.pos, p.liters || 0.1, p.dir); else pushEv(T_ONSET, p.pos, p.rate || 0.1); }),
    bus.on('limb:sever', (p) => pushEv(T_SEVER, p.pos, 1)),
    bus.on('donor:death', (p) => { if (p.cause !== 'drown' && p.cause !== 'bleedout') pushEv(T_DEATH, p.pos, 1); }),
    bus.on('prop:explode', (p) => pushEv(T_EXPLODE, p.pos, 1)),
    bus.on('hazard:contact', (p) => {
      const h = p.hazard;
      if (h === 'saw' || h === 'railSaw' || h === 'rail-saw') pushEv(T_SAW, p.pos, p.intensity ?? 0.6);
      else if (h === 'grinder') pushEv(T_GRIND, p.pos, p.intensity ?? 0.6);
      else if (h === 'spike') pushEv(T_SPIKE, p.pos, p.intensity ?? 0.5);
      else pushEv(T_SPIKE, p.pos, 0.6);
    }),
    bus.on('impact', (p) => { if (p.kind === 'flesh' && p.speed > 9) pushEv(T_IMPACT, p.pos, p.speed); }),
    bus.on('slam', () => { slamPending = true; }),
  ];

  // ---------------- per-part memory (keyed by uid) ----------------
  const prevX = new Float32Array(MASK + 1); const prevY = new Float32Array(MASK + 1); const prevZ = new Float32Array(MASK + 1);
  const prevFrame = new Int32Array(MASK + 1).fill(-10);
  const smearAcc = new Float32Array(MASK + 1);
  const byUid = new Array(MASK + 1).fill(null);

  // ---------------- wetness memory for drips / tide ----------------
  // perimeter cells (1 m) on floor, right, ceiling, left: centre (x,y), inward normal, surf, a-coord
  const PC = []; // built once
  for (let i = 0; i < 2 * HW; i++) PC.push([-HW + i + 0.5, -HH, 0, 1, SURF.FLOOR, i + 0.5]);
  for (let i = 0; i < 2 * HH; i++) PC.push([HW, -HH + i + 0.5, -1, 0, SURF.RIGHT, i + 0.5]);
  for (let i = 0; i < 2 * HW; i++) PC.push([-HW + i + 0.5, HH, 0, -1, SURF.CEIL, i + 0.5]);
  for (let i = 0; i < 2 * HH; i++) PC.push([-HW, -HH + i + 0.5, 1, 0, SURF.LEFT, i + 0.5]);
  const NP = PC.length;
  const pcX = new Float32Array(NP); const pcY = new Float32Array(NP); const pcNX = new Float32Array(NP); const pcNY = new Float32Array(NP);
  const pcS = new Uint8Array(NP); const pcA = new Float32Array(NP); const wetP = new Float32Array(NP);
  PC.forEach((c, i) => { pcX[i] = c[0]; pcY[i] = c[1]; pcNX[i] = c[2]; pcNY[i] = c[3]; pcS[i] = c[4]; pcA[i] = c[5]; });
  const GW = 2 * HW; const GH = 2 * HH; // back/glass grid, 1 m cells
  const wetG = new Float32Array(GW * GH);
  let tideAcc = 0;

  // ---------------- particle env + hooks ----------------
  const env = {
    gx: 0, gy: 0, w2: 0, al: 0, cph: 1, sph: 0, HW, HH, HD, ux: 0, uy: 1, c: 1, s: 0,
    level: -1e9, wave: null, waveR: 1, waveInvDx: 1, waveN: 2, waveOn: false,
  };
  const runEnv = { g: 13, ux: 0, uy: 1, w2: 0, t: 0 };

  function planeOf(surf, x, y, z, out) {
    switch (surf) {
      case SURF.BACK: case SURF.GLASS: out[0] = x + HW; out[1] = y + HH; break;
      case SURF.FLOOR: case SURF.CEIL: out[0] = x + HW; out[1] = z + HD; break;
      default: out[0] = y + HH; out[1] = z + HD;
    }
    return out;
  }
  const ab = [0, 0];

  const hooks = {
    onHit(surf, x, y, z, vx, vy, vz, size, kind) {
      let va; let vb; let vn;
      switch (surf) {
        case SURF.BACK: va = vx; vb = vy; vn = -vz; break;
        case SURF.GLASS: va = vx; vb = vy; vn = vz; break;
        case SURF.FLOOR: va = vx; vb = vz; vn = -vy; break;
        case SURF.CEIL: va = vx; vb = vz; vn = vy; break;
        case SURF.LEFT: va = vy; vb = vz; vn = -vx; break;
        default: va = vy; vb = vz; vn = vx;
      }
      planeOf(surf, x, y, z, ab);
      const a = ab[0]; const b = ab[1];
      const vt = Math.hypot(va, vb);
      const speed = Math.hypot(vt, vn);
      const da = vt > 0.01 ? va / vt : 1; const db = vt > 0.01 ? vb / vt : 0;
      if (kind !== KIND_DROP) {
        if (rnd() < 0.4) atlas.stamp(surf, a, b, da, db, size * 0.9, size * 0.7, 0.75, 4, 1, rnd());
        return;
      }
      const e = 1 + Math.min(2.6, (vt / (Math.abs(vn) + 1.5)) * 0.9);
      const R = size * (2.3 + Math.min(2.4, speed * 0.17));
      const se = Math.sqrt(e);
      atlas.stamp(surf, a, b, da, db, R * se, R / se, 1.15, 0, 1, rnd());
      if (speed > 4.5 && size > 0.035) {
        const ns = Math.min(6, Math.floor(rnd() * speed * 0.55));
        for (let k = 0; k < ns; k++) {
          const fwd = rnd() < 0.65;
          const ang = fwd ? (rnd() - 0.5) * 0.9 : rnd() * Math.PI * 2;
          const ca = Math.cos(ang); const sa = Math.sin(ang);
          const dA = da * ca - db * sa; const dB = da * sa + db * ca;
          const dist = R * (1.15 + rnd() * 2.2) * (fwd ? se : 1);
          const r2 = R * (0.09 + rnd() * 0.22);
          atlas.stamp(surf, a + dA * dist, b + dB * dist, dA, dB, r2 * (fwd ? 1.6 : 1), r2, 1.2, 4, 1, rnd());
        }
      }
      if (size > 0.045 && rnd() < Math.min(0.55, size * 5)) runners.spawn(surf, a, b, size * 7 * (0.5 + rnd()));
      if (speed > 7 && size > 0.06 && rnd() < 0.5) {
        // crown splash: a couple of fine droplets bounce back off the wall
        for (let k = 0; k < 2; k++) {
          mist.spawn(x, y, z, -vx * 0.15 + (rnd() - 0.5) * 2, -vy * 0.15 + (rnd() - 0.5) * 2, -vz * 0.15 + (rnd() - 0.5) * 2, size * 0.7, 0.5, KIND_MIST);
        }
      }
    },
    onPool(xw, size, speed, kind) {
      const fx = ctx.poolFx;
      if (!fx) return;
      fx.impulse(xw, size * speed * (kind === KIND_DROP ? 0.06 : 0.01));
      if (kind === KIND_DROP && size > 0.05 && speed > 6 && rnd() < 0.2) {
        const c = env.c; const s = env.s; const yw = env.level + 0.05;
        const lx = c * xw + s * yw; const ly = -s * xw + c * yw;
        const up = 1.5 + rnd() * 2.5;
        drops.spawn(lx, ly, (rnd() - 0.5) * 2 * HD * 0.9, s * up + (rnd() - 0.5), c * up, 0, size * 0.6, 2, KIND_DROP);
      }
    },
    onPop(xw) {
      const fx = ctx.poolFx;
      if (fx) fx.addFoam(xw, 0.035);
    },
  };

  // ---------------- emitters ----------------
  function emitLocal(x, y, z, vx, vy, vz, size, life, kind, toMist) {
    if (toMist || kind !== KIND_DROP) return mist.spawn(x, y, z, vx, vy, vz, size, life, kind);
    return drops.spawn(x, y, z, vx, vy, vz, size, life, kind);
  }

  /** Spray n drops from (x,y,z): random sphere blended toward dir by bias, speed in [s0,s1]. */
  function spray(x, y, z, n, s0, s1, dx, dy, dz, bias, size0, size1, mistFrac, zBias = -0.18) {
    n = Math.round(n * emitScale);
    for (let k = 0; k < n; k++) {
      const u = rnd() * 2 - 1; const a = rnd() * Math.PI * 2; const r = Math.sqrt(1 - u * u);
      let ex = r * Math.cos(a) * (1 - bias) + dx * bias;
      let ey = r * Math.sin(a) * (1 - bias) + dy * bias;
      let ez = u * (1 - bias) * 0.8 + dz * bias + zBias;
      const l = Math.hypot(ex, ey, ez) || 1; ex /= l; ey /= l; ez /= l;
      const sp = s0 + (s1 - s0) * rnd() * rnd();
      const sz = size0 + (size1 - size0) * rnd() * rnd();
      drops.spawn(x, y, z, ex * sp, ey * sp, ez * sp, sz, 6, KIND_DROP);
    }
    const nm = Math.round(n * mistFrac);
    for (let k = 0; k < nm; k++) {
      const u = rnd() * 2 - 1; const a = rnd() * Math.PI * 2; const r = Math.sqrt(1 - u * u);
      const sp = (s0 + (s1 - s0) * rnd()) * 1.25;
      mist.spawn(x, y, z, (r * Math.cos(a) * 0.7 + dx * 0.3) * sp, (r * Math.sin(a) * 0.7 + dy * 0.3) * sp, (u * 0.7 + dz * 0.3) * sp,
        0.05 + rnd() * 0.09, 0.45 + rnd() * 0.7, KIND_MIST);
    }
  }

  function sawSpray(state, x, y, z, intensity) {
    let best = null; let bd = 1e9;
    for (const h of state.hazards) {
      const v = h.view;
      if (!v || (v.kind !== 'saw' && v.kind !== 'railSaw') || v.x == null) continue;
      const d2 = (x - v.x) ** 2 + (y - v.y) ** 2;
      if (d2 < bd) { bd = d2; best = v; }
    }
    if (!best) { spray(x, y, z, 10, 2, 6, 0, 0, 0, 0, 0.03, 0.08, 0.6); return; }
    const ddx = x - best.x; const ddy = y - best.y; const dist = Math.sqrt(bd) || 1;
    const ox = ddx / dist; const oy = ddy / dist;
    const dir = best.dir || 1;
    const tx = -oy * dir; const ty = ox * dir;
    const r = best.radius || 1.1;
    const ex = best.x + ox * r; const ey = best.y + oy * r; // the rim where it bites
    const n = Math.round((7 + 16 * intensity) * emitScale);
    for (let k = 0; k < n; k++) {
      const sp = 6 + rnd() * 9;
      const j = (rnd() - 0.5) * 0.5;
      const vx = (tx + ox * (0.25 + j)) * sp; const vy = (ty + oy * (0.25 - j)) * sp;
      drops.spawn(ex + (rnd() - 0.5) * 0.2, ey + (rnd() - 0.5) * 0.2, z + (rnd() - 0.5) * 0.3, vx, vy, (rnd() - 0.5) * 3, 0.022 + rnd() * rnd() * 0.07, 5, KIND_DROP);
    }
    for (let k = 0; k < n * 1.2; k++) {
      const sp = 7 + rnd() * 10;
      mist.spawn(ex, ey, z + (rnd() - 0.5) * 0.4, (tx + (rnd() - 0.5) * 0.7) * sp, (ty + (rnd() - 0.5) * 0.7) * sp, (rnd() - 0.5) * 4,
        0.04 + rnd() * 0.07, 0.35 + rnd() * 0.5, KIND_MIST);
    }
  }

  function processEvents(state) {
    const ux = state.drum.ux; const uy = state.drum.uy;
    for (let k = 0; k < evN; k++) {
      const o = k * EVW;
      const type = ev[o]; const x = ev[o + 1]; const y = ev[o + 2]; const z = ev[o + 3]; const a = ev[o + 4];
      const dx = ev[o + 5]; const dy = ev[o + 6]; const dz = ev[o + 7];
      const hasDir = dx !== 0 || dy !== 0 || dz !== 0;
      switch (type) {
        case T_BURST: {
          const L = a;
          spray(x, y, z, Math.min(240, 14 + L * 420), 2, Math.min(12, 5 + L * 14), hasDir ? dx : ux, hasDir ? dy : uy, hasDir ? dz : 0, hasDir ? 0.45 : 0.25, 0.03, 0.12, 0.5);
          break;
        }
        case T_ONSET: spray(x, y, z, 6 + Math.min(14, a * 30), 1.5, 5, ux, uy, 0, 0.3, 0.03, 0.08, 0.4); break;
        case T_SEVER: spray(x, y, z, 55, 2.5, 9.5, ux, uy, 0, 0.3, 0.045, 0.14, 0.8); break;
        case T_DEATH: spray(x, y, z, 30, 1.5, 6, ux, uy, 0, 0.35, 0.04, 0.11, 0.5); break;
        case T_EXPLODE: spray(x, y, z, 320, 5, 17, 0, 0, 0, 0, 0.03, 0.13, 0.9, -0.1); break;
        case T_SAW: sawSpray(state, x, y, z, a); break;
        case T_GRIND: spray(x, y, z, 10 + 14 * a, 3, 9, ux, uy, 0, 0.6, 0.03, 0.1, 0.9); break;
        case T_SPIKE: spray(x, y, z, 5 + 8 * a, 1, 4, ux, uy, 0, 0.4, 0.03, 0.08, 0.4); break;
        case T_IMPACT: spray(x, y, z, Math.min(12, a * 0.6), 1, 3.5, ux, uy, 0, 0.5, 0.03, 0.07, 0.3); break;
        default: break;
      }
    }
    evN = 0;
  }

  function emitBleeders(state, dt) {
    const K = 620 * emitScale;
    for (const b of state.blood.bleeders) {
      const key = b.part & MASK;
      const p = byUid[key];
      const part = p && p.uid === b.part ? p : null;
      const alive = part ? part.donor.alive : false;
      let sx0 = b.x; let sy0 = b.y; let sz0 = b.z;
      if (prevFrame[key] === frame - 1) { sx0 = prevX[key]; sy0 = prevY[key]; sz0 = prevZ[key]; }
      prevX[key] = b.x; prevY[key] = b.y; prevZ[key] = b.z; prevFrame[key] = frame;
      const ph = (b.part * 0.618) % 1;
      const beat = Math.max(0, Math.sin((time * 1.45 + ph) * Math.PI * 2));
      const pulse = alive ? 0.2 + 0.8 * beat * beat * beat : 0.55;
      const want = b.rate * dt * K * pulse;
      let n = Math.floor(want); if (rnd() < want - n) n++;
      if (n > 14) n = 14;
      if (n <= 0) continue;
      const spd = alive ? Math.min(9.5, 2.4 + b.rate * 16) * (0.5 + 0.7 * pulse) : Math.min(4.5, 0.9 + b.rate * 7);
      const cone = alive ? 0.16 : 0.45;
      const pvx = part ? part.vx : 0; const pvy = part ? part.vy : 0; const pvz = part ? part.vz : 0;
      const big = Math.min(0.05, b.rate * 0.08);
      for (let k = 0; k < n; k++) {
        const f = (k + rnd()) / n;
        let ex = b.dx + (rnd() - 0.5) * 2 * cone; let ey = b.dy + (rnd() - 0.5) * 2 * cone; let ez = b.dz + (rnd() - 0.5) * 2 * cone - 0.08;
        const l = Math.hypot(ex, ey, ez) || 1; ex /= l; ey /= l; ez /= l;
        const sp = spd * (0.8 + 0.4 * rnd());
        const vx = ex * sp + pvx; const vy = ey * sp + pvy; const vz = ez * sp + pvz;
        const lead = (1 - f) * dt;
        drops.spawn(sx0 + (b.x - sx0) * f + vx * lead, sy0 + (b.y - sy0) * f + vy * lead, sz0 + (b.z - sz0) * f + vz * lead,
          vx, vy, vz, 0.028 + big + rnd() * 0.045, 6, KIND_DROP);
        if (rnd() < 0.28) {
          mist.spawn(b.x, b.y, b.z, ex * sp * 1.3 + (rnd() - 0.5) * 2 + pvx, ey * sp * 1.3 + (rnd() - 0.5) * 2 + pvy, ez * sp * 1.3 + (rnd() - 0.5) * 2,
            0.045 + rnd() * 0.06, 0.4 + rnd() * 0.5, KIND_MIST);
        }
      }
    }
  }

  function smears(state, dt) {
    for (const p of state.parts) {
      if (p.removed) continue;
      const bloody = p.wound > 0 || p.stumps.length > 0 || (!p.donor.alive && p.blood < p.bloodMax * 0.97);
      if (!bloody) continue;
      const r = (p.thick || 0.1) * 1.25 + 0.06;
      let surf = -1; let va = 0; let vb = 0;
      if (p.y + HH < r) { surf = SURF.FLOOR; va = p.vx; vb = p.vz; }
      else if (HH - p.y < r) { surf = SURF.CEIL; va = p.vx; vb = p.vz; }
      else if (p.x + HW < r) { surf = SURF.LEFT; va = p.vy; vb = p.vz; }
      else if (HW - p.x < r) { surf = SURF.RIGHT; va = p.vy; vb = p.vz; }
      else if (p.z + HD < r) { surf = SURF.BACK; va = p.vx; vb = p.vy; }
      else if (HD - p.z < r) { surf = SURF.GLASS; va = p.vx; vb = p.vy; }
      if (surf < 0) continue;
      const vt = Math.hypot(va, vb);
      if (vt < 0.7) continue;
      const key = p.uid & MASK;
      smearAcc[key] += vt * dt;
      const w = Math.max(0.06, Math.min(0.2, (p.thick || 0.1) * 1.1));
      if (smearAcc[key] > w * 0.8) {
        const len = smearAcc[key];
        smearAcc[key] = 0;
        planeOf(surf, Math.max(-HW, Math.min(HW, p.x)), Math.max(-HH, Math.min(HH, p.y)), Math.max(-HD, Math.min(HD, p.z)), ab);
        const da = va / vt; const db = vb / vt;
        const strength = p.wound > 0 || p.stumps.length ? 0.75 : 0.45;
        atlas.stamp(surf, ab[0] - da * len * 0.5, ab[1] - db * len * 0.5, da, db, len * 0.5 + w * 0.5, w, surf === SURF.GLASS ? strength * 0.6 : strength, 2, 1, rnd());
      }
    }
  }

  function wetness(state, dt, level, ux, uy) {
    const hasPool = state.pool.fill > 0.0005;
    tideAcc += dt;
    const doTide = tideAcc >= 0.25;
    if (doTide) tideAcc = 0;
    // walls around the cross-section
    for (let i = 0; i < NP; i++) {
      const h = ux * pcX[i] + uy * pcY[i];
      if (hasPool && h < level - 0.05) {
        wetP[i] = 1;
        if (doTide) atlas.stamp(pcS[i], pcA[i], HD, 1, 0, 0.62, HD, 0.05, 3, 0.5, rnd());
        continue;
      }
      let w = wetP[i];
      if (w <= 0.02) continue;
      const nUp = pcNX[i] * ux + pcNY[i] * uy;
      if (nUp < -0.4) {
        // this wall faces down now: it drips
        if (rnd() < dt * w * 5 * emitScale) {
          const along = (rnd() - 0.5);
          const tx = -pcNY[i]; const ty = pcNX[i];
          drops.spawn(pcX[i] + tx * along + pcNX[i] * 0.03, pcY[i] + ty * along + pcNY[i] * 0.03, (rnd() - 0.5) * 2 * HD * 0.95,
            pcNX[i] * 0.3, pcNY[i] * 0.3, 0, 0.035 + rnd() * 0.05, 6, KIND_DROP);
          w -= 0.012;
        }
      } else if (nUp < 0.5 && rnd() < dt * w * 1.2) {
        runners.spawn(pcS[i], pcA[i] + (rnd() - 0.5), 0.2 + rnd() * (2 * HD - 0.4), 0.3 + rnd() * 0.5);
        w -= 0.05;
      }
      wetP[i] = Math.max(0, w * Math.exp(-dt / 30));
    }
    // back wall + glass: films under the pool, rings at the waterline, runners when it recedes
    const c = env.c; const s = env.s;
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const k = gy * GW + gx;
        const x = -HW + gx + 0.5; const y = -HH + gy + 0.5;
        const h = ux * x + uy * y;
        if (hasPool && h < level) {
          wetG[k] = 1;
          if (doTide) {
            const depth = level - h;
            if (depth < 1.2) {
              // waterline ring: a thin band along the (world-level) surface line
              const lx = x + depth * ux; const ly = y + depth * uy;
              if (lx > -HW && lx < HW && ly > -HH && ly < HH) {
                atlas.stamp(SURF.BACK, lx + HW, ly + HH, c, -s, 0.75, 0.07, 0.10, 3, 0.4, rnd());
                if (rnd() < 0.25) atlas.stamp(SURF.GLASS, lx + HW, ly + HH, c, -s, 0.7, 0.05, 0.06, 3, 0.4, rnd());
              }
            }
            atlas.stamp(SURF.BACK, gx + 0.5, gy + 0.5, 1, 0, 0.7, 0.7, 0.03, 3, 0.25, rnd());
          }
          continue;
        }
        let w = wetG[k];
        if (w <= 0.03) continue;
        if (rnd() < dt * w * 0.7) { runners.spawn(SURF.BACK, gx + rnd(), gy + rnd(), 0.25 + rnd() * 0.6); w -= 0.08; }
        if (rnd() < dt * w * 0.35) { runners.spawn(SURF.GLASS, gx + rnd(), gy + rnd(), 0.2 + rnd() * 0.4); w -= 0.08; }
        wetG[k] = Math.max(0, w * Math.exp(-dt / 10));
      }
    }
  }

  function onSlam(state) {
    // drops in flight get the same kick as bodies; wet down-facing walls shake loose
    const S = state.T ? state.T.slam.deltaV : 12;
    const ux = state.drum.ux; const uy = state.drum.uy;
    drops.kick(ux * S * 0.5, uy * S * 0.5, 0);
    mist.kick(ux * S * 0.3, uy * S * 0.3, 0);
    for (let i = 0; i < NP; i++) {
      if (wetP[i] < 0.05) continue;
      const nUp = pcNX[i] * ux + pcNY[i] * uy;
      if (nUp > -0.3) continue;
      const n = Math.round(wetP[i] * 10 * emitScale);
      for (let k = 0; k < n; k++) {
        const along = rnd() - 0.5; const tx = -pcNY[i]; const ty = pcNX[i];
        drops.spawn(pcX[i] + tx * along + pcNX[i] * 0.03, pcY[i] + ty * along + pcNY[i] * 0.03, (rnd() - 0.5) * 2 * HD * 0.95,
          pcNX[i] * (1 + rnd() * 2), pcNY[i] * (1 + rnd() * 2), 0, 0.035 + rnd() * 0.05, 6, KIND_DROP);
      }
      wetP[i] *= 0.6;
    }
  }

  /** a runner lets go of a down-facing surface: it becomes a falling drop */
  function onDrip(surf, a, b, vol) {
    let x; let y; let z;
    switch (surf) {
      case SURF.BACK: x = a - HW; y = b - HH; z = -HD + 0.03; break;
      case SURF.GLASS: x = a - HW; y = b - HH; z = HD - 0.03; break;
      case SURF.FLOOR: x = a - HW; y = -HH + 0.03; z = b - HD; break;
      case SURF.CEIL: x = a - HW; y = HH - 0.03; z = b - HD; break;
      case SURF.LEFT: x = -HW + 0.03; y = a - HH; z = b - HD; break;
      default: x = HW - 0.03; y = a - HH; z = b - HD;
    }
    drops.spawn(x, y, z, 0, 0, 0, 0.03 + Math.min(0.05, vol * 0.06), 6, KIND_DROP);
  }

  function applyLimits() {
    drops.setLimit((q.droplets || 1500) * loadScale);
    mist.setLimit((q.mist || 600) * loadScale);
    runners.setLimit((q.runners || 120) * loadScale);
    atlas.setStampCap((q.stamps || 1000) * Math.max(0.5, loadScale));
    emitScale = (q.emitScale || 1) * (0.4 + 0.6 * loadScale);
  }

  function setQuality(qq) {
    q = qq;
    atlas.setResolution(qq.bloodMap || 1536);
    applyLimits();
  }
  setQuality(ctx.quality);

  return {
    update(dtIn, state) {
      if (!state) return;
      frame++;
      const dt = Math.max(0, Math.min(dtIn || 0, 0.25));
      time += dt;
      if ((ctx.loadScale ?? 1) !== loadScale) { loadScale = ctx.loadScale ?? 1; applyLimits(); }
      for (const p of state.parts) byUid[p.uid & MASK] = p;

      const d = state.drum;
      const theta = ctx.drumAngle;
      const ux = Math.sin(theta); const uy = Math.cos(theta);
      const g = state.T ? state.T.drum.gravity : 13;
      const fx = ctx.poolFx;
      env.ux = ux; env.uy = uy; env.c = uy; env.s = ux;
      env.gx = -g * ux; env.gy = -g * uy; env.w2 = d.omega * d.omega; env.al = d.alpha;
      env.level = fx && fx.on ? fx.level : -1e9;
      env.waveOn = !!(fx && fx.on);
      if (fx) { env.wave = fx.wave; env.waveR = fx.waveR; env.waveInvDx = fx.waveInvDx; env.waveN = fx.waveN; }

      processEvents(state);
      if (slamPending) { slamPending = false; onSlam(state); }
      if (dt > 0) {
        emitBleeders(state, dt);
        smears(state, dt);
        wetness(state, dt, env.level, ux, uy);
        runEnv.g = g; runEnv.ux = ux; runEnv.uy = uy; runEnv.w2 = env.w2; runEnv.t = time;
        runners.update(dt, runEnv, onDrip);
        // integrate particles at <= 1/60 s sub-steps
        const nSub = Math.min(15, Math.ceil(dt / (1 / 60) - 1e-6));
        const h = dt / nSub;
        const phi = -2 * d.omega * h;
        env.cph = Math.cos(phi); env.sph = Math.sin(phi);
        for (let k = 0; k < nSub; k++) { drops.step(h, env, hooks); mist.step(h, env, hooks); }
      }
      drops.upload(d.omega);
      mist.upload(d.omega);
      atlas.flush(dt);
    },
    onLevel() {
      drops.clear(); mist.clear(); runners.clear(); atlas.clear();
      evN = 0; slamPending = false; wetP.fill(0); wetG.fill(0); smearAcc.fill(0); prevFrame.fill(-10);
      byUid.fill(null);
    },
    setQuality,
    emitLocal,
    get emitScale() { return emitScale; },
    get dropletCount() { return drops.count + mist.count; },
    stats() {
      return {
        drops: drops.count, mist: mist.count, dropLimit: drops.limit, mistLimit: mist.limit, runners: runners.count,
        stampsDropped: atlas.dropped, glassLoad: +atlas.glassLoad.toFixed(3), bloodMap: atlas.resolution, emitScale: +emitScale.toFixed(2),
      };
    },
    atlas,
    dispose() {
      offs.forEach((o) => o());
      drops.dispose(); mist.dispose(); atlas.dispose();
    },
  };
}
