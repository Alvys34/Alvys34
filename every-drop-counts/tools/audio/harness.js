// Browser-side audio test harness. Loaded by test.html; driven by run.mjs through Playwright.
// Everything goes through the real createAudio() from src/audio.
import { createAudio, EVENT_NAMES } from '../../src/audio/index.js';

const SR = 44100;

export function makeBus() {
  const map = new Map();
  return {
    on(type, fn) { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); return () => map.get(type).delete(fn); },
    emit(type, payload) { const s = map.get(type); if (s) for (const fn of s) fn(payload); },
    count() { let n = 0; for (const s of map.values()) n += s.size; return n; },
  };
}

const baseState = (o = {}) => ({ screen: 'menu', fill: 0, drumOmega: 0, aliveCount: 0, sawLoad: 0, grinderLoad: 0, timeScale: 1, intensity: 0, ...o });

// ---------------------------------------------------------------- analysis
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j], ai = im[i + j];
        const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br; im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br; im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

/** Analyse a stereo AudioBuffer: peak, active RMS, max 100 ms RMS, duration, centroid, band energies. */
export function analyse(ab, from = 0) {
  const L = ab.getChannelData(0), R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L;
  const sr = ab.sampleRate;
  const s0 = Math.floor(from * sr);
  const n = L.length;
  const mono = new Float32Array(n - s0);
  let peak = 0;
  for (let i = s0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (a > peak) peak = a;
    mono[i - s0] = 0.5 * (L[i] + R[i]);
  }
  // 10 ms window RMS envelope
  const w = Math.floor(sr * 0.01);
  const env = [];
  for (let i = 0; i + w <= mono.length; i += w) { let s = 0; for (let k = 0; k < w; k++) s += mono[i + k] * mono[i + k]; env.push(Math.sqrt(s / w)); }
  const envMax = Math.max(...env, 1e-12);
  const thr = envMax * Math.pow(10, -45 / 20);
  let first = env.findIndex((e) => e > thr);
  let last = env.length - 1 - [...env].reverse().findIndex((e) => e > thr);
  if (first < 0) { first = 0; last = 0; }
  let ss = 0, cnt = 0;
  for (let i = first * w; i < (last + 1) * w && i < mono.length; i++) { ss += mono[i] * mono[i]; cnt++; }
  const rms = Math.sqrt(ss / Math.max(1, cnt));
  // momentary loudness: max RMS over 100 ms
  let mom = 0;
  for (let i = 0; i + 10 <= env.length; i++) { let s = 0; for (let k = 0; k < 10; k++) s += env[i + k] * env[i + k]; mom = Math.max(mom, Math.sqrt(s / 10)); }
  // spectrum over the active region (energy-weighted)
  const N = 2048;
  const spec = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  const a0 = first * w, a1 = Math.min(mono.length, (last + 1) * w);
  for (let i = a0; i + N <= Math.max(a1, a0 + N) && i + N <= mono.length; i += N / 2) {
    for (let k = 0; k < N; k++) { const hw = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1)); re[k] = mono[i + k] * hw; im[k] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
  }
  let num = 0, den = 0, low = 0, mid = 0, high = 0, logSum = 0, linSum = 0, bins = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N, p = spec[k];
    num += f * p; den += p;
    if (f < 250) low += p; else if (f < 2000) mid += p; else high += p;
    if (f > 100 && f < 5000) { logSum += Math.log(p + 1e-20); linSum += p; bins++; }
  }
  const flat = bins ? Math.exp(logSum / bins) / (linSum / bins + 1e-20) : 0;
  const tot = low + mid + high + 1e-20;
  return {
    peakDb: +db(peak).toFixed(1),
    rmsDb: +db(rms).toFixed(1),
    momDb: +db(mom).toFixed(1),
    durMs: Math.round((last - first + 1) * 10),
    centroidHz: Math.round(den ? num / den : 0),
    lowPct: Math.round((100 * low) / tot),
    midPct: Math.round((100 * mid) / tot),
    highPct: Math.round((100 * high) / tot),
    flatness: +flat.toFixed(3),
    peak,
  };
}

// ---------------------------------------------------------------- offline rendering
/**
 * Render a scenario offline through the real engine.
 * sc: { dur, state, music (bool), events: [[t, type, payload]], plays: [[t, cls, name, opts]], stateAt: (t) => partial }
 */
