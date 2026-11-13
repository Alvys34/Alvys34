/**
 * Rapier world + drum shell + the "dyn" registry (every dynamic body the sim owns).
 *
 * The drum is simulated in its ROTATING reference frame: the drum shell is a static (fixed) body,
 * gravity rotates with the drum angle and fictitious forces are applied to every dyn each step
 * (applyFrameForces). Rendering rotates the drum group by drum.theta instead.
 *
 * Dyn record (shared by donor parts, props, debris):
 *   { uid, kind: 'part'|'prop', body, collider, mass, radius, thick,
 *     x,y,z, qx,qy,qz,qw, vx,vy,vz,          // current (after last step), drum-local
 *     px,py,pz, pqx,pqy,pqz,pqw,               // previous step (render interpolation)
 *     pvx,pvy,pvz,                             // velocity before the last step (impact tests)
 *     sub, prevSub, subTime,                   // pool submersion 0..1 and time submerged
 *     buoyancy, dragScale, slamScale, removed, owner }
 */

export function createPhysicsWorld(R, T) {
  const world = new R.World({ x: 0, y: -T.drum.gravity, z: 0 });
  world.timestep = T.sim.dt;
  world.numSolverIterations = T.sim.solverIterations;
  if ('numInternalPgsIterations' in world) world.numInternalPgsIterations = T.sim.pgsIterations;
  const eventQueue = new R.EventQueue(true);
  return { world, eventQueue };
}

/**
 * Build the drum shell: 6 thick static boxes enclosing the interior box
 * [-hw,hw] x [-hh,hh] x [-hd,hd]. Returns the fixed body + collider handles by wall name.
 */
export function buildDrumShell(ctx) {
  const { R, world, T } = ctx;
  const hw = T.drum.width / 2; const hh = T.drum.height / 2; const hd = T.drum.depth / 2;
  const t = T.drum.wallThickness;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const walls = {};
  const mk = (name, x, y, z, ex, ey, ez, kind) => {
    const desc = R.ColliderDesc.cuboid(ex, ey, ez).setTranslation(x, y, z)
      .setFriction(T.drum.friction).setRestitution(T.drum.restitution);
    const c = world.createCollider(desc, body);
    walls[name] = c;
    ctx.owners.set(c.handle, { kind: 'wall', wall: name, material: kind });
  };
  // floor / ceiling span full width incl. corners; side walls fit between
  mk('floor', 0, -hh - t / 2, 0, hw + t, t / 2, hd + t, 'metal');
  mk('ceiling', 0, hh + t / 2, 0, hw + t, t / 2, hd + t, 'metal');
  mk('left', -hw - t / 2, 0, 0, t / 2, hh, hd + t, 'metal');
  mk('right', hw + t / 2, 0, 0, t / 2, hh, hd + t, 'metal');
  mk('back', 0, 0, -hd - t / 2, hw, hh, t / 2, 'metal');
  mk('glass', 0, 0, hd + t / 2, hw, hh, t / 2, 'glass');
  return { body, walls, hw, hh, hd };
}

/** Wall frames in drum-local coords: inward normal n, tangent axis, plane offset. */
export function wallFrame(drum, wall) {
  const { hw, hh } = drum;
  switch (wall) {
    case 'floor': return { n: [0, 1], t: [1, 0], plane: -hh, half: hw };
    case 'ceiling': return { n: [0, -1], t: [1, 0], plane: hh, half: hw };
    case 'left': return { n: [1, 0], t: [0, 1], plane: -hw, half: hh };
    case 'right': return { n: [-1, 0], t: [0, 1], plane: hw, half: hh };
    default: throw new Error(`Unknown wall "${wall}"`);
  }
}

/** Point on a wall (drum-local) at tangent coordinate `at`, raised `off` metres inward. */
export function wallPoint(drum, wall, at, off = 0) {
  const f = wallFrame(drum, wall);
  const base = f.n[0] !== 0 ? [f.plane, 0] : [0, f.plane];
  return [base[0] + f.t[0] * at + f.n[0] * off, base[1] + f.t[1] * at + f.n[1] * off];
}

/** Signed height of drum-local point (x,y) above the wall's inner surface. */
export function heightAboveWall(drum, wall, x, y) {
  switch (wall) {
    case 'floor': return y + drum.hh;
    case 'ceiling': return drum.hh - y;
    case 'left': return x + drum.hw;
    case 'right': return drum.hw - x;
    default: return Infinity;
  }
}

let uidCounter = 1;
export function resetUids() { uidCounter = 1; }

export function makeDyn(kind, body, collider, { mass, radius, thick, owner }) {
  const t = body.translation(); const q = body.rotation();
  return {
    uid: uidCounter++, kind, body, collider, mass, radius, thick, owner,
    x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w,
    px: t.x, py: t.y, pz: t.z, pqx: q.x, pqy: q.y, pqz: q.z, pqw: q.w,
    vx: 0, vy: 0, vz: 0, pvx: 0, pvy: 0, pvz: 0,
    sub: 0, prevSub: 0, subTime: 0,
    buoyancy: 1, dragScale: 1, slamScale: 1,
    removed: false, born: 0, dirty: false,
  };
}

