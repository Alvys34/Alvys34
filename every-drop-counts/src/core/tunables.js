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
    crowdBodies: 300,           // above this many live bodies, drained junk dissolves early (perf):
    crowdDrainedAfter: 0.5,     //   drained loose parts this long after detaching, and fully drained
    crowdDissolvePerStep: 6,    //   corpses 2 s after death; at most this many parts per step
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
    // HANDLING (fix round 2, PLAYTEST-1 M4: it used to coast 51° after release, "like ice").
    // Released = exponential coast + a constant settle deceleration: from full speed it stops in
    // ~12° / 0.23 s, a 0.25 s tap travels ~16° in total (5° after release); Brake stops in ~3.5°.
    // Body fling on the harder stop was measured (pinned crowd, 3 seeds): peak relative speed
    // 14-26 m/s before vs 17-24 after, same damage; no clamp needed. tests/handling.test.mjs.
    coastDamping: 1.5,         // 1/s exponential decay with no input
    settleDecel: 8.0,          // rad/s^2 constant deceleration with no input ("the motor holds it")
    holdDamping: 6.0,          // extra decay once slow (< holdBelow) so it settles and holds
    holdBelow: 0.25,
    brakeDamping: 9.0,         // 1/s while brake held
    brakeDecel: 8.0,           // rad/s^2 extra constant deceleration while brake held
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
    // DONOR SCALE (orchestrator request: donors read too small on screen). Uniform size multiplier
    // for every donor type's body plan (shapes, joint anchors, spawn height). Mass scales linearly
    // (impact / crush mass references scale with it, so damage per hit is unchanged), blood litres do
    // NOT (litres are the balance currency). Grinder clog/chew, crusher gap, safety-sphere size and
    // hatch clearance follow it. Renderers read part sizes from the sim.
    scale: 1.35,
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
    // DROWNING (fix round 2, PLAYTEST-1 M2): live donors float LOW, so in a deep pool their heads
    // are under most of the time unless the player lifts them out (slam, rotate) or processes them.
    // donor.drown01 rises 1/drownSeconds per s with the head under, decays drownRecover per s out.
    aliveBuoyancy: 0.8,        // buoyancy factor of live donors' parts (corpses / loose parts: 1);
                               // 0.8 x pool.density = ~80 % submerged: at the surface, head awash
    uprightInPool: 0.0,        // upright-torque factor with the chest fully submerged (limp: can't swim)
    drownSeconds: 4.5,         // s of continuous head-under to drown (waste)
    drownRecover: 0.2,         // drown01 per s regained with the head out of the pool (slow: a
                               // slam buys time, getting them processed saves them)
    drownHeadSub: 0.6,         // head submersion (0..1) that counts as "under"
    drownMinDepth: 1.85,       // m (× donor scale = 2.5 m, a standing donor): shallower pools never drown
    drownWarnAt: 0.35,         // donor:drowning fires when drown01 crosses this going up
    drownWastes: true,         // a drowned donor's remaining blood is lost (never collected)
  },

  damage: {
    impactMinDv: 11.0,          // m/s impact (approach) speed before impacts hurt
    impactScale: 5.0,          // hp per m/s over threshold (x other-body mass factor)
    impactMassRef: 6.0,        // kg: damage *= sqrt(otherMass / ref) when hit by a body
    impactEventMinDv: 2.5,     // m/s: below this no `impact` sound event
    crushForce: 9000,          // N sustained contact force that starts crushing
    crushDps: 25,
    woundFromDamage: 0.018,    // fallback bleed rate per hp for damage kinds not listed in `wound`
    // Bleed rate (fraction of the part's share per second) opened per hp, BY DAMAGE KIND.
    // CONTENT balance pass: blunt trauma (wall slams, falls on bare metal) bruises — it barely
    // bleeds and clots — so a donor beaten to death against bare walls yields almost nothing.
    // Open wounds (cut / pierce / grind / explode / press) are where the litres come from.
    wound: { cut: 0.014, pierce: 0.010, grind: 0.02, explode: 0.012, press: 0.02, blunt: 0.0005, crush: 0.001 },
    maxWoundRate: 0.6,         // cap per part (fraction of its share per second)
    woundClot: 0.45,           // 1/s: open wounds close exponentially (no more free bleed-out)
    stumpClot: 0.10,           // 1/s: severed stumps close slowly (a sever drains both parts)
    // (impaled parts never clot while pinned; Thin-Bloods have clotScale 0)
    severBurst: 0.35,          // fraction of BOTH stumps' remaining share released instantly
    severStumpRate: 0.45,      // stump wound rate (fraction of share/s)
    breakBurst: 0.02,
    deathBurst: 0.08,          // on death, open wounds release this fraction of their part
    deadBleedFactor: 1.0,      // dead donors keep bleeding from open wounds
    bleedMinRate: 0.004,       // wounds below this stop
  },

  pool: {
    maxFill: 0.82,             // never fill the drum completely
    // shift mode: litres collected -> fill (src/sim/pool.js makeFillCurve). Monotone concave;
    // fill(q1) = atQ1, fill reaches maxFill at fullAt × q3. Level override: level.fillCurve
    // ({ atQ1, fullAt, fullLiters, k } or false = legacy volume / capacity). Overtime: real volume.
    curve: { atQ1: 0.38, fullAt: 1.15 },
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
    comboBase: 0.6,            // L: bonus per kill = base * (multiplier - 1)
    // causes that count for Sponsor Match (not 'impact' = bruised to death on bare metal, not 'drown')
    comboCauses: ['cut', 'impale', 'crush', 'grind', 'explode', 'bleedout'],
    earlyFinishPerSecond: 0.12,// L per second left when all donors are processed
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
      // "drops need height": sliding / rocking contact (< ~5 m/s) only scratches; a real drop
      // (>= ~4 m of free fall at g = 13 => ~10 m/s) impales
      minSpeed: 5.0,           // m/s normal speed before spikes hurt
      damagePerSpeed: 10.0,    // hp per m/s over minSpeed
      impaleSpeed: 10.0,       // m/s normal speed that impales
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
    railSaw: {
      radius: 0.95,
      period: 6.0,             // s for a full there-and-back sweep along the rail
      dwell: 0.35,             // fraction of each end the carriage eases in/out (0 = constant speed)
    },
    grinder: {
      width: 2.4,              // mouth length along the wall (m)
      housing: 0.55,           // housing depth: the roller face stands this far off the wall (m)
      grabMargin: 0.22,        // parts this close to the roller face (and over the mouth) get grabbed
      grabMaxSpeed: 2.5,       // ...if slower than this (m/s): hold the crowd on it, don't fling it across
      pull: 5.0,               // 1/s steering gain dragging held parts into the jaw
      pullMax: 3.5,            // m/s cap of the drag
      chewRate: 34,            // kg/s of meat the rollers swallow (standard donor ~63 kg ≈ 1.9 s)
      dps: 140,                // grind damage on held parts (severs them from the rest)
      convertTime: 1.5,        // s over which a swallowed part's blood comes out (100 % yield)
      clogMass: 85,            // kg held in the mouth at once that jams the rollers (1 donor ok, 2 or a Big Giver jam)
      clearBoost: 3.0,         // chew-rate multiplier after a slam clears a jam (cannot re-jam meanwhile)
      clearBoostTime: 2.5,
      maxHeld: 14,
    },
    crusher: {
      width: 2.6,              // plate size along the wall (m)
      plate: 0.35,             // plate thickness (m)
      period: 5.5,             // s per cycle
      telegraph: 1.1,          // s of light + hiss before the stroke
      extendTime: 0.22,        // s stroke out
      holdTime: 0.45,          // s held at full extension
      retractTime: 1.3,        // s back in
      gap: 0.32,               // m left between the plate and the opposite wall at full stroke
      pressDamage: 420,        // hp dealt to every part caught in the closing gap ('press': bursts)
      pressBurst: 0.55,        // fraction of a pressed part's blood released instantly
      punch: 9.0,              // m/s given to parts the plate hits mid-stroke
      punchDamage: 25,
    },
  },

  // ---- donor types (CONTENT) — multipliers on TUNABLES.donor --------------------------------
  donorTypes: {
    bigGiver: { scale: 1.3, massScale: 2.5, bloodScale: 2.0, hpScale: 1.7, slamScale: 0.45, upright: 3.5, crushBonus: 2.2 },
    thinBlood: { bloodScale: 0.9, hpScale: 0.8, bleedScale: 3.0, clotScale: 0 },
    inspector: { hpScale: 1.0, fine: 25, bonus: 20 },
  },

  // ---- props (CONTENT) ----------------------------------------------------------------------
  props: {
    safetySphere: {
      radius: 1.0,
      mass: 90,
      hits: 3,                 // hazard hits to shatter (cracks at each hit before that)
      hitCooldown: 0.5,        // s: one continuous saw contact counts once per this interval
      buoyancy: 1.6,           // air-filled: floats high
      friction: 0.25, restitution: 0.35,
      walkTorque: 26,          // the Inspector "walks" his sphere: rolling torque (N·m)
      walkSpeed: 2.6,          // m/s target rolling speed along the current down-wall
      impactCrack: 21,         // m/s impact speed that also counts as a hit (very hard slams only)
      slamScale: 0.35,         // heavy ball: a SLAM lifts it < 1 m (flipping the drum drops it from height)
    },
    oxygenTank: {
      radius: 0.2, halfLength: 0.5, mass: 16,
      punctureImpact: 18,      // m/s impact that punctures (> a slam bounce: tanks are not a slam-spam toy)
      rocketTime: 2.0,         // s of thrust before it explodes
      thrust: 34,              // m/s^2 along the tank axis while rocketing
      wobble: 6,               // random torque while rocketing
      chainFuse: 0.3,          // s: a tank punctured by an explosion goes off this much later
      radius_explosion: 3.6,   // m
      damage: 190,             // hp at the centre (falls off linearly)
      impulse: 15,             // m/s at the centre (radial)
      sphereHits: 2,           // safety-sphere hits dealt by a blast in range
    },
  },

  levels: {
    defaultCapacity: 160,      // L that would fill the whole drum cross-section
    spawnInterval: 0.45,       // s between donors leaving the hatch
    waveWarning: 1.0,          // s between wave:incoming and hatch:open
    clearDelay: 2.5,           // s the drum must be clear before the next wave is brought forward
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