export async function renderScenario(sc, keepBuffer = false) {
  const dur = sc.dur ?? 2.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const audio = createAudio({ context: ctx, seed: sc.seed ?? 1234 });
  const bus = makeBus();
  audio.attach(bus);
  audio.unlock();
  audio.setVolume('music', sc.music ? 1 : 0);
  const eng = audio.debug.engine;
  // render every buffer the scenario needs up front so timing is not skewed
  eng.bank.warm(10000);
  if (sc.dry && eng.conv) eng.conv.disconnect();
  const frame = (sc.frame || 512) / SR;
  let st = baseState(sc.state);
  const evs = (sc.events || []).slice().sort((a, b) => a[0] - b[0]);
  const plays = (sc.plays || []).slice();
  let ei = 0;
  const step = (t) => {
    if (sc.stateAt) st = baseState({ ...sc.state, ...sc.stateAt(t) });
    while (ei < evs.length && evs[ei][0] <= t + 1e-9) { const [, type, p] = evs[ei++]; bus.emit(type, p); }
    for (let i = plays.length - 1; i >= 0; i--) if (plays[i][0] <= t + 1e-9) { const [, c, nm, o] = plays[i]; eng.voices.play(c, nm, { force: true, ...o }); plays.splice(i, 1); }
    audio.update(frame, st);
  };
  step(0);
  for (let t = frame; t < dur - frame; t += frame) {
    const tt = t;
    ctx.suspend(tt).then(() => { step(tt); ctx.resume(); });
  }
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const renderMs = performance.now() - t0;
  const res = analyse(buf, sc.from ?? 0);
  res.renderMs = Math.round(renderMs);
  res.errors = eng.errors;
  res.errorLog = eng.errorLog;
  audio.dispose();
  if (keepBuffer) res.buffer = buf;
  return res;
}

// Raw sounds through their class (mix gain applied), variant 0, no pitch randomisation.
export const RAW = [
  ['squelch', 'squelch'], ['squelch', 'squelch', { v: 6 }], ['splat', 'splat'], ['splat', 'splatBig'], ['splash', 'splash'], ['spurt', 'spurt'],
  ['bone', 'crack'], ['tear', 'rip'], ['thud', 'thud'], ['hazard', 'sawCut'], ['hazard', 'shunk'], ['hazard', 'grindCrunch'], ['hazard', 'crushHit'],
  ['metal', 'clang'], ['glass', 'tink'], ['prop', 'knock'],
  ['machine', 'slam'], ['machine', 'slamReady'], ['machine', 'hatch'], ['machine', 'intakeBell'], ['machine', 'crusherTelegraph'], ['machine', 'warnBeep'],
  ['machine', 'grinderClog'], ['machine', 'grinderClear'], ['machine', 'motorStart'],
  ['rocket', 'puncture'], ['rocket', 'rocket'], ['boom', 'explosion'], ['glass', 'glassCrack'], ['glass', 'glassShatter'],
  ['vocal', 'vSpawn'], ['vocal', 'vHurt'], ['vocal', 'vDeath'], ['vocal', 'vDrown'], ['vocal', 'vSigh'],
  ['pa', 'paCalm'], ['pa', 'paUrgent'], ['pa', 'paGlitch'], ['pa', 'paSpeech'], ['pa', 'paSpeechGlitch'],
  ['ui', 'uiHover'], ['ui', 'uiClick'], ['ui', 'uiBack'], ['ui', 'pauseOn'], ['ui', 'pauseOff'],
  ['stinger', 'comboHit'], ['stinger', 'comboRiser'], ['stinger', 'register'], ['stinger', 'buzzer'], ['stinger', 'star'], ['stinger', 'star3'],
  ['stinger', 'tick'], ['stinger', 'tickUrgent'], ['stinger', 'achievement'],
  ['stinger', 'jingleStart'], ['stinger', 'jingleComplete'], ['stinger', 'jingleTimeout'], ['stinger', 'jingleFailed'],
];

