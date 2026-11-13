// Audio engine: owns the AudioContext, the mix graph, the bank, voices, loops and music.
//
// Graph:
//   class buses (world) -> worldIn -> worldGain -> worldLP --\
//   class buses (ui)    -> uiGain ---------------------------+-> sfxUser --\
//   class sends -> reverbIn -> Convolver -> reverbOut ------/              +-> mixSum -> glue comp
//   music: notes -> instrument buses -> degrade chain -> duck -> screen -> music level -> musicUser -/
//   mixSum -> glue compressor -> limiter -> trim -> soft clipper -> masterUser -> destination
import { Bank } from './bank.js';
import { Voices } from './voices.js';
import { Loops } from './loops.js';
import { Music } from './music.js';
import { CLASSES, BUS, SCREENS, TRIM_DB } from './mix.js';
import { makeRng, clamp } from './dsp.js';
import { makeHandlers } from './events.js';

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// Order in which the bank warms up in the background (most urgent first).
const WARM_ORDER = [
  'mi_ep', 'mi_bass', 'mi_vib', 'md_shaker', 'md_brush', 'uiHover', 'uiClick', 'uiBack', 'lpNoise', 'lpPatter', 'lpGrind', 'lpAlarm',
  'mi_flute', 'md_rim', 'md_kick', 'jingleStart', 'paCalm', 'paSpeech', 'squelch', 'splat', 'thud', 'crack', 'vHurt', 'vDeath', 'vSpawn',
  'slam', 'hatch', 'intakeBell', 'shunk', 'sawCut', 'splash', 'splatBig', 'rip', 'spurt',
];

export class Engine {
  constructor(opts = {}) {
    this.opts = opts;
    this.ctx = null;
    this.ready = false;
    this.owned = false;
    this.offline = false;
    this.vol = { master: 1, music: 1, sfx: 1 };
    this.rnd = makeRng(opts.seed ?? ((Date.now() ^ 0x5eed) >>> 0));
    this.duck = 0;
    this.patter = 0;
    this.pf = 1;
    this.screen = 'menu';
    this.pausedHint = false;
    this.handlers = makeHandlers(this);
    this.trims = {};
    for (const [k, v] of Object.entries(TRIM_DB)) this.trims[k] = Math.pow(10, v / 20);
    this.errors = 0;
    this.errorLog = [];
    this.timing = { events: 0, eventMs: 0, eventMaxMs: 0, updates: 0, updateMs: 0, updateMaxMs: 0 };
  }

