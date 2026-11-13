// Procedural elevator-muzak bossa nova ("Hold Music No. 4 in F, for Donation Floor").
// A 16-bar AABA-ish tune with real chords, bossa bass, comping, melody and light percussion,
// in three arrangements (menu / shift / results). It degrades with `fill`: tape wow & flutter,
// detuned and sour notes, tempo sag & wobble, dropouts, distortion, bit-crush, low-pass, and
// occasional tape-stop dives. Respects timeScale (pitch & tempo) and screen (pause = muffled).
import { INSTRUMENT_BASES } from './sounds/instruments.js';
import { clamp, smoothstep, lerp } from './dsp.js';
import { SCREENS, BUS } from './mix.js';

const C = (root, ...v) => ({ root, v });
// Key of F. Rootless jazz voicings around middle C; bass roots in octave 2.
const CHORDS = [
  [C(41, 57, 60, 64, 67)], // Fmaj9
  [C(38, 53, 57, 60, 64)], // Dm9
  [C(43, 58, 62, 65, 69)], // Gm9
  [C(36, 58, 62, 64, 69)], // C13
  [C(45, 55, 57, 60, 64)], // Am7
  [C(38, 54, 57, 60, 63)], // D7b9
  [C(43, 58, 62, 65, 69)], // Gm9
  [C(36, 52, 58, 62, 67)], // C9
  [C(46, 57, 60, 62, 65)], // Bbmaj9
  [C(39, 55, 61, 65, 70)], // Eb9
  [C(45, 55, 60, 64, 67)], // Am7
  [C(38, 54, 60, 64, 69)], // D9
  [C(43, 53, 58, 62, 65)], // Gm7
  [C(36, 52, 58, 62, 67)], // C9
  [C(41, 52, 57, 60, 65)], // Fmaj7
  [C(43, 53, 58, 62, 65), C(36, 52, 58, 62, 67)], // Gm7 | C9
];
// Melody: [16th step, midi, length in 16ths]
const MELODY = [
  [[0, 69, 6], [6, 72, 2], [8, 76, 8]],
  [[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4]],
  [[0, 70, 6], [6, 74, 2], [8, 77, 8]],
  [[0, 76, 4], [4, 74, 2], [6, 72, 2], [8, 70, 6], [14, 67, 2]],
  [[0, 72, 6], [6, 76, 2], [8, 79, 8]],
  [[0, 78, 4], [4, 75, 4], [8, 74, 4], [12, 72, 4]],
  [[0, 70, 6], [6, 69, 2], [8, 70, 2], [10, 74, 6]],
  [[0, 72, 8], [10, 70, 2], [12, 67, 4]],
  [[0, 74, 6], [6, 77, 2], [8, 81, 8]],
  [[0, 79, 4], [4, 77, 4], [8, 73, 8]],
  [[0, 72, 6], [6, 76, 2], [8, 79, 4], [12, 76, 4]],
  [[0, 74, 4], [4, 78, 4], [8, 81, 8]],
  [[0, 77, 6], [6, 74, 2], [8, 70, 8]],
  [[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 70, 4]],
  [[0, 69, 12]],
  [[0, 67, 4], [4, 69, 4], [8, 70, 4], [12, 72, 4]],
];
// Bass: [step, interval from root, length]
const BASS_BOSSA = [[0, 0, 5], [6, 7, 2], [8, 7, 5], [14, 0, 2]];
const BASS_MENU = [[0, 0, 7], [8, 7, 7]];
const COMP_BOSSA = [[0, 3, 6, 10, 13], [2, 5, 8, 11, 14]];
const COMP_MENU = [[0], [0, 10]];
const RIM = [3, 6, 10, 13];
const KICK = [0, 6, 8, 14];
const CONGA = [[2, 0], [7, 1], [10, 0], [12, 1], [15, 1]];