/** Each raw sound, variants 0..nVar-1 rendered separately (dry, no pitch randomisation), averaged. */
export async function measureRaw(nVar = 3) {
  const out = [];
  for (const [cls, name, o] of RAW) {
    const rs = [];
    const v0 = (o && o.v) || 0;
    // start at 0.5 s: WebAudio compressors start from a gain-reduced state and need ~0.3 s to settle
    for (let k = 0; k < nVar; k++) rs.push(strip(await renderScenario({ dur: 3.7, from: 0.45, dry: true, frame: 2048, plays: [[0.5, cls, name, { pitch: 0, ...o, v: v0 + k }]] })));
    const avg = (key) => +(rs.reduce((a, r) => a + r[key], 0) / rs.length).toFixed(key === 'flatness' ? 3 : 1);
    const r = { ...rs[0] };
    for (const key of ['peakDb', 'momDb', 'rmsDb', 'durMs', 'centroidHz', 'lowPct', 'midPct', 'highPct', 'flatness']) r[key] = avg(key);
    r.momSpread = +(Math.max(...rs.map((x) => x.momDb)) - Math.min(...rs.map((x) => x.momDb))).toFixed(1);
    r.clip = rs.some((x) => x.clip);
    r.errors = rs.reduce((a, x) => a + x.errors, 0);
    r.errorLog = rs.flatMap((x) => x.errorLog);
    out.push({ id: name + (o && o.v ? '#' + o.v : ''), name, cls, ...r });
  }
  return out;
}

const P = { pan: 0.3 };
export const EVENT_CASES = [
  ['shift:start', { levelId: 1, mode: 'shift' }],
  ['shift:end complete', { result: 'complete', liters: 40, stars: 3 }, 'shift:end'],
  ['shift:end timeout', { result: 'timeout', liters: 20, stars: 1 }, 'shift:end'],
  ['shift:end failed', { result: 'failed', liters: 2, stars: 0 }, 'shift:end'],
  ['wave:incoming', { count: 6 }],
  ['hatch:open', P],
  ['donor:spawn', { id: 1, type: 'standard', ...P }],
  ['donor:spawn big', { id: 2, type: 'bigGiver', ...P }, 'donor:spawn'],
  ['donor:hurt', { id: 3, amount: 10, cause: 'impact', ...P }],
  ...['cut', 'impale', 'crush', 'grind', 'impact', 'drown', 'explode', 'bleedout'].map((c) => ['donor:death ' + c, { id: 9, type: 'standard', cause: c, ...P }, 'donor:death']),
  ['limb:sever', { id: 4, part: 'forearmL', ...P }],
  ['limb:break', { id: 4, part: 'shinR', ...P }],
  ['impact flesh soft', { kind: 'flesh', speed: 3, mass: 4, ...P }, 'impact', [['impact', { kind: 'flesh', speed: 3, mass: 4 }, 30]]],
  ['impact flesh hard', { kind: 'flesh', speed: 14, mass: 8, ...P }, 'impact', [['impact', { kind: 'flesh', speed: 3, mass: 4 }, 30]]],
  ['impact metal', { kind: 'metal', speed: 10, mass: 5, ...P }, 'impact', [['impact', { kind: 'flesh', speed: 3, mass: 4 }, 30]]],
  ['impact glass', { kind: 'glass', speed: 10, mass: 5, ...P }, 'impact', [['impact', { kind: 'flesh', speed: 3, mass: 4 }, 30]]],
  ['impact prop', { kind: 'prop', speed: 10, mass: 5, ...P }, 'impact', [['impact', { kind: 'flesh', speed: 3, mass: 4 }, 30]]],
  ['blood:spurt', { rate: 2, ...P }],
  ['blood:splat small', { size: 0.3, ...P }, 'blood:splat', [['blood:splat', { size: 1 }, 30]]],
  ['blood:splat big', { size: 4, ...P }, 'blood:splat', [['blood:splat', { size: 1 }, 30]]],
  ['splash', { size: 1, ...P }],
  ...['saw', 'spike', 'grinder', 'crusher'].map((h) => ['hazard:contact ' + h, { hazard: h, intensity: 0.8, ...P }, 'hazard:contact']),
  ['hazard:telegraph', { hazard: 'crusher', ...P }],
  ['grinder:clog', P], ['grinder:clear', P],
  ['slam', {}], ['slam:ready', {}],
  ['combo x2', { count: 2, multiplier: 2 }, 'combo'],
  ['combo x8', { count: 8, multiplier: 8 }, 'combo'],
  ['bonus', { liters: 20, reason: 'inspector' }], ['fine', { liters: 25, reason: 'incident' }],
  ['prop:puncture', P], ['prop:explode', P],
  ['sphere:crack', P], ['sphere:shatter', P],
  ['pa:announce calm', { text: 'Please remain seated. Thank you for donating.', mood: 'calm' }, 'pa:announce'],
  ['pa:announce urgent', { text: 'Tank capacity exceeded.', mood: 'urgent' }, 'pa:announce'],
  ['pa:announce glitch', { text: 'Thank y-y-you for d0nating.', mood: 'glitch' }, 'pa:announce'],
  ['timer:warning 10', { secondsLeft: 10 }, 'timer:warning'],
  ['timer:warning 3', { secondsLeft: 3 }, 'timer:warning'],
  ['game:pause', { paused: true }],
  ['ui:hover', {}], ['ui:click', {}], ['ui:back', {}],
  ['ui:star 1', { n: 1 }, 'ui:star'], ['ui:star 3', { n: 3 }, 'ui:star'],
  ['achievement', { id: 'first_drop' }],
];