/** Read back pose/velocity of all dyns after a physics step (keeps previous for interpolation). */
export function readback(dyns) {
  for (let i = 0; i < dyns.length; i++) {
    const d = dyns[i];
    if (d.removed || d.encased) continue; // encased parts are posed by their container prop
    d.px = d.x; d.py = d.y; d.pz = d.z;
    d.pqx = d.qx; d.pqy = d.qy; d.pqz = d.qz; d.pqw = d.qw;
    d.pvx = d.vx; d.pvy = d.vy; d.pvz = d.vz;
    const t = d.body.translation(); const q = d.body.rotation(); const v = d.body.linvel();
    d.x = t.x; d.y = t.y; d.z = t.z;
    d.qx = q.x; d.qy = q.y; d.qz = q.z; d.qw = q.w;
    d.vx = v.x; d.vy = v.y; d.vz = v.z;
  }
}

/**
 * Rotating-frame forces + pool buoyancy/drag, applied as velocity changes before the step.
 *  - gravity: set on the world (rotated) by the drum module
 *  - centrifugal  +w^2 r          (in the drum plane)
 *  - Euler        -alpha z x r = (alpha*y, -alpha*x)   (+ -alpha*dt on each body's spin about z)
 *  - Coriolis     -2 w z x v   -> exact rotation of (vx,vy) by -2 w dt (energy-preserving)
 *  - buoyancy     density * g * submerged along world-up; drag ∝ submersion
 */
export function applyFrameForces(ctx, dt) {
  const { T, drum, dyns } = ctx;
  const w = drum.omega; const a = drum.alpha;
  const fc = T.drum.fictitious;
  const cf = w * w * fc.centrifugal;
  const eu = a * fc.euler;
  const phi = -2 * w * dt * fc.coriolis;
  const cphi = Math.cos(phi); const sphi = Math.sin(phi);
  const ux = drum.ux; const uy = drum.uy;
  const g = T.drum.gravity;
  const P = T.pool;
  const vmax = T.sim.maxSpeed;
  const v3 = { x: 0, y: 0, z: 0 };
  const frameStill = w === 0 && a === 0;
  for (let i = 0; i < dyns.length; i++) {
    const d = dyns[i];
    if (d.removed || d.encased) continue;
    // nothing to add: leave the body alone so resting piles can fall asleep (no jitter, cheaper)
    if (frameStill && d.sub <= 0 && !d.dirty) continue;
    d.dirty = false;
    let vx = d.vx; let vy = d.vy; let vz = d.vz;
    // Coriolis (rotation of in-plane velocity)
    const rx = vx * cphi - vy * sphi;
    const ry = vx * sphi + vy * cphi;
    vx = rx; vy = ry;
    // centrifugal + Euler
    vx += (cf * d.x + eu * d.y) * dt;
    vy += (cf * d.y - eu * d.x) * dt;
    // rotational Euler term: a torque-free body keeps its WORLD spin, so its spin relative to the
    // drum changes by -alpha*dt. Without this, jointed chains fight the linear Euler force and stretch.
    const av = d.body.angvel();
    let wx = av.x; let wy = av.y; let wz = av.z - eu * dt;
    // buoyancy + drag
    if (d.sub > 0) {
      const b = P.density * d.buoyancy * g * d.sub * dt;
      vx += ux * b; vy += uy * b;
      const k = Math.exp(-P.linearDrag * d.dragScale * d.sub * dt);
      vx *= k; vy *= k; vz *= k;
      const ka = Math.exp(-P.angularDrag * d.sub * dt);
      wx *= ka; wy *= ka; wz *= ka;
    }
    if (eu !== 0 || d.sub > 0) {
      v3.x = wx; v3.y = wy; v3.z = wz;
      d.body.setAngvel(v3, true);
    }
    // safety clamp
    const sp2 = vx * vx + vy * vy + vz * vz;
    if (sp2 > vmax * vmax) { const s = vmax / Math.sqrt(sp2); vx *= s; vy *= s; vz *= s; }
    d.vx = vx; d.vy = vy; d.vz = vz;
    v3.x = vx; v3.y = vy; v3.z = vz;
    d.body.setLinvel(v3, true);
  }
}

/**
 * The ONLY sanctioned way for sim code (hazards, props, modes) to change a dyn's linear velocity:
 * the change is committed by the next applyFrameForces pass. Never call body.setLinvel/applyImpulse
 * directly — the force pass would overwrite it with the cached velocity.
 */
export function addVelocity(d, dx, dy, dz = 0) {
  d.vx += dx; d.vy += dy; d.vz += dz;
  d.dirty = true;
}

/** Clamp angular velocities (rare safety net, run every few steps). */
export function clampAngular(ctx) {
  const max = ctx.T.sim.maxAngSpeed;
  const v3 = { x: 0, y: 0, z: 0 };
  for (const d of ctx.dyns) {
    if (d.removed || d.encased) continue;
    const w = d.body.angvel();
    const s2 = w.x * w.x + w.y * w.y + w.z * w.z;
    if (s2 > max * max) {
      const s = max / Math.sqrt(s2);
      v3.x = w.x * s; v3.y = w.y * s; v3.z = w.z * s;
      d.body.setAngvel(v3, true);
    }
  }
}
