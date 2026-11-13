// Mix targets: momentary (max 100 ms RMS) level in dBFS at the master output for ONE event at
// event gain 1, user volumes at 1. `run.mjs --autotrim` solves TRIM_DB in src/audio/mix.js
// against these. Hierarchy: explosion/slam > gore > machines/feedback > vocals > ambience > UI.
export const TARGETS = {
  explosion: -13, slam: -14, crushHit: -16,
  squelch: -18, thud: -19, sawCut: -18, shunk: -18, grindCrunch: -18,
  crack: -21, rip: -22, splash: -23, spurt: -24, splatBig: -26, splat: -32,
  clang: -25, tink: -26, knock: -28,
  hatch: -21, intakeBell: -25, crusherTelegraph: -21, warnBeep: -25, grinderClog: -21, grinderClear: -21,
  motorStart: -27, slamReady: -30, rocket: -21, puncture: -22, glassCrack: -22, glassShatter: -18,
  vSpawn: -23, vHurt: -22, vDeath: -21, vDrown: -22, vSigh: -24,
  paCalm: -22, paUrgent: -21, paGlitch: -22, paSpeech: -24, paSpeechGlitch: -24,
  uiHover: -38, uiClick: -32, uiBack: -32, pauseOn: -32, pauseOff: -32,
  comboHit: -21, comboRiser: -24, register: -21, buzzer: -21, star: -21, star3: -22,
  tick: -32, tickUrgent: -28, achievement: -21,
  jingleStart: -20, jingleComplete: -20, jingleTimeout: -20, jingleFailed: -20,
};
