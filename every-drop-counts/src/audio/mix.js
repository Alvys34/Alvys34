// Mix table: every level and voice limit in one place. Tune here, by meters (tools/audio).
//
// Sound classes (voice groups). Each class has its own bus (GainNode) with a reverb send.
//   gain   class bus gain (linear) — buffers are rendered normalised to 0.9 peak
//   max    max simultaneous voices in the class (oldest is stolen)
//   burst  token-bucket size: how many may start in the same instant
//   rate   token refill per second: sustained starts/second allowed
//   prio   0..9, used when the global voice cap is hit (lower is stolen first)
//   reverb send level into the shared room reverb
//   pitch  random pitch spread in semitones (± this)
export const CLASSES = {
  // --- gore (the heart of the game: prominent) ---
  squelch: { bus: 'world', gain: 0.634, max: 6, burst: 4, rate: 14, prio: 6, reverb: 0.12, pitch: 2.5 },
  splat:   { bus: 'world', gain: 0.189, max: 6, burst: 3, rate: 30, prio: 1, reverb: 0.1, pitch: 4 },
  splash:  { bus: 'world', gain: 0.357, max: 4, burst: 3, rate: 10, prio: 3, reverb: 0.16, pitch: 3 },
  spurt:   { bus: 'world', gain: 0.318, max: 3, burst: 2, rate: 4, prio: 4, reverb: 0.1, pitch: 2 },
  bone:    { bus: 'world', gain: 0.449, max: 5, burst: 4, rate: 16, prio: 6, reverb: 0.14, pitch: 3 },
  tear:    { bus: 'world', gain: 0.449, max: 3, burst: 3, rate: 8, prio: 5, reverb: 0.1, pitch: 2 },
  thud:    { bus: 'world', gain: 0.565, max: 6, burst: 4, rate: 20, prio: 3, reverb: 0.1, pitch: 2 },
  // --- other impacts ---
  metal:   { bus: 'world', gain: 0.283, max: 4, burst: 2, rate: 10, prio: 2, reverb: 0.2, pitch: 2 },
  glass:   { bus: 'world', gain: 0.424, max: 4, burst: 2, rate: 10, prio: 2, reverb: 0.2, pitch: 3 },
  prop:    { bus: 'world', gain: 0.212, max: 4, burst: 2, rate: 12, prio: 2, reverb: 0.12, pitch: 3 },
  // --- machinery ---
  hazard:  { bus: 'world', gain: 0.634, max: 5, burst: 3, rate: 10, prio: 5, reverb: 0.12, pitch: 1.5 },
  machine: { bus: 'world', gain: 0.449, max: 6, burst: 4, rate: 20, prio: 8, reverb: 0.2, pitch: 0.5 },
  boom:    { bus: 'world', gain: 1.128, max: 3, burst: 2, rate: 4, prio: 9, reverb: 0.3, pitch: 1.5 },
  rocket:  { bus: 'world', gain: 0.424, max: 3, burst: 3, rate: 6, prio: 7, reverb: 0.15, pitch: 1 },
  // --- donors ---
  vocal:   { bus: 'world', gain: 0.4, max: 5, burst: 3, rate: 8, prio: 5, reverb: 0.12, pitch: 1.2 },
  // --- UI / feedback (not affected by pause/slow-mo) ---
  ui:      { bus: 'ui', gain: 0.142, max: 4, burst: 3, rate: 30, prio: 7, reverb: 0, pitch: 0.2 },
  pa:      { bus: 'ui', gain: 0.449, max: 3, burst: 2, rate: 3, prio: 8, reverb: 0.3, pitch: 0 },
  stinger: { bus: 'ui', gain: 0.504, max: 6, burst: 4, rate: 10, prio: 8, reverb: 0.12, pitch: 0 },
};

// Continuous loops (peak-ish gain at full drive).
export const LOOP_LEVELS = {
  motor: 0.3,
  saw: 0.3,
  grinder: 0.32,
  slosh: 0.3,
  patter: 0.22,
  hum: 0.02,
  alarm: 0.05,
};

// Buses.
export const BUS = {
  music: 0.34, // music sits under SFX
  world: 1.0,
  ui: 0.9,
  reverb: 0.45, // reverb return
  maxVoices: 48, // global one-shot cap
};

// Music duck depth per trigger (0..1 of the duck range; music drops by up to ~-8 dB).
export const DUCK = {
  slam: 0.5,
  explosion: 0.8,
  death: 0.2,
  massDeath: 0.5,
  jingle: 0.7,
  pa: 0.35,
  shatter: 0.4,
};

// Screen presets: world SFX gain/lowpass and music gain/lowpass.
export const SCREENS = {
  menu: { world: 1, worldLp: 20000, music: 1.0, musicLp: 20000 },
  playing: { world: 1, worldLp: 20000, music: 0.55, musicLp: 20000 },
  paused: { world: 0.35, worldLp: 700, music: 0.35, musicLp: 650 },
  results: { world: 1, worldLp: 20000, music: 0.9, musicLp: 20000 },
};

// Per-sound faders in dB (applied on top of the class gain and the event's own gain).
// Set by metering (tools/audio/run.mjs) so each sound lands near its target momentary level.
export const TRIM_DB = {
  splat: -2.5, splatBig: 2.5, tink: -4.5, glassShatter: 5.5, crushHit: 3, slam: 8.5, slamReady: -9, intakeBell: -4, crusherTelegraph: 0.5, warnBeep: -4, motorStart: -6, rocket: 0.5, puncture: -0.5, vSpawn: -1, vDeath: 1, vSigh: -2, uiHover: -4, paUrgent: 1, paSpeech: -2, paSpeechGlitch: -2, comboRiser: -3, star3: -1, tick: -10, tickUrgent: -7, jingleStart: 1.5, jingleComplete: 1.5, jingleTimeout: 1.5, jingleFailed: 1, squelch: 1, crack: 1, rip: 1, sawCut: 1.5, shunk: 0.5, grindCrunch: 2.5, explosion: 2, glassCrack: 1,
};