  /** Create (or adopt) the AudioContext and build the graph. Safe to call repeatedly. */
  init() {
    if (this.ready) return true;
    let ctx = this.opts.context || null;
    if (!ctx) {
      const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
      if (!AC) return false;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { return false; } }
      this.owned = true;
    }
    this.ctx = ctx;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.hasPanner = typeof ctx.createStereoPanner === 'function';
    this.build();
    this.ready = true;
    return true;
  }

  build() {
    const ctx = this.ctx;
    const G = (v, dst) => { const g = ctx.createGain(); g.gain.value = v; if (dst) g.connect(dst); return g; };

    // master chain
    this.masterUser = G(this.vol.master * this.vol.master, ctx.destination);
    this.output = this.masterUser;
    const clip = ctx.createWaveShaper();
    clip.curve = makeSoftClip();
    clip.oversample = 'none';
    clip.connect(this.masterUser);
    const clipIn = G(0.5, clip); // curve spans ±2.0 of real signal
    this.trim = G(1, clipIn);
    this.limiter = ctx.createDynamicsCompressor();
    setComp(this.limiter, -3, 0, 20, 0.001, 0.08);
    this.limiter.connect(this.trim);
    this.glue = ctx.createDynamicsCompressor();
    setComp(this.glue, GLUE.thr, 0, GLUE.ratio, 0.005, 0.25);
    this.glue.connect(this.limiter);
    // WebAudio compressors add automatic make-up gain (spec formula, verified in Chromium for
    // hard-knee settings). Compensate so the master chain is unity below threshold.
    this.trim.gain.value = makeupComp(GLUE.thr, GLUE.ratio) * makeupComp(-3, 20);
    this.mixSum = G(1, this.glue);

    // sfx
    this.sfxUser = G(this.vol.sfx * this.vol.sfx, this.mixSum);
    this.worldLP = ctx.createBiquadFilter();
    this.worldLP.type = 'lowpass'; this.worldLP.frequency.value = 20000; this.worldLP.Q.value = 0.7;
    this.worldLP.connect(this.sfxUser);
    this.worldGain = G(BUS.world, this.worldLP);
    this.worldIn = G(1, this.worldGain);
    this.uiGain = G(BUS.ui, this.sfxUser);

    // reverb (generated tiled-room impulse response)
    this.reverbIn = G(1, null);
    try {
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(ctx, 1.3, this.rnd);
      this.reverbIn.connect(conv);
      conv.connect(G(BUS.reverb, this.sfxUser));
      this.conv = conv;
    } catch (e) { /* no reverb */ }

    // slow-mo pitch bus for world one-shots
    this.sfxDetune = null;
    if (ctx.createConstantSource) {
      const cs = ctx.createConstantSource();
      cs.offset.value = 0;
      cs.start();
      this.sfxDetuneSrc = cs;
      this.sfxDetune = G(1, null);
      cs.connect(this.sfxDetune);
    }

    // classes
    this.classes = {};
    for (const [name, c] of Object.entries(CLASSES)) {
      const bus = G(c.gain, c.bus === 'ui' ? this.uiGain : this.worldIn);
      if (c.reverb > 0) bus.connect(G(c.reverb, this.reverbIn));
      this.classes[name] = { ...c, name, busName: c.bus, bus, voices: [], tokens: c.burst, refillAt: 0, frameAt: -1, frameN: 0 };
    }

    this.bank = new Bank(ctx, this.rnd, this.opts.seed ?? 1);
    this.bank.enqueueAll(WARM_ORDER);
    this.voices = new Voices(this, BUS.maxVoices);

    // music
    this.musicUser = G(this.vol.music * this.vol.music, this.mixSum);
    this.music = new Music(this, this.musicUser);
    this.music.start();

    // loops (need a few small buffers rendered now)
    this.loops = new Loops(this);
    this.loops.start();
  }

  /** Is it worth producing sound right now? */
  live() {
    if (!this.ready) return false;
    if (this.offline) return true;
    return this.ctx.state === 'running';
  }

  play(cls, name, o) {
    if (!this.live()) return null;
    return this.voices.play(cls, name, o);
  }

  duckMusic(a) { this.duck = Math.max(this.duck, clamp(a, 0, 1)); }

  onEvent(type, payload) {
    if (!this.live()) return;
    const h = this.handlers[type];
    if (!h) return;
    const t0 = nowMs();
    try { h(payload && typeof payload === 'object' ? payload : {}); } catch (e) { this.fail(type, e); }
    const ms = nowMs() - t0;
    const T = this.timing;
    T.events++; T.eventMs += ms; if (ms > T.eventMaxMs) T.eventMaxMs = ms;
  }

  update(dt, state) {
    if (!this.ready) return;
    const t0 = nowMs();
    const st = state && typeof state === 'object' ? state : {};
    dt = clamp(Number(dt) || 0, 0, 0.25);
    const ctx = this.ctx;
    const now = ctx.currentTime;
    let screen = st.screen || (this.pausedHint ? 'paused' : this.screen);
    if (!SCREENS[screen]) screen = 'menu';
    this.screen = screen;
    const playing = screen === 'playing';

    // time scale -> pitch factor (hit-stop freezes below 0.1 are ignored)
    const ts = Number(st.timeScale);
    if (Number.isFinite(ts) && ts >= 0.1) {
      const target = Math.pow(clamp(ts, 0.2, 2), 0.5);
      this.pf += (target - this.pf) * (1 - Math.exp(-dt / 0.05));
    }
    const pf = this.pf;
    if (this.sfxDetune) this.sfxDetuneSrc.offset.setTargetAtTime(1200 * Math.log2(pf), now, 0.03);

    // screen mix for world SFX (pause = quiet + muffled; slow-mo = slightly darker)
    const S = SCREENS[screen];
    this.worldGain.gain.setTargetAtTime(S.world * BUS.world, now, 0.08);
    this.worldLP.frequency.setTargetAtTime(Math.min(S.worldLp, pf < 0.98 ? 3000 + 17000 * Math.pow(pf, 4) : 20000), now, 0.05);

    // music ducking
    this.duck *= Math.exp(-dt / 0.45);
    this.music.duck.gain.setTargetAtTime(1 - 0.6 * this.duck, now, this.duck > 0.05 ? 0.03 : 0.2);

    // patter pressure decays (~0.35 s)
    this.patter = Number.isFinite(this.patter) ? Math.min(1000, this.patter * Math.exp(-dt / 0.35)) : 0;

    // when not running (suspended/locked) keep the bookkeeping light
    if (this.live()) {
      this.loops.update(dt, st, pf, playing, this.patter);
      this.music.update(dt, st, pf, screen, this.vol.music > 0.001);
    }
    this.voices.sweep(now);
    this.music.sweep(now);

    // background bank warm-up. Outside gameplay (boot splash press -> title -> briefing) it runs in
    // its own macrotasks, ~8 ms at a time between frames, so the whole bank (~1-1.4 s of CPU) is
    // done while the player is still in the menus; during play only a 1.5 ms per-frame trickle.
    if (this.bank.queue.length) {
      if (this.offline) this.bank.warm(1000);
      else if (playing) this.bank.warm(1.5);
      else this.startIdleWarm();
    }

    const ms = nowMs() - t0;
    const T = this.timing;
    T.updates++; T.updateMs += ms; if (ms > T.updateMaxMs) T.updateMaxMs = ms;
  }

  startIdleWarm() {
    if (this.idleWarm || typeof setTimeout !== 'function') return;
    this.idleWarm = true;
    const step = () => {
      this.idleWarm = false;
      if (!this.ready || !this.bank || !this.bank.queue.length || this.screen === 'playing') return;
      if (this.warmStartMs == null) this.warmStartMs = nowMs();
      try { this.bank.warm(8); } catch (e) { this.fail('warm', e); this.bank.queue.length = 0; }
      if (!this.bank.queue.length) { this.warmDoneMs = nowMs(); return; }
      this.idleWarm = true;
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  setVolume(kind, v) {
    v = clamp(Number(v), 0, 1);
    if (!Number.isFinite(v)) return;
    if (!(kind in this.vol)) return;
    this.vol[kind] = v;
    if (!this.ready) return;
    const g = v * v; // perceptual-ish taper
    const node = kind === 'master' ? this.masterUser : kind === 'music' ? this.musicUser : this.sfxUser;
    node.gain.setTargetAtTime(g, this.ctx.currentTime, 0.03);
  }

  fail(where, e) {
    this.errors++;
    if (this.errorLog.length < 20) this.errorLog.push(where + ': ' + (e && e.message ? e.message : String(e)));
    if (this.errors <= 5 && typeof console !== 'undefined') console.warn('[audio]', where, e);
  }

  stats() {
    const v = this.voices;
    return {
      ready: this.ready,
      state: this.ctx ? this.ctx.state : 'none',
      voices: v ? v.count() : 0,
      dying: v ? v.dying.size : 0,
      voiceNodes: v ? v.nodesLive : 0,
      musicNodes: this.music ? this.music.nodesLive : 0,
      musicNotes: this.music ? this.music.notes : 0,
      voiceStats: v ? { ...v.stats } : null,
      bankRendered: this.bank ? this.bank.cache.size : 0,
      bankQueue: this.bank ? this.bank.queue.length : 0,
      bankRenderMs: this.bank ? this.bank.renderMs : 0,
      bankMaxRenderMs: this.bank ? this.bank.maxRenderMs : 0,
      bankWarmWallMs: this.warmDoneMs != null && this.warmStartMs != null ? this.warmDoneMs - this.warmStartMs : null,
      timing: { ...this.timing },
      errors: this.errors,
      errorLog: this.errorLog.slice(),
      duck: this.duck,
      pf: this.pf,
      deg: this.music ? this.music.deg : 0,
    };
  }

  dispose() {
    if (!this.ready) return;
    this.ready = false;
    try { this.voices.stopAll(); } catch (e) { /* noop */ }
    try { this.music.stop(); } catch (e) { /* noop */ }
    try { this.loops.stop(); } catch (e) { /* noop */ }
    try { if (this.sfxDetuneSrc) this.sfxDetuneSrc.stop(); } catch (e) { /* noop */ }
    try { this.masterUser.disconnect(); } catch (e) { /* noop */ }
    if (this.owned && this.ctx && this.ctx.close) this.ctx.close().catch(() => {});
  }
}

const GLUE = { thr: -12, ratio: 2.5 };

/** Inverse of the WebAudio spec's automatic make-up gain for a hard-knee compressor. */
function makeupComp(thr, ratio) {
  const fullRangeDb = thr + (0 - thr) / ratio; // output level for a 0 dBFS input
  return 1 / Math.pow(1 / Math.pow(10, fullRangeDb / 20), 0.6);
}

function setComp(c, thr, knee, ratio, att, rel) {
  c.threshold.value = thr; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = att; c.release.value = rel;
}

/** Soft clip over input ±1 (= real ±2 after the 0.5 pre-gain): linear to 0.8, then tanh into 0.99. */
function makeSoftClip() {
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const z = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(z);
    const y = a < 0.8 ? a : 0.8 + 0.19 * Math.tanh((a - 0.8) / 0.19);
    c[i] = Math.sign(z) * y;
  }
  return c;
}

/** Stereo impulse response for a hard tiled room: early reflections + darkening exponential tail. */
function makeImpulse(ctx, seconds, rnd) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const a = 1 - Math.exp(-(2 * Math.PI * (9000 * Math.exp(-t * 2.2) + 600)) / sr);
      lp += a * (rnd() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t * 5.2) * Math.min(1, t / 0.012) * 0.6;
    }
    for (let k = 0; k < 10; k++) {
      const i = Math.floor((0.004 + rnd() * 0.05) * sr);
      d[i] += (rnd() < 0.5 ? -1 : 1) * (0.5 - k * 0.04);
    }
  }
  return b;
}