export async function measureEvents() {
  const out = [];
  for (const [label, payload, type, primers] of EVENT_CASES) {
    // primers: events emitted many times beforehand so the adaptive normalisers settle (offline at t=0, then measured event at t=0.6)
    void primers;
    const r = await renderScenario({ dur: 4, frame: 1024, events: [[0.6, type || label, payload]], from: 0.55 });
    out.push({ id: label, ...strip(r) });
  }
  return out;
}

export async function measureLoops() {
  const S = (o) => ({ screen: 'playing', ...o });
  const cases = [
    ['motor ω=0.4', { state: S({ drumOmega: 0.4 }) }],
    ['motor ω=2.2', { state: S({ drumOmega: 2.2 }) }],
    ['saw idle', { state: S({ hasSaw: true, sawLoad: 0 }) }],
    ['saw load=1', { state: S({ hasSaw: true, sawLoad: 1 }) }],
    ['grinder idle', { state: S({ hasGrinder: true, grinderLoad: 0 }) }],
    ['grinder load=1', { state: S({ hasGrinder: true, grinderLoad: 1 }) }],
    ['slosh fill=.8 ω=2', { state: S({ fill: 0.8, drumOmega: 2 }) }],
    ['room hum', { state: S({}) }],
    ['alarm fill=1', { state: S({ fill: 1 }) }],
  ];
  const out = [];
  for (const [id, sc] of cases) {
    const r = await renderScenario({ dur: 3, from: 1.5, ...sc });
    out.push({ id, ...strip(r) });
  }
  // motor ω=2.2 minus hum-only to isolate (reported raw)
  // patter: a flood of 300 splats per frame for 2 s
  const ev = [];
  for (let t = 0; t < 2.5; t += 0.0116) for (let k = 0; k < 20; k++) ev.push([t, 'blood:splat', { size: 1, pan: Math.random() * 2 - 1 }]);
  const r = await renderScenario({ dur: 3, from: 1, state: S({}), events: ev });
  out.push({ id: 'splat flood 1700/s (one-shots+patter)', ...strip(r) });
  return out;
}

/** Motor onset latency: omega steps from 0 to 0.5 at t=1 s; time until output reaches 50% of steady RMS. */
export async function motorLatency() {
  // Onset = first sample 12 dB above the pre-change floor. Measured relative to a reference voice
  // started in the same frame, which cancels the offline suspend/resume scheduling delay.
  const onset = (buf) => {
    const d = buf.getChannelData(0);
    let base = 0; for (let i = Math.floor(0.5 * SR); i < Math.floor(0.99 * SR); i++) base = Math.max(base, Math.abs(d[i]));
    for (let i = Math.floor(1.0 * SR); i < Math.floor(1.5 * SR); i++) if (Math.abs(d[i]) > Math.max(base * 4, 1e-4)) return i / SR;
    return null;
  };
  const mot = await renderScenario({ dur: 2.2, state: { screen: 'playing' }, stateAt: (t) => ({ drumOmega: t >= 1 ? 0.5 : 0 }) }, true);
  const ref = await renderScenario({ dur: 1.5, state: { screen: 'playing' }, plays: [[1.0, 'machine', 'slam', { v: 0 }]] }, true);
  const a = onset(mot.buffer), b = onset(ref.buffer);
  // half level of the motor body (50 ms RMS) relative to steady state
  const d = mot.buffer.getChannelData(0), w = Math.floor(0.05 * SR);
  const rms = (i) => { let q = 0; for (let k = 0; k < w; k++) q += d[i + k] * d[i + k]; return Math.sqrt(q / w); };
  const steady = rms(Math.floor(1.8 * SR));
  let half = null;
  for (let i = Math.floor(b * SR); i < Math.floor(1.6 * SR); i += Math.floor(SR * 0.002)) if (rms(i) > steady * 0.5) { half = +(((i / SR) - b) * 1000 + 50).toFixed(1); break; }
  return { latencyMs: a != null && b != null ? +((a - b) * 1000).toFixed(1) : null, halfLevelMs: half, harnessDelayMs: b != null ? +((b - 1) * 1000).toFixed(1) : null, note: 'relative to a voice started in the same frame; halfLevelMs is the end of the first 50 ms RMS window at half steady level' };
}

