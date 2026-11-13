/**
 * Blood accounting (GDD §6 "Blood model").
 *
 * Every litre that leaves a body goes through release(): it is credited to `collected`
 * (score + pool) exactly once. Parts own `blood` (L remaining) out of `bloodMax`; wounds are a
 * rate in "fraction of the part's bloodMax per second" (scaled by the donor type's bleedScale).
 *
 * ctx.blood = {
 *   collected,          // L released from donors so far (credited to score + pool)
 *   donorTotal,         // L of blood ever spawned inside donors (conservation bound)
 *   dissolved,          // L lost with parts removed un-bled (dissolve / debris cap): never scored
 *   rate,               // L/s released over the last step (audio/VFX intensity)
 *   bleeders: [],       // up to MAX_BLEEDERS active sources for VFX: {x,y,z,dx,dy,dz,rate,part}
 * }
 */
const MAX_BLEEDERS = 48;

export function createBloodState() {
  return { collected: 0, donorTotal: 0, dissolved: 0, rate: 0, bleeders: [], splatTimer: 0, splatAcc: 0, released: 0 };
}

/** Release `liters` from a part (or from nowhere when part is null). Returns amount released. */
export function releaseBlood(ctx, part, liters, { burst = false, pos = null, dir = null } = {}) {
  if (!(liters > 0)) return 0;
  let amount = liters;
  if (part) {
    amount = Math.min(amount, part.blood);
    if (amount <= 0) return 0;
    part.blood -= amount;
    part.donor.blood -= amount;
    if (part.blood < 1e-6) part.blood = 0;
  }
  const B = ctx.blood;
  B.collected += amount;
  B.released += amount;
  B.splatAcc += amount;
  if (ctx.mode && ctx.mode.onBlood) ctx.mode.onBlood(ctx, amount);
  if (burst && amount > 0.02) {
    const p = pos || (part ? [part.x, part.y, part.z] : [0, 0, 0]);
    ctx.emit('blood:spurt', { rate: amount * 4, liters: amount, burst: true, dir: dir || null }, p);
  }
  return amount;
}

/** Per-step bleeding of every wounded part + bleeder list for VFX. */
export function stepBleeding(ctx, dt) {
  const B = ctx.blood;
  const D = ctx.T.damage;
  B.released = 0;
  B.bleeders.length = 0;
  for (const part of ctx.parts) {
    if (part.removed || part.wound <= 0 || part.blood <= 0) continue;
    const donor = part.donor;
    let rate = part.wound * donor.def.bleedScale * part.bloodMax; // L/s
    if (!donor.alive) rate *= D.deadBleedFactor;
    if (part.wound < D.bleedMinRate) { part.wound = 0; continue; }
    const got = releaseBlood(ctx, part, rate * dt);
    if (D.woundClot > 0) part.wound = Math.max(0, part.wound - D.woundClot * dt);
    if (got > 0 && B.bleeders.length < MAX_BLEEDERS) {
      // source: a stump if there is one (spray along the stump axis), else the part centre
      let sx = part.x; let sy = part.y; let sz = part.z; let dx = 0; let dy = 0; let dz = 0;
      if (part.stumps.length) {
        const st = part.stumps[(ctx.stepIndex + part.uid) % part.stumps.length];
        const [ax, ay, az] = rotateByPart(part, st[0], st[1], st[2]);
        sx += ax; sy += ay; sz += az;
        const len = Math.hypot(ax, ay, az) || 1;
        dx = ax / len; dy = ay / len; dz = az / len;
      } else {
        dx = ctx.drum.ux; dy = ctx.drum.uy; dz = 0;
      }
      B.bleeders.push({ x: sx, y: sy, z: sz, dx, dy, dz, rate, part: part.uid });
      if (!part.spurting && rate >= ctx.T.blood.spurtMinRate) {
        part.spurting = true;
        ctx.emit('blood:spurt', { rate }, [sx, sy, sz]);
      }
    }
    if (part.blood <= 0) part.spurting = false;
  }
  B.rate = B.released / dt;
  // throttled splat events (droplets "landing" — VFX does the real droplets)
  B.splatTimer -= dt;
  if (B.splatTimer <= 0 && B.splatAcc > 0.01) {
    B.splatTimer = ctx.T.blood.splatInterval;
    const src = B.bleeders.length ? B.bleeders[ctx.stepIndex % B.bleeders.length] : null;
    ctx.emit('blood:splat', { size: Math.min(1, B.splatAcc * 2) }, src ? [src.x, src.y - 0.5, src.z] : [0, -ctx.drum.hh, 0]);
    B.splatAcc = 0;
  }
}

/** Rotate a part-local vector by the part's current orientation. */
export function rotateByPart(p, vx, vy, vz) {
  const x = p.qx; const y = p.qy; const z = p.qz; const w = p.qw;
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}
