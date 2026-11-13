/**
 * EVERY feel / balance number lives here. Later agents tune DATA, not code.
 * Pure data + a deep-merge helper; safe to import from src/sim (headless) and from the browser.
 *
 * Units: metres, kilograms, seconds, radians, litres ("L" = display litres, GDD §6).
 * Drum-local frame: origin at drum centre, +x right, +y up (when drum angle = 0), +z toward camera.
 */
export const TUNABLES = {
  sim: {
    dt: 1 / 60,                 // fixed step (LOCKED: 60 Hz)
    maxStepsPerFrame: 5,        // spiral-of-death guard in the loop
    solverIterations: 6,        // Rapier numSolverIterations (ragdoll stability vs cost)
    pgsIterations: 1,           // Rapier numInternalPgsIterations
    maxBodies: 450,             // ARCHITECTURE budget (bodies alive at once)
    debrisCap: 140,             // detached parts allowed before the oldest drained ones dissolve
    maxSpeed: 40,               // hard clamp on |v| (safety net against solver explosions), m/s
    maxAngSpeed: 40,            // hard clamp on |w|, rad/s
    softCcd: 0.25,              // m soft-CCD prediction on thin limbs (hard CCD stretches ragdolls)
  },

  drum: {
    width: 16, height: 10, depth: 5,   // interior cross-section (GDD §5)
    wallThickness: 2.0,                // thick static walls = nothing tunnels
    gravity: 13.0,             // m/s^2 — heavier than real: a 16 m drum seen from afar looks floaty at 9.81
    rotateAccel: 5.0,          // rad/s^2 at full input (GDD §4)
    maxOmega: 2.2,             // rad/s
    rotateKick: 0.12,          // instant |omega| floor on a fresh press (first-frame response)
    coastDamping: 2.2,         // 1/s exponential decay with no input (coasts ~1 s)
    holdDamping: 6.0,          // extra decay once slow (< holdBelow) so it settles and holds
    holdBelow: 0.25,
    brakeDamping: 9.0,         // 1/s while brake held
    reverseBoost: 1.25,         // accel multiplier when input opposes current spin (snappier rocking)
    fictitious: { centrifugal: 1.0, euler: 1.0, coriolis: 1.0 }, // scale factors (1 = physical)
    friction: 0.65,
    restitution: 0.05,
  },

  slam: {
    deltaV: 12.5,              // m/s instant velocity change along drum-relative up (GDD ~9)
    cooldown: 2.5,             // s
    angularJolt: 3.0,          // rad/s random spin added to parts (sells the jolt)
    dislodgeImpaled: true,
    jolt: 0.35,                // render hint: drum visual jolt amplitude (m)
  },

  donor: {
    // part table: hp, blood share, mass (kg). Shares sum to 1.
    parts: {
      head:     { hp: 60,  share: 0.08, mass: 5.0 },
      chest:    { hp: 120, share: 0.30, mass: 16.0 },
      pelvis:   { hp: 110, share: 0.16, mass: 11.0 },
      upperArm: { hp: 45,  share: 0.05, mass: 3.0 },
      forearm:  { hp: 35,  share: 0.03, mass: 2.4 },
      thigh:    { hp: 60,  share: 0.10, mass: 6.5 },
      shin:     { hp: 45,  share: 0.05, mass: 4.0 },
    },
    blood: 5.0,                // litres per standard donor (GDD: ~5 L share units)
    deathBloodFraction: 0.4,   // dies when remaining blood < 40 %
    linearDamping: 0.08,
    angularDamping: 1.2,
    angularDampingByRole: { forearm: 3.0, upperArm: 2.2, head: 1.8 }, // thin limbs: calmer piles
    friction: 0.7,
    restitution: 0.02,
    jointLimitScale: 1.0,
    brokenLimit: 2.4,          // rad, limits after a blunt "break" (limp joint)
    // alive behaviour ("lightly sedated")
    uprightTorque: 55,         // N·m per rad of tilt on the chest (weak: they mostly fail)
    uprightDamping: 9,
    uprightMinHp: 0.35,        // below this chest-HP fraction they stop trying
    legStiffness: 90,          // joint motor stiffness on hips/knees/spine while alive
    legDamping: 8,
    flailTorque: 7,            // random limb torque impulses (N·m)
    flailInterval: [0.35, 1.2],
    speakInterval: [5, 12],    // s between speech bubbles (per donor, random)
    drownSeconds: 6.0,         // alive with head submerged this long = drowned (waste)
  },

  damage: {
    impactMinDv: 11.0,          // m/s impact (approach) speed before impacts hurt
    impactScale: 5.0,          // hp per m/s over threshold (x other-body mass factor)
    impactMassRef: 6.0,        // kg: damage *= sqrt(otherMass / ref) when hit by a body
    impactEventMinDv: 2.5,     // m/s: below this no `impact` sound event
    crushForce: 9000,          // N sustained contact force that starts crushing
    crushDps: 25,
    woundFromDamage: 0.018,    // bleed rate (fraction of part share / s) per hp of damage taken
    maxWoundRate: 0.6,         // cap per part (fraction of its share per second)
    severBurst: 0.35,          // fraction of BOTH stumps' remaining share released instantly
    severStumpRate: 0.45,      // stump wound rate (fraction of share/s)
    breakBurst: 0.05,
    deathBurst: 0.08,
    deadBleedFactor: 1.0,      // dead donors keep bleeding from open wounds
    bleedMinRate: 0.002,       // wounds below this stop
    woundClot: 0.0,            // natural clotting per second (0 = never clot)
  },

  pool: {
    maxFill: 0.82,             // never fill the drum completely
    density: 1.55,             // buoyancy factor (>1 floats; equilibrium ≈ 1/density submerged)
    linearDrag: 2.6,           // 1/s at full submersion
    angularDrag: 2.0,
    dissolveDrainedAfter: 3.0, // s submerged + drained before a part dissolves
    dissolveCorpseAfter: 25.0, // s an intact submerged corpse lingers before dissolving (perf)
    splashMinSpeed: 3.0,
  },

  blood: {
    splatInterval: 0.12,       // throttle for blood:splat events
    spurtMinRate: 0.08,        // L/s at which a wound counts as a "spurt" event
  },

  scoring: {
    comboWindow: 3.0,          // s between kills to keep Sponsor Match going
    comboMax: 8,
    comboBase: 1.0,            // L: bonus per kill = base * (multiplier - 1)
    earlyFinishPerSecond: 0.25,// L per second left when all donors are processed
    processedDelay: 3.0,       // s after the last death before "all processed" counts
  },

  feel: {
    hitStopFrames: 3,          // on >= 2 coinciding dismemberments
    hitStopMinEvents: 2,
    slowMoScale: 0.35,
    slowMoDuration: 0.6,
    slowMoKills: 4,            // kills within slowMoWindow -> slow-mo
    slowMoWindow: 2.0,
    shakeScale: 1.0,
  },

  hazards: {
    spikes: {
      minSpeed: 3.5,           // m/s normal speed before spikes hurt
      damagePerSpeed: 9.0,     // hp per m/s over minSpeed (x part mass factor)
      impaleSpeed: 8.5,        // m/s normal speed that impales
      impaleParts: ['chest', 'pelvis', 'thigh', 'head', 'upperArm'],
      impaleBleed: 0.12,       // wound rate added on impale
      maxImpaled: 30,
      height: 0.45,            // spike length (m)
      restDps: 0.0,
    },
    saw: {
      radius: 1.1,
      dps: 260,                // cut damage per second of contact
      fling: 6.0,              // tangential m/s given to parts touching the blade
      spin: 30,                // rad/s visual spin (render) — slows with load
      contactMargin: 0.06,
    },
  },

  levels: {
    defaultCapacity: 160,      // L that would fill the whole drum cross-section
    spawnInterval: 0.45,       // s between donors leaving the hatch
    waveWarning: 1.0,          // s between wave:incoming and hatch:open
    timerWarnings: [30, 10, 5, 4, 3, 2, 1],
  },
};

/** Deep-merge overrides into a fresh copy of TUNABLES (for tests/experiments). */
export function makeTunables(overrides = {}) {
  return deepMerge(structuredClone(TUNABLES), overrides);
}

export function deepMerge(target, src) {
  for (const k of Object.keys(src || {})) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}
