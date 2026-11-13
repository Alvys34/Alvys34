/**
 * Ragdoll donors: spawning, alive behaviour, damage (GDD §6), sever/break, death, removal.
 *
 * Donor = {
 *   id, type, def (DonorTypeDef), alive, cause, deathTime, spawnTime,
 *   blood, bloodMax (L), parts: {name -> Part}, partList, joints: [Joint],
 *   look: { gown, skin } (render hints, picked at spawn), speech: {text, t} | null,
 *   drownTimer, impaled (count), gone (all parts removed)
 * }
 * Part = Dyn (src/sim/physics.js) + {
 *   donor, name, role, shape, hp, hpMax, blood, bloodMax, wound, stumps: [[lx,ly,lz]],
 *   joint (to parent) | null, severed (detached from parent), broken, zeroed, impaled
 * }
 * Joint = { j (Rapier joint), parent: Part, child: Part, def, severed, broken, removed }
 */
import { makeDyn } from './physics.js';
import { releaseBlood } from './blood.js';
import { shapeRadius, shapeThickness, scalePlan } from './donors/humanoid.js';
import { getDonorType } from './donors/index.js';

const CUT_KINDS = new Set(['cut', 'grind', 'explode']);

/** body plan of a donor type at the global donor scale (cached per type + scale) */
function scaledPlanFor(def, S) {
  if (S === 1) return def.plan;
  def._scaledPlans = def._scaledPlans || {};
  return (def._scaledPlans[S] ||= scalePlan(def.plan, S));
}
let donorIdCounter = 1;
export function resetDonorIds() { donorIdCounter = 1; }

function colliderDesc(R, shape) {
  switch (shape.type) {
    case 'ball': return R.ColliderDesc.ball(shape.r);
    case 'capsule': return R.ColliderDesc.capsule(shape.hh, shape.r);
    case 'box': return R.ColliderDesc.roundCuboid(shape.hx - 0.02, shape.hy - 0.02, shape.hz - 0.02, 0.02);
    case 'cylinder': return R.ColliderDesc.cylinder(shape.hh, shape.r);
    default: throw new Error(`Unknown shape ${shape.type}`);
  }
}

function quatMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function rotVec(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/**
 * Spawn a donor with its pelvis at drum-local (x,y,z), standing upright in WORLD terms.
 * opts: { vx, vy, vz, yaw, pose: 'stand' }
 */
export function spawnDonor(ctx, typeId, x, y, z, opts = {}) {
  const { R, world, T, rng } = ctx;
  const def = getDonorType(typeId);
  const P = T.donor;
  const S = P.scale ?? 1;
  const plan = scaledPlanFor(def, S);
  const id = donorIdCounter++;
  const bloodMax = P.blood * def.bloodScale;
  // level-wide outfit override (shift 8 "Staff Appreciation Day": donors wear staff uniforms)
  const lv = ctx.level && ctx.level.donorLook;
  const useOutfit = lv && !def.keepLook;
  const donor = {
    id, type: def.type, def, alive: true, cause: null, deathTime: -1, spawnTime: ctx.time,
    blood: bloodMax, bloodMax, parts: {}, partList: [], joints: [],
    look: {
      gown: rng.pick(useOutfit && lv.gown ? lv.gown : def.look.gown), skin: rng.pick(def.look.skin),
      accessory: def.look.accessory || null, outfit: (useOutfit && lv.outfit) || def.look.outfit || 'gown',
      scale: (def.scale || 1) * S, seed: rng.int(0, 1e6),
    },
    plan, sizeScale: S,
    mustSurvive: !!def.mustSurvive,
    speech: null, speakTimer: rng.range(1.0, P.speakInterval[1]), flailTimer: rng.range(...P.flailInterval),
    drownTimer: 0, impaled: 0, gone: false, hurtAcc: 0, hurtTimer: 0, lastCause: null, lastCauseTime: -99,
  };
  // orientation: upright in world => rotate by -theta about z, plus a little yaw for variety
  const yaw = opts.yaw ?? rng.range(-0.5, 0.5);
  const qz = { x: 0, y: 0, z: Math.sin(-ctx.drum.theta / 2), w: Math.cos(-ctx.drum.theta / 2) };
  const qy = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const q = quatMul(qz, qy);
  const root = plan.rootHeight;

  for (const pd of plan.parts) {
    const tune = P.parts[pd.role];
    const off = rotVec(q, [pd.pos[0], pd.pos[1] - root, pd.pos[2]]);
    const bd = R.RigidBodyDesc.dynamic()
      .setTranslation(x + off[0], y + off[1], z + off[2])
      .setRotation(q)
      .setLinvel(opts.vx || 0, opts.vy || 0, opts.vz || 0)
      .setLinearDamping(P.linearDamping)
      .setAngularDamping((P.angularDampingByRole && P.angularDampingByRole[pd.role]) ?? P.angularDamping);
    // Hard CCD clamps a fast limb at its time of impact while the rest of the ragdoll moves on,
    // which visibly stretches joints. Thick (2 m) drum walls + the speed clamp already prevent
    // tunnelling, so thin limbs only get soft (predictive) CCD.
    if (shapeThickness(pd.shape) < 0.07) bd.setSoftCcdPrediction(T.sim.softCcd);
    const body = world.createRigidBody(bd);
    const mass = tune.mass * def.massScale * S;
    const cd = colliderDesc(R, pd.shape)
      .setMass(mass)
      .setFriction(P.friction)
      .setRestitution(P.restitution)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(mass * T.damage.impactEventMinDv / T.sim.dt);
    const collider = world.createCollider(cd, body);
    const part = makeDyn('part', body, collider, {
      mass, radius: shapeRadius(pd.shape), thick: shapeThickness(pd.shape), owner: donor,
    });
    Object.assign(part, {
      donor, name: pd.name, role: pd.role, side: pd.side || 0, shape: pd.shape,
      hp: tune.hp * def.hpScale, hpMax: tune.hp * def.hpScale,
      blood: tune.share * bloodMax, bloodMax: tune.share * bloodMax,
      wound: 0, opened: false, encased: false, stumps: [], joint: null, severed: false, broken: false, zeroed: false,
      impaled: null, spurting: false, slamScale: def.slamScale, born: ctx.time, detachedAt: -1,
    });
    ctx.owners.set(collider.handle, { kind: 'part', part });
    donor.parts[pd.name] = part;
    donor.partList.push(part);
    ctx.dyns.push(part);
    ctx.parts.push(part);
  }

  for (const pd of plan.parts) {
    if (!pd.parent) continue;
    const child = donor.parts[pd.name];
    const parent = donor.parts[pd.parent];
    const ppos = plan.parts.find((p) => p.name === pd.parent).pos;
    const a1 = { x: pd.anchor[0] - ppos[0], y: pd.anchor[1] - ppos[1], z: pd.anchor[2] - ppos[2] };
    const a2 = { x: pd.anchor[0] - pd.pos[0], y: pd.anchor[1] - pd.pos[1], z: pd.anchor[2] - pd.pos[2] };
    const j = world.createImpulseJoint(R.JointData.spherical(a1, a2), parent.body, child.body, true);
    j.setContactsEnabled(false);
    const joint = { j, parent, child, def: pd, a1: [a1.x, a1.y, a1.z], a2: [a2.x, a2.y, a2.z], severed: false, broken: false, removed: false, motor: pd.motor || null };
    setJointLimits(ctx, joint, pd.limits, T.donor.jointLimitScale);
    child.joint = joint;
    donor.joints.push(joint);
  }
  setMotors(ctx, donor, true);

  ctx.donors.push(donor);
  ctx.blood.donorTotal += bloodMax;
  if (def.onSpawn) def.onSpawn(ctx, donor);
  ctx.emit('donor:spawn', { id, type: def.type }, [x, y, z]);
  return donor;
}

function setJointLimits(ctx, joint, limits, scale = 1) {
  const R = ctx.R; const j = joint.j;
  const axes = [['x', R.JointAxis.AngX], ['y', R.JointAxis.AngY], ['z', R.JointAxis.AngZ]];
  for (const [k, ax] of axes) {
    const lim = limits[k];
    if (lim) j.rawSet.jointSetLimits(j.handle, ax, lim[0] * scale, lim[1] * scale);
  }
}

/** Enable/disable posture motors (alive = weak stiffness, dead/broken = none). */
export function setMotors(ctx, donor, on) {
  const { R, T } = ctx;
  const P = T.donor;
  const legs = donor.def.behaviour.legs ?? 1;
  for (const joint of donor.joints) {
    if (!joint.motor || joint.removed || joint.severed) continue;
    const j = joint.j;
    const stiff = on && !joint.broken ? P.legStiffness * legs * (joint.motor === 'neck' ? 0.4 : 1) : 0;
    const damp = on && !joint.broken ? P.legDamping * legs : 0;
    for (const ax of [R.JointAxis.AngX, R.JointAxis.AngZ]) {
      j.rawSet.jointConfigureMotorModel(j.handle, ax, R.MotorModel.AccelerationBased);
      j.rawSet.jointConfigureMotorPosition(j.handle, ax, 0, stiff, damp);
    }
  }
}

/** Alive behaviour: weak upright torque, flailing, speech, drowning. Called before the physics step. */
export function donorPreStep(ctx, donor, dt) {
  const P = ctx.T.donor;
  const def = donor.def;
  if (def.preStep) def.preStep(ctx, donor, dt);
  if (!donor.alive) return;
  const chest = donor.parts.chest; const pelvis = donor.parts.pelvis;
  const rng = ctx.rng;
  const hpFrac = chest.hp / chest.hpMax;
  const beh = def.behaviour;
  const S3 = (donor.sizeScale || 1) ** 3; // torques scale with the bigger bodies' inertia
  if (donor.encased) {
    // inside a safety sphere: bodies are disabled and posed by the sphere prop; only talk
    donor.flailTimer = 1;
  } else if (hpFrac > P.uprightMinHp && !chest.severed && !chest.removed) {
    const k = P.uprightTorque * (beh.upright ?? 1) * S3;
    for (const part of [chest, pelvis]) {
      if (part.removed || part.impaled) continue;
      // part up axis in drum-local coords
      const ax = 2 * (part.qx * part.qy - part.qw * part.qz);
      const ay = 1 - 2 * (part.qx * part.qx + part.qz * part.qz);
      const az = 2 * (part.qy * part.qz + part.qw * part.qx);
      const ux = ctx.drum.ux; const uy = ctx.drum.uy;
      // a x u  (u has z = 0)
      const cx = -az * uy; const cy = az * ux; const cz = ax * uy - ay * ux;
      const w = part.body.angvel();
      const c = P.uprightDamping * (beh.upright ?? 1) * 0.1 * S3;
      part.body.applyTorqueImpulse({
        x: (k * cx - c * w.x) * dt, y: (k * cy - c * w.y) * dt, z: (k * cz - c * w.z) * dt,
      }, true);
    }
  }
  donor.flailTimer -= dt;
  if (donor.flailTimer <= 0 && !donor.encased) {
    donor.flailTimer = rng.range(...P.flailInterval);
    const limbs = donor.partList.filter((p) => !p.removed && (p.role === 'forearm' || p.role === 'upperArm' || p.role === 'shin' || p.role === 'head'));
    if (limbs.length) {
      const p = rng.pick(limbs);
      const s = P.flailTorque * (beh.flail ?? 1) * (p.role === 'head' ? 0.3 : 1) * S3;
      p.body.applyTorqueImpulse({ x: rng.range(-s, s) * 0.1, y: rng.range(-s, s) * 0.05, z: rng.range(-s, s) * 0.1 }, true);
    }
  }
  donor.speakTimer -= dt;
  if (donor.speakTimer <= 0) {
    donor.speakTimer = rng.range(...P.speakInterval);
    if (def.lines && def.lines.length && !donor.parts.head.removed) {
      const text = rng.pick(def.lines);
      donor.speech = { text, t: ctx.time };
      const h = donor.parts.head;
      ctx.emit('donor:speak', { id: donor.id, text }, [h.x, h.y, h.z]);
    }
  }
}

/** After the physics step: drowning, death by blood loss, hurt-event flush. */
export function donorPostStep(ctx, donor, dt) {
  const P = ctx.T.donor;
  if (donor.def.postStep) donor.def.postStep(ctx, donor, dt);
  if (donor.alive) {
    const head = donor.parts.head;
    if (!head.removed && !head.encased && head.sub > 0.6) {
      donor.drownTimer += dt;
      if (donor.drownTimer >= P.drownSeconds) killDonor(ctx, donor, 'drown');
    } else {
      donor.drownTimer = Math.max(0, donor.drownTimer - dt * 2);
    }
    if (donor.alive && donor.blood < donor.bloodMax * P.deathBloodFraction) {
      const recent = ctx.time - donor.lastCauseTime < 3 ? donor.lastCause : null;
      killDonor(ctx, donor, recent || 'bleedout');
    }
  }
  if (donor.speech && ctx.time - donor.speech.t > 2.5) donor.speech = null;
  donor.hurtTimer -= dt;
  if (donor.hurtAcc >= 6 || (donor.hurtAcc > 0 && donor.hurtTimer <= 0)) {
    const c = donor.parts.chest;
    ctx.emit('donor:hurt', { id: donor.id, amount: Math.round(donor.hurtAcc), cause: donor.lastCause, alive: donor.alive }, [c.x, c.y, c.z]);
    donor.hurtAcc = 0;
    donor.hurtTimer = 0.15;
  }
}

/**
 * Apply damage to a part.
 * kind: 'cut' | 'grind' | 'explode' (zeroed limb SEVERS) or 'blunt' | 'pierce' | 'crush' (zeroed limb BREAKS)
 * cause: death cause reported if this kills ('cut','impale','crush','grind','impact','explode')
 */
export function damagePart(ctx, part, amount, kind, cause) {
  if (part.removed || part.encased || !(amount > 0)) return;
  const D = ctx.T.damage;
  const donor = part.donor;
  part.hp -= amount;
  const wf = (D.wound && D.wound[kind]) ?? D.woundFromDamage;
  part.wound = Math.min(D.maxWoundRate, part.wound + amount * wf);
  if (kind !== 'blunt' && kind !== 'crush') part.opened = true;
  donor.hurtAcc += amount;
  donor.lastCause = cause; donor.lastCauseTime = ctx.time;
  ctx.intensity = Math.min(1, (ctx.intensity || 0) + amount * 0.004);
  if (part.hp > 0 || part.zeroed) return;
  part.hp = 0;
  part.zeroed = true;
  const cutting = CUT_KINDS.has(kind);
  if (cutting) severPart(ctx, part); else breakPart(ctx, part);
  if ((part.role === 'head' || part.role === 'chest') && donor.alive) killDonor(ctx, donor, cause);
}

/** Remove the joint linking `part` to its parent (pelvis: the spine). Both stumps bleed. */
export function severPart(ctx, part) {
  const donor = part.donor;
  let joint = part.joint;
  if (part.role === 'pelvis') joint = donor.joints.find((j) => j.parent === part && j.child.role === 'chest');
  if (!joint || joint.severed || joint.removed) return false;
  const D = ctx.T.damage;
  if (!joint.removed) ctx.world.removeImpulseJoint(joint.j, true);
  joint.severed = true;
  const { parent, child } = joint;
  child.severed = true;
  child.detachedAt = ctx.time;
  child.stumps.push(joint.a2);
  parent.stumps.push(joint.a1);
  child.wound = Math.max(child.wound, D.severStumpRate);
  parent.wound = Math.max(parent.wound, D.severStumpRate);
  child.opened = true; parent.opened = true;
  // burst from the cut
  const wp = jointWorldPos(child, joint.a2);
  releaseBlood(ctx, child, child.blood * D.severBurst, { burst: true, pos: wp });
  releaseBlood(ctx, parent, parent.blood * D.severBurst, { burst: true, pos: wp });
  ctx.emit('limb:sever', { id: donor.id, part: child.name }, wp);
  ctx.stepSevers = (ctx.stepSevers || 0) + 1;
  ctx.debrisCount++;
  if (donor.alive && (child.role === 'head' || child.role === 'chest')) killDonor(ctx, donor, donor.lastCause || 'cut');
  return true;
}

/** Blunt zeroing: limp joint (wide limits, no motor). */
export function breakPart(ctx, part) {
  const joint = part.joint;
  part.broken = true;
  if (joint && !joint.severed && !joint.removed && !joint.broken) {
    joint.broken = true;
    const L = ctx.T.donor.brokenLimit;
    setJointLimits(ctx, joint, { x: [-L, L], y: [-L, L], z: [-L, L] });
    const R = ctx.R;
    for (const ax of [R.JointAxis.AngX, R.JointAxis.AngZ]) joint.j.rawSet.jointConfigureMotorPosition(joint.j.handle, ax, 0, 0, 0);
  }
  releaseBlood(ctx, part, part.blood * ctx.T.damage.breakBurst, { burst: false });
  ctx.emit('limb:break', { id: part.donor.id, part: part.name }, [part.x, part.y, part.z]);
}

export function killDonor(ctx, donor, cause = 'bleedout') {
  if (!donor.alive) return;
  donor.alive = false;
  donor.cause = cause;
  donor.deathTime = ctx.time;
  donor.speech = null;
  setMotors(ctx, donor, false);
  const D = ctx.T.damage;
  if (cause !== 'drown') {
    for (const p of donor.partList) {
      if (p.removed) continue;
      if (p.wound > 0 && p.opened) releaseBlood(ctx, p, p.blood * D.deathBurst);
    }
  }
  const c = donor.parts.chest;
  ctx.emit('donor:death', { id: donor.id, type: donor.type, cause }, [c.x, c.y, c.z]);
  ctx.stepKills = (ctx.stepKills || 0) + 1;
  if (donor.def.onDeath) donor.def.onDeath(ctx, donor, cause);
  if (ctx.scoring) ctx.scoring.onDeath(ctx, donor, cause);
}

/** Remove a part from the world (dissolve / grind). release=true converts its remaining blood. */
export function removePart(ctx, part, { release = false } = {}) {
  if (part.removed) return;
  if (release && part.blood > 0) releaseBlood(ctx, part, part.blood, { burst: true });
  const donor = part.donor;
  for (const j of donor.joints) {
    if (!j.removed && (j.parent === part || j.child === part)) {
      j.removed = true;
      if (!j.severed) {
        j.severed = true;
        const other = j.parent === part ? j.child : j.parent;
        if (j.child === other) { other.severed = true; other.detachedAt = ctx.time; }
      }
    }
  }
  if (part.impaled) part.impaled = null;
  ctx.owners.delete(part.collider.handle);
  ctx.world.removeRigidBody(part.body);
  part.removed = true;
  ctx.removedThisStep = true;
  // remaining blood in a removed part is simply gone (dissolved without a wound) — tracked so
  // blood conservation holds: collected + dissolved + still-in-bodies == donorTotal
  donor.blood -= part.blood;
  ctx.blood.dissolved += part.blood;
  part.blood = 0;
  if (donor.alive && (part.role === 'head' || part.role === 'chest')) killDonor(ctx, donor, ctx.lastRemoveCause || 'grind');
  if (donor.partList.every((p) => p.removed)) donor.gone = true;
}

export function jointWorldPos(part, a) {
  const r = rotVec({ x: part.qx, y: part.qy, z: part.qz, w: part.qw }, a);
  return [part.x + r[0], part.y + r[1], part.z + r[2]];
}
