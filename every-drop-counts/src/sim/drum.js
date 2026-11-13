/**
 * Drum rotation control (inertia, coast, hold, brake) and SLAM.
 *
 * drum state (ctx.drum):
 *   theta, prevTheta   rad, drum-to-world rotation about +z (CCW positive)
 *   omega, alpha       rad/s, rad/s^2
 *   ux, uy             world-up expressed in drum-local coords = (sin θ, cos θ)
 *   hw, hh, hd         interior half extents
 *   slamCooldown       s until SLAM is ready (0 = ready)
 *   jolt, prevJolt     0..1 render hint (decays after a slam)
 *   input              { rotate, brake } latest input; slamRequest latched by setInput
 */
export function createDrumState(T, theta = 0) {
  return {
    theta, prevTheta: theta, omega: 0, alpha: 0,
    ux: Math.sin(theta), uy: Math.cos(theta),
    hw: T.drum.width / 2, hh: T.drum.height / 2, hd: T.drum.depth / 2,
    slamCooldown: 0, slamCount: 0,
    jolt: 0, prevJolt: 0,
    input: { rotate: 0, brake: false },
    prevRotate: 0,
    slamRequest: false,
  };
}

export function stepDrum(ctx, dt) {
  const { T, drum, world } = ctx;
  const D = T.drum;
  const r = Math.max(-1, Math.min(1, Number(drum.input.rotate) || 0));
  const prevOmega = drum.omega;
  let w = drum.omega;

  if (Math.abs(r) > 0.05) {
    // rotate +1 = clockwise (D / Right) = negative omega
    let acc = -r * D.rotateAccel;
    if (Math.abs(w) > 0.05 && Math.sign(acc) !== Math.sign(w)) acc *= D.reverseBoost;
    // first-frame response: a fresh press immediately gets a small angular speed
    if (Math.abs(drum.prevRotate) <= 0.05 && Math.abs(w) < D.rotateKick) {
      w = Math.sign(acc) * D.rotateKick * Math.min(1, Math.abs(r) * 1.5);
    }
    w += acc * dt;
  } else {
    w *= Math.exp(-D.coastDamping * dt);
    if (Math.abs(w) < D.holdBelow) w *= Math.exp(-D.holdDamping * dt);
    if (Math.abs(w) < 1e-4) w = 0;
  }
  if (drum.input.brake) w *= Math.exp(-D.brakeDamping * dt);
  if (w > D.maxOmega) w = D.maxOmega;
  if (w < -D.maxOmega) w = -D.maxOmega;

  drum.prevRotate = r;
  drum.omega = w;
  drum.alpha = (w - prevOmega) / dt;
  drum.prevTheta = drum.theta;
  drum.theta += w * dt;
  drum.ux = Math.sin(drum.theta);
  drum.uy = Math.cos(drum.theta);
  // gravity in the drum frame = -g * worldUp(local)
  world.gravity = { x: -D.gravity * drum.ux, y: -D.gravity * drum.uy, z: 0 };

  drum.prevJolt = drum.jolt;
  drum.jolt = Math.max(0, drum.jolt - dt * 4);

  if (drum.slamCooldown > 0) {
    drum.slamCooldown -= dt;
    if (drum.slamCooldown <= 0) {
      drum.slamCooldown = 0;
      ctx.emit('slam:ready', {});
    }
  }
}

/** Try to SLAM (consumes drum.slamRequest). Returns true if it fired. */
export function trySlam(ctx) {
  const { drum, T } = ctx;
  if (!drum.slamRequest) return false;
  drum.slamRequest = false;
  if (drum.slamCooldown > 0) return false;
  const S = T.slam;
  drum.slamCooldown = S.cooldown;
  drum.slamCount++;
  drum.jolt = 1;
  const ux = drum.ux; const uy = drum.uy;
  const rng = ctx.rng;
  for (const d of ctx.dyns) {
    if (d.removed) continue;
    const dv = S.deltaV * d.slamScale;
    d.vx += ux * dv; d.vy += uy * dv;
    if (S.angularJolt > 0) {
      d.body.applyTorqueImpulse({
        x: rng.range(-1, 1) * S.angularJolt * d.mass * 0.05,
        y: rng.range(-1, 1) * S.angularJolt * d.mass * 0.05,
        z: rng.range(-1, 1) * S.angularJolt * d.mass * 0.05,
      }, true);
    }
  }
  for (const h of ctx.hazards) if (h.onSlam) h.onSlam(ctx);
  for (const p of ctx.props) if (p.onSlam) p.onSlam(ctx);
  ctx.emit('slam', {});
  return true;
}