export async function measureMusic() {
  const cases = [
    ['menu', { screen: 'menu' }],
    ['shift fill=0 int=0', { screen: 'playing', fill: 0, intensity: 0 }],
    ['shift fill=0 int=1', { screen: 'playing', fill: 0, intensity: 1 }],
    ['shift fill=0.5', { screen: 'playing', fill: 0.5, intensity: 0.5 }],
    ['shift fill=1', { screen: 'playing', fill: 1, intensity: 0.5 }],
    ['paused (fill=0)', { screen: 'paused', fill: 0 }],
    ['shift slow-mo 0.35', { screen: 'playing', fill: 0, timeScale: 0.35 }],
    ['results', { screen: 'results', fill: 0.4 }],
  ];
  const out = [];
  for (const [id, state] of cases) {
    // let the degrade smoother converge: run 14 s, analyse the last 9 s
    const r = await renderScenario({ dur: 14, from: 5, music: true, state }, true);
    const t = tonal(r.buffer, 5);
    out.push({ id, ...strip(r), ...t });
  }
  return out;
}

/** Music level vs a squelch over it (ducking / relative level check). */
export async function measureDuck() {
  const r = await renderScenario({ dur: 6, music: true, state: { screen: 'playing' }, events: [[3, 'slam', {}]], from: 0 }, true);
  const d = r.buffer.getChannelData(0);
  const seg = (a, b) => { let s = 0, n = 0; for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i++) { s += d[i] * d[i]; n++; } return db(Math.sqrt(s / n)); };
  return { musicBeforeDb: +seg(1.5, 2.9).toFixed(1), slamWindowDb: +seg(3.0, 3.3).toFixed(1), musicAfter2sDb: +seg(4.6, 5.9).toFixed(1) };
}

/** Tuning purity & key clarity over 220-2500 Hz using a 16k FFT (for the music degradation check). */
export function tonal(ab, from = 0) {
  const d0 = ab.getChannelData(0), d1 = ab.numberOfChannels > 1 ? ab.getChannelData(1) : d0, sr = ab.sampleRate;
  const N = 16384;
  const spec = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
  for (let i = Math.floor(from * sr); i + N <= d0.length; i += N / 2) {
    for (let k = 0; k < N; k++) { const hw = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1)); re[k] = 0.5 * (d0[i + k] + d1[i + k]) * hw; im[k] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
  }
  const SCALE = new Set([5, 7, 9, 10, 0, 2, 4]); // F major
  let inTune = 0, inKey = 0, tot = 0;
  // only count spectral peaks (local maxima) so noise floor doesn't dilute the measure
  for (let k = 2; k < N / 2 - 2; k++) {
    const f = (k * sr) / N;
    if (f < 220 || f > 2500) continue;
    const p = spec[k];
    if (!(p > spec[k - 1] && p >= spec[k + 1] && p > spec[k - 2] && p >= spec[k + 2])) continue;
    // parabolic interpolation for the true peak frequency
    const a = Math.log(spec[k - 1] + 1e-30), b = Math.log(p + 1e-30), c = Math.log(spec[k + 1] + 1e-30);
    const off = (0.5 * (a - c)) / (a - 2 * b + c || 1e-9);
    const fp = ((k + off) * sr) / N;
    const midi = 69 + 12 * Math.log2(fp / 440);
    const cents = Math.abs(midi - Math.round(midi)) * 100;
    tot += p;
    if (cents < 20) inTune += p;
    if (SCALE.has(((Math.round(midi) % 12) + 12) % 12)) inKey += p;
  }
  return { inTune: +(inTune / (tot || 1)).toFixed(2), inKey: +(inKey / (tot || 1)).toFixed(2) };
}