const ARR = {
  menu: { bpm: 90, bass: BASS_MENU, comp: COMP_MENU, compLen: 12, compVel: 0.32, melody: 'vib', melVel: 0.32, shaker: 2, brush: true, rim: false, kick: false },
  shift: { bpm: 108, bass: BASS_BOSSA, comp: COMP_BOSSA, compLen: 2, compVel: 0.3, melody: 'mixed', melVel: 0.36, shaker: 1, brush: false, rim: true, kick: true, layers: true },
  results: { bpm: 84, bass: BASS_MENU, comp: COMP_MENU, compLen: 12, compVel: 0.3, melody: 'vib', melVel: 0.28, shaker: 0, brush: false, rim: false, kick: false },
};

// Instrument bus levels and pans.
const INST = {
  ep: { gain: 0.55, pan: -0.25 },
  bass: { gain: 0.9, pan: 0 },
  vib: { gain: 0.5, pan: 0.3 },
  flute: { gain: 0.38, pan: 0.2 },
  pad: { gain: 0.22, pan: 0 },
  shaker: { gain: 0.16, pan: 0.45 },
  rim: { gain: 0.22, pan: -0.35 },
  kick: { gain: 0.5, pan: 0 },
  brush: { gain: 0.12, pan: 0.15 },
  conga: { gain: 0.28, pan: -0.5 },
  hat: { gain: 0.1, pan: 0.55 },
};
const BUF = { ep: 'mi_ep', bass: 'mi_bass', vib: 'mi_vib', flute: 'mi_flute', pad: 'mi_pad', shaker: 'md_shaker', rim: 'md_rim', kick: 'md_kick', brush: 'md_brush', conga: 'md_conga', hat: 'md_hat' };

export class Music {
  constructor(eng, dest) {
    this.eng = eng;
    const ctx = (this.ctx = eng.ctx);
    const G = (v, dst) => { const g = ctx.createGain(); g.gain.value = v; if (dst) g.connect(dst); return g; };
    const F = (type, f, q, dst) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (dst) b.connect(dst); return b; };

    // output chain (built back to front)
    this.out = G(BUS.music, dest); // music level (× user volume set by engine)
    this.screenLP = F('lowpass', 20000, 0.7, this.out);
    this.screenGain = G(1, this.screenLP);
    this.duck = G(1, this.screenGain);
    this.degLP = F('lowpass', 18000, 0.7, this.duck);
    this.dry = G(1, this.degLP);
    // bit-crush: input gain sets the effective bit depth of a fixed staircase curve
    this.crushOut = G(0, this.degLP);
    this.crushShaper = ctx.createWaveShaper();
    this.crushShaper.curve = makeStair(32);
    this.crushShaper.connect(this.crushOut);
    this.crushIn = G(1, this.crushShaper);
    // tape/tube distortion
    this.distOut = G(0, this.degLP);
    this.distShaper = ctx.createWaveShaper();
    this.distShaper.curve = makeTanh(3);
    this.distShaper.oversample = '2x';
    this.distShaper.connect(this.distOut);
    this.distIn = G(0.5, this.distShaper);
    // ceiling-speaker band
    this.spkLP = F('lowpass', 12000, 0.6, null);
    this.spkHP = F('highpass', 90, 0.7, this.spkLP);
    for (const d of [this.dry, this.crushIn, this.distIn]) this.spkLP.connect(d);
    this.input = this.spkHP;

    // instrument buses
    this.inst = {};
    for (const [k, c] of Object.entries(INST)) {
      const g = G(c.gain, null);
      if (eng.hasPanner) { const p = ctx.createStereoPanner(); p.pan.value = c.pan; g.connect(p); p.connect(this.input); } else g.connect(this.input);
      this.inst[k] = g;
    }

    // shared detune bus: timeScale + wow + flutter + drift + tape-stop dives -> every note's detune
    this.detune = null;
    this.srcs = [];
    if (ctx.createConstantSource) {
      this.detune = G(1, null);
      this.tsConst = ctx.createConstantSource(); this.tsConst.offset.value = 0; this.tsConst.connect(this.detune);
      this.glitch = ctx.createConstantSource(); this.glitch.offset.value = 0; this.glitch.connect(this.detune);
      const lfo = (f, depth) => { const o = ctx.createOscillator(); o.frequency.value = f; const g = G(depth, this.detune); o.connect(g); this.srcs.push(o); return g; };
      this.wowG = lfo(0.55, 3);
      this.flutG = lfo(6.3, 0.5);
      this.driftG = lfo(0.13, 0);
      this.srcs.push(this.tsConst, this.glitch);
    }