function strip(r) { const { buffer, peak, ...rest } = r; return { ...rest, clip: peak >= 0.985 }; }

// ---------------------------------------------------------------- live stress test
export async function stress(seconds = 60, onTick) {
  const audio = createAudio({ seed: 99 });
  const bus = makeBus();
  audio.attach(bus);
  audio.unlock();
  const dbg = audio.debug;
  const ctx = dbg.ctx;
  if (!ctx) return { error: 'no AudioContext' };
  await ctx.resume();
  const an = ctx.createAnalyser();
  an.fftSize = 4096;
  dbg.output.connect(an);
  const tbuf = new Float32Array(an.fftSize);
  const R = Math.random;
  const pan = () => R() * 2 - 1;
  const perSec = [];
  let cur = null;
  let emitMs = 0, emitN = 0, emitMax = 0, updMs = 0, updN = 0, updMax = 0, totalEvents = 0;
  let frameMaxMs = 0;
  const t0 = performance.now();
  let last = t0;
  let id = 0;
  const emit = (type, p) => {
    const a = performance.now();
    bus.emit(type, p);
    const ms = performance.now() - a;
    emitMs += ms; emitN++; if (ms > emitMax) emitMax = ms; totalEvents++;
    return ms;
  };
  bus.emit('shift:start', { levelId: 7, mode: 'shift' });
  const fired = new Set();
  const once = (key, t, at, fn) => { if (t >= at && !fired.has(key)) { fired.add(key); fn(); } };

  return await new Promise((resolve) => {
    const tick = () => {
      try {
        const now = performance.now();
        const dt = (now - last) / 1000;
        last = now;
        const t = (now - t0) / 1000;
        const fill = Math.min(1, t / seconds);
        const intensity = Math.min(1, 0.2 + t / seconds);
        let frameMs = 0;
        // background activity scales with intensity
        const lam = (r) => { let k = 0; let p = Math.exp(-r * dt), s = p, u = R(); while (u > s && k < 500) { k++; p *= (r * dt) / k; s += p; } return k; };
        for (let i = lam(120 * intensity); i--;) frameMs += emit('blood:splat', { size: R() * 2, pan: pan() });
        for (let i = lam(40 * intensity); i--;) frameMs += emit('impact', { kind: R() < 0.8 ? 'flesh' : ['metal', 'prop', 'glass'][Math.floor(R() * 3)], speed: R() * 12, mass: 1 + R() * 8, pan: pan() });
        for (let i = lam(4 * intensity); i--;) frameMs += emit('donor:hurt', { id: Math.floor(R() * 30), amount: R() * 20, cause: 'impact', pan: pan() });
        for (let i = lam(1.5 * intensity); i--;) frameMs += emit('donor:death', { id: id++, type: 'standard', cause: ['cut', 'impale', 'crush', 'grind', 'impact', 'drown', 'explode', 'bleedout'][Math.floor(R() * 8)], pan: pan() });
        for (let i = lam(8 * intensity); i--;) frameMs += emit('hazard:contact', { hazard: ['saw', 'spike', 'grinder', 'crusher'][Math.floor(R() * 4)], intensity: R(), pan: pan() });
        for (let i = lam(2 * intensity); i--;) frameMs += emit('limb:sever', { id: 1, part: 'arm', pan: pan() });
        for (let i = lam(2 * intensity); i--;) frameMs += emit('limb:break', { id: 1, part: 'leg', pan: pan() });
        for (let i = lam(1.5 * intensity); i--;) frameMs += emit('blood:spurt', { rate: R() * 3, pan: pan() });
        for (let i = lam(6 * fill); i--;) frameMs += emit('splash', { size: R() * 2, pan: pan() });
        for (let i = lam(0.5); i--;) frameMs += emit('donor:spawn', { id: id++, type: 'standard', pan: pan() });
        for (let i = lam(0.3); i--;) frameMs += emit('slam', {});
        for (let i = lam(0.3); i--;) frameMs += emit('combo', { count: 3, multiplier: 2 + Math.floor(R() * 7) });
        // scripted bursts
        once('b1', t, 8, () => { for (let i = 0; i < 400; i++) frameMs += emit('blood:splat', { size: R() * 3, pan: pan() }); for (let i = 0; i < 80; i++) frameMs += emit('impact', { kind: 'flesh', speed: 15, mass: 6, pan: pan() }); });
        once('b2', t, 15, () => { for (let i = 0; i < 20; i++) frameMs += emit('donor:death', { id: id++, type: 'standard', cause: 'cut', pan: pan() }); for (let i = 0; i < 20; i++) frameMs += emit('limb:sever', { id: i, part: 'arm', pan: pan() }); });
        once('b3', t, 22, () => { for (let i = 0; i < 5; i++) { frameMs += emit('prop:puncture', { pan: pan() }); } });
        once('b4', t, 24.5, () => { for (let i = 0; i < 5; i++) frameMs += emit('prop:explode', { pan: pan() }); frameMs += emit('slam', {}); frameMs += emit('sphere:shatter', { pan: 0 }); });
        once('b5', t, 30, () => { frameMs += emit('pa:announce', { text: 'Reminder: smiling is mandatory.', mood: 'glitch' }); });
        once('b6', t, 36, () => { for (let i = 0; i < 20; i++) frameMs += emit('donor:death', { id: id++, type: 'bigGiver', cause: 'crush', pan: pan() }); frameMs += emit('slam', {}); frameMs += emit('combo', { count: 8, multiplier: 8 }); });
        once('b7', t, 44, () => { for (let i = 0; i < 300; i++) frameMs += emit(['blood:splat', 'impact', 'hazard:contact', 'splash'][i % 4], { size: 2, speed: 20, mass: 9, kind: 'flesh', hazard: 'saw', intensity: 1, pan: pan() }); });
        once('b8', t, 50, () => { frameMs += emit('game:pause', { paused: true }); });
        once('b9', t, 52, () => { frameMs += emit('game:pause', { paused: false }); });
        once('b10', t, 46, () => { frameMs += emit('grinder:clog', { pan: 0.5 }); });
        once('b11', t, 48, () => { frameMs += emit('grinder:clear', { pan: 0.5 }); });
        if (t > 40 && t < 50) for (let i = 0; i < 30; i++) frameMs += emit('blood:splat', { size: R(), pan: pan() }); // sustained flood
        const screen = t >= 50 && t < 52 ? 'paused' : 'playing';
        const timeScale = (t > 15 && t < 15.6) || (t > 36 && t < 36.6) ? 0.35 : 1;
        const st = { screen, fill, drumOmega: 2.2 * Math.sin(t * 0.7), aliveCount: 30, sawLoad: Math.max(0, Math.sin(t * 1.3)), grinderLoad: Math.max(0, Math.sin(t * 0.9)), timeScale, intensity, hasSaw: true, hasGrinder: true };
        const a = performance.now();
        audio.update(dt, st);
        const um = performance.now() - a;
        updMs += um; updN++; if (um > updMax) updMax = um;
        frameMs += um;
        if (frameMs > frameMaxMs) frameMaxMs = frameMs;
        // meter
        an.getFloatTimeDomainData(tbuf);
        let pk = 0, ss = 0;
        for (let i = 0; i < tbuf.length; i++) { const v = tbuf[i]; const av = Math.abs(v); if (av > pk) pk = av; ss += v * v; }
        const sec = Math.floor(t);
        if (!cur || cur.sec !== sec) {
          if (cur) { cur.rmsDb = +db(Math.sqrt(cur.ss / cur.n)).toFixed(1); cur.peakDb = +db(cur.pk).toFixed(1); delete cur.ss; delete cur.n; delete cur.pk; perSec.push(cur); onTick && onTick(cur); }
          const s = dbg.stats();
          cur = { sec, pk: 0, ss: 0, n: 0, over: 0, voices: s.voices, dying: s.dying, voiceNodes: s.voiceNodes, musicNodes: s.musicNodes, events: totalEvents, ctxTime: +ctx.currentTime.toFixed(2), wall: +t.toFixed(2) };
        }
        cur.pk = Math.max(cur.pk, pk); cur.ss += ss / tbuf.length; cur.n++;
        if (pk >= 0.995) cur.over++;
        if (t >= seconds) {
          clearInterval(timer);
          bus.emit('shift:end', { result: 'complete', liters: 99, stars: 3 });
          const s = dbg.stats();
          const res = {
            perSec, totalEvents,
            emitMeanUs: +((emitMs / Math.max(1, emitN)) * 1000).toFixed(1), emitMaxMs: +emitMax.toFixed(2),
            updateMeanMs: +(updMs / Math.max(1, updN)).toFixed(3), updateMaxMs: +updMax.toFixed(2), frameMaxMs: +frameMaxMs.toFixed(2),
            stats: s, ctxState: ctx.state, ctxTime: ctx.currentTime, wallTime: (performance.now() - t0) / 1000,
          };
          // let tails finish then check cleanup
          setTimeout(() => {
            audio.update(0.016, { screen: 'results' });
            res.after = dbg.stats();
            audio.dispose();
            res.afterDispose = dbg.stats();
            resolve(res);
          }, 4000);
        }
      } catch (e) { clearInterval(timer); resolve({ error: String(e && e.stack || e) }); }
    };
    const timer = setInterval(tick, 16);
  });
}