    this.arrName = null;
    this.bar = 0;
    this.step = 0;
    this.nextT = 0;
    this.resumeAt = 0;
    this.deg = 0; // smoothed fill
    this.int = 0; // smoothed intensity
    this.pf = 1;
    this.live = new Set();
    this.gpool = {};
    this.nodesLive = 0;
    this.notes = 0;
    this.lastScreen = null;
  }

  start() {
    const t = this.ctx.currentTime;
    for (const s of this.srcs) { try { s.start(t); } catch (e) { /* noop */ } }
  }

  /** Switch arrangement, restarting the tune at bar 0 no earlier than `at`. */
  setArrangement(name, at = 0) {
    if (!ARR[name]) return;
    this.arrName = name;
    this.bar = 0;
    this.step = 0;
    this.resumeAt = Math.max(at, this.ctx.currentTime + 0.05);
    this.nextT = this.resumeAt;
  }

  /** Silence new notes until `t` (e.g. while a jingle plays). */
  holdUntil(t, thenArr) {
    this.resumeAt = Math.max(this.resumeAt, t);
    this.pendingArr = thenArr || null;
  }

  update(dt, st, pf, screen, musicOn) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const k = (tau) => 1 - Math.exp(-dt / tau);
    const fill = clamp(Number(st.fill) || 0, 0, 1);
    // degrade follows fill smoothly; on the menu it relaxes back to clean
    const degTarget = screen === 'menu' ? 0 : fill;
    this.deg += (degTarget - this.deg) * k(degTarget < this.deg && screen === 'menu' ? 0.5 : 1.5);
    this.int += (clamp(Number(st.intensity) || 0, 0, 1) - this.int) * k(1.0);
    this.pf = pf;
    const f = this.deg;

    // arrangement follows the screen
    if (screen !== this.lastScreen) {
      if (screen === 'menu') this.setArrangement('menu', now + 0.3);
      else if (screen === 'playing' && this.arrName !== 'shift') this.setArrangement('shift', Math.max(now + 0.1, this.resumeAt));
      else if (screen === 'results' && this.arrName !== 'results') this.setArrangement('results', Math.max(now + 0.2, this.resumeAt));
      this.lastScreen = screen;
    }
    if (!this.arrName) this.setArrangement(screen === 'playing' ? 'shift' : 'menu', now + 0.2);

    // screen mix
    const S = SCREENS[screen] || SCREENS.menu;
    this.screenGain.gain.setTargetAtTime(S.music, now, 0.12);
    this.screenLP.frequency.setTargetAtTime(S.musicLp, now, 0.08);

    // degradation chain
    const wetC = smoothstep(0.35, 0.9, f) * 0.8;
    const crushG = lerp(1, 0.1, smoothstep(0.35, 1, f));
    const wetD = smoothstep(0.15, 0.8, f) * 0.7;
    this.crushIn.gain.setTargetAtTime(crushG, now, 0.1);
    this.crushOut.gain.setTargetAtTime(wetC / crushG, now, 0.1);
    this.distIn.gain.setTargetAtTime(0.4 + 3.2 * f, now, 0.1);
    this.distOut.gain.setTargetAtTime(wetD / (1 + 2.5 * f), now, 0.1);
    this.dry.gain.setTargetAtTime(1 - 0.75 * Math.max(wetC, wetD), now, 0.1);
    this.degLP.frequency.setTargetAtTime(18000 * Math.pow(2, -4.7 * Math.pow(f, 1.2)), now, 0.1);
    this.degLP.Q.setTargetAtTime(0.7 + 2.2 * f * f, now, 0.1);
    this.spkHP.frequency.setTargetAtTime(90 + 300 * f * f, now, 0.2);
    if (this.detune) {
      this.tsConst.offset.setTargetAtTime(1200 * Math.log2(pf), now, 0.04);
      this.wowG.gain.setTargetAtTime(3 + 60 * Math.pow(f, 1.5), now, 0.2);
      this.flutG.gain.setTargetAtTime(0.5 + 22 * f * f, now, 0.2);
      this.driftG.gain.setTargetAtTime(35 * f * f, now, 0.3);
    }

    // sequencer (lookahead scheduling)
    if (this.nextT < now - 0.25) this.nextT = Math.max(now + 0.05, this.resumeAt); // after stalls
    const horizon = now + 0.2;
    let guard = 0;
    while (this.nextT < horizon && guard++ < 64) {
      const A = ARR[this.arrName];
      const bpm = A.bpm * (1 - 0.13 * f) * (1 + 0.06 * f * Math.sin((this.nextT * 2 * Math.PI) / 6.3)) * pf;
      const stepDur = 60 / bpm / 4;
      if (this.nextT >= this.resumeAt) {
        if (this.pendingArr) { const p = this.pendingArr; this.pendingArr = null; this.setArrangement(p, this.nextT); continue; }
        if (musicOn) this.scheduleStep(A, this.bar, this.step, this.nextT, stepDur);
        this.step++;
        if (this.step >= 16) { this.step = 0; this.bar = (this.bar + 1) % 16; }
      }
      const jitter = (this.eng.rnd() * 2 - 1) * (0.002 + 0.03 * f * f);
      this.nextT += Math.max(0.03, stepDur + jitter);
    }
  }

  scheduleStep(A, bar, step, t, sd) {
    const rnd = this.eng.rnd;
    const f = this.deg;
    const it = A.layers ? this.int : 0;
    const halves = CHORDS[bar];
    const chord = halves.length > 1 && step >= 8 ? halves[1] : halves[0];
    const hv = (v) => v * (0.88 + 0.24 * rnd());

    // tape-stop dive now and then when the room is nearly full
    if (step === 0 && this.detune && f > 0.65 && rnd() < 0.25 * (f - 0.65) / 0.35) {
      const g = this.glitch.offset, d = -300 - 900 * rnd();
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(d, t + 0.35 + rnd() * 0.3);
      g.linearRampToValueAtTime(0, t + 0.9);
    }

    // bass
    for (const [s, iv, len] of A.bass) {
      if (s !== step) continue;
      this.note('bass', chord.root + iv, t, len * sd * 0.9, hv(0.8), 0.25 * f * f);
    }
    // comping
    const cp = A.comp[bar % 2];
    if (cp.includes(step)) {
      const len = A.compLen * sd;
      for (const n of chord.v) this.note('ep', n, t + rnd() * 0.012, len, hv(A.compVel), 0.35 * f * f);
    }
    // pad layer (intensity)
    if (it > 0.55 && (step === 0 || (halves.length > 1 && step === 8))) {
      const len = (halves.length > 1 ? 8 : 16) * sd;
      for (const n of chord.v) this.note('pad', n, t, len, 0.4 * smoothstep(0.55, 0.8, it), 0.3 * f * f, 0.4);
    }
    // melody
    for (const [s, m, len] of MELODY[bar]) {
      if (s !== step) continue;
      let inst = 'vib';
      if (A.melody === 'mixed' && bar >= 8 && bar < 14) inst = 'flute';
      this.note(inst, m, t, len * sd * 0.92, hv(A.melVel), 0.6 * f * f);
      if (A.layers && it > 0.85 && inst === 'vib') this.note('vib', m + 12, t, len * sd * 0.9, hv(A.melVel * 0.35), 0.6 * f * f);
    }
    // percussion
    if (A.shaker && step % A.shaker === 0) this.note('shaker', 60, t, 0.08, hv(step % 4 === 0 ? 0.9 : step % 2 === 0 ? 0.6 : 0.4), 0);
    if (A.brush && (step === 4 || step === 12)) this.note('brush', 60, t, 0.2, hv(0.8), 0);
    if (A.rim && RIM.includes(step)) this.note('rim', 60, t, 0.08, hv(0.8), 0);
    if (A.kick && KICK.includes(step)) this.note('kick', 60, t, 0.3, hv(step === 0 ? 0.9 : 0.55), 0);
    if (it > 0.3) for (const [s, v] of CONGA) if (s === step) this.note('conga', 60, t, 0.25, hv(0.8 * smoothstep(0.3, 0.5, it)), 0, 0, v);
    if (it > 0.75 && step % 4 === 2) this.note('hat', 60, t, 0.05, hv(0.7), 0);
  }

  /** Schedule one sampled note. sourP = chance of a sour (±1 semitone) note. */
  note(inst, midi, t, dur, vel, sourP, attack = 0, variant = null) {
    const ctx = this.ctx;
    const rnd = this.eng.rnd;
    const f = this.deg;
    if (f > 0.3 && rnd() < 0.22 * Math.pow(f, 3)) return; // tape dropouts
    let m = midi;
    if (sourP && rnd() < sourP) m += rnd() < 0.5 ? -1 : 1;
    const name = BUF[inst];
    const bases = INSTRUMENT_BASES[name];
    let v = variant ?? 0, base = 60;
    if (bases) {
      v = 0; base = bases[0];
      for (let i = 1; i < bases.length; i++) if (Math.abs(bases[i] - m) < Math.abs(base - m)) { v = i; base = bases[i]; }
    } else if (variant == null) {
      v = Math.floor(rnd() * this.eng.bank.variants(name));
    }
    const buffer = this.eng.bank.get(name, v);
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.pow(2, (m - base) / 12);
    src.detune.value = (rnd() * 2 - 1) * (2 + 45 * f * f);
    // pooled per-instrument note gains: only the BufferSource is created per note
    const pool = this.gpool[inst] || (this.gpool[inst] = []);
    let g = pool.pop();
    if (g) g.gain.cancelScheduledValues(0);
    else { g = ctx.createGain(); g.connect(this.inst[inst]); }
    g.gain.setValueAtTime(0, ctx.currentTime);
    const rel = inst === 'pad' ? 0.35 : inst === 'bass' ? 0.08 : 0.12;
    if (attack) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + attack); } else g.gain.setValueAtTime(vel, t);
    g.gain.setTargetAtTime(0, t + dur, rel);
    src.connect(g);
    if (this.detune) this.detune.connect(src.detune);
    const stopAt = Math.min(t + buffer.duration / src.playbackRate.value + 0.1, t + dur + rel * 6);
    const rec = { src, g, inst };
    src.onended = () => this.free(rec);
    src.start(t);
    src.stop(stopAt);
    rec.end = stopAt;
    this.live.add(rec);
    this.nodesLive += 2;
    this.notes++;
  }

  free(rec) {
    if (!this.live.has(rec)) return;
    this.live.delete(rec);
    this.nodesLive -= 2;
    try { if (this.detune) this.detune.disconnect(rec.src.detune); } catch (e) { /* noop */ }
    try { rec.src.disconnect(); } catch (e) { /* noop */ }
    rec.src.onended = null;
    const pool = this.gpool[rec.inst];
    if (pool.length < 24) pool.push(rec.g); else { try { rec.g.disconnect(); } catch (e) { /* noop */ } }
  }

  sweep(now) {
    for (const rec of this.live) if (now > rec.end + 3) { try { rec.src.stop(); } catch (e) { /* noop */ } this.free(rec); }
  }

  stop() {
    for (const rec of [...this.live]) { try { rec.src.stop(); } catch (e) { /* noop */ } this.free(rec); }
    for (const s of this.srcs) { try { s.stop(); } catch (e) { /* noop */ } }
    for (const k in this.gpool) for (const g of this.gpool[k]) { try { g.disconnect(); } catch (e) { /* noop */ } }
    this.gpool = {};
    try { this.out.disconnect(); } catch (e) { /* noop */ }
  }
}

function makeStair(levels) {
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * levels) / levels; }
  return c;
}
function makeTanh(drive) {
  const n = 2048, c = new Float32Array(n), k = Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / k; }
  return c;
}