// ---------------------------------------------------------------- robustness
export async function robustness() {
  const issues = [];
  const tryIt = (label, fn) => { try { fn(); } catch (e) { issues.push(label + ': ' + e.message); } };
  // 1) before unlock: everything is a silent no-op
  const a = createAudio();
  const bus = makeBus();
  tryIt('attach before unlock', () => a.attach(bus));
  tryIt('emit before unlock', () => { for (const t of EVENT_NAMES) bus.emit(t, {}); });
  tryIt('update before unlock', () => a.update(0.016, baseState()));
  tryIt('setVolume before unlock', () => { a.setVolume('master', 0.5); a.setVolume('bogus', 3); a.setVolume('music', NaN); });
  tryIt('suspend/resume before unlock', () => { a.suspend(); a.resume(); });
  // 2) garbage payloads after unlock
  a.unlock();
  await new Promise((r) => setTimeout(r, 100));
  const junk = [undefined, null, 0, 'str', [], { pan: NaN, size: Infinity, speed: -5, mass: 'x', id: {}, multiplier: 1e9, n: -3, secondsLeft: null, mood: 7, result: 9, hazard: 'laser', kind: 'cheese', cause: 'boredom', text: { a: 1 } }];
  tryIt('junk payloads', () => { for (const t of EVENT_NAMES) for (const j of junk) bus.emit(t, j); });
  tryIt('junk state', () => { a.update(NaN, null); a.update(-1, 'x'); a.update(1e9, { screen: 'nope', fill: NaN, drumOmega: Infinity, timeScale: 0, sawLoad: -4 }); a.update(0.016, { screen: 'playing', timeScale: 0.0 }); });
  tryIt('double attach', () => { a.attach(bus); a.attach(bus); });
  const listeners = bus.count();
  tryIt('dispose', () => a.dispose());
  tryIt('after dispose', () => { bus.emit('slam', {}); a.update(0.016, baseState()); a.unlock(); a.dispose(); });
  const st = a.debug.stats();
  // 3) WebAudio missing
  const saved = { AC: window.AudioContext, W: window.webkitAudioContext };
  let noAudioOk = true;
  try {
    window.AudioContext = undefined; window.webkitAudioContext = undefined;
    const b = createAudio(); const bus2 = makeBus();
    b.attach(bus2); b.unlock(); for (const t of EVENT_NAMES) bus2.emit(t, {}); b.update(0.016, baseState()); b.setVolume('sfx', 0.2); b.suspend(); b.resume(); b.dispose();
  } catch (e) { noAudioOk = false; issues.push('no-webaudio: ' + e.message); }
  finally { window.AudioContext = saved.AC; window.webkitAudioContext = saved.W; }
  return { issues, internalErrors: st.errors, internalErrorLog: st.errorLog, listenersAfterDoubleAttach: listeners, listenersAfterDispose: bus.count(), noAudioOk, expectedListeners: EVENT_NAMES.length };
}

// Export WAVs (16-bit) of selected renders so a human can listen later.
export async function renderWav(sc) {
  const r = await renderScenario(sc, true);
  const b = r.buffer;
  const n = b.length, ch = b.numberOfChannels;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, b.sampleRate, true);
  dv.setUint32(28, b.sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(b.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { dv.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 32767, true); o += 2; }
  const bytes = new Uint8Array(dv.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

window.__audioHarness = { measureRaw, measureEvents, measureLoops, measureMusic, measureDuck, motorLatency, stress, robustness, renderWav, renderScenario, RAW, EVENT_CASES };
window.__audioHarnessReady = true;
