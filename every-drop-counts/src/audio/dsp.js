// Offline DSP toolkit: everything here runs in plain JS on Float32Arrays so sounds can be
// pre-rendered into AudioBuffers once and then played back cheaply many times.
// No WebAudio dependencies in this file.

export const TAU = Math.PI * 2;

/** Small fast seeded PRNG (mulberry32). Returns () => [0,1). */
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function rnd() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const rr = (rnd, a, b) => a + (b - a) * rnd();
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** RBJ-cookbook biquad, transposed direct form II. */
export class Biquad {
  constructor(type, f, q, sr, gainDb) {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
    if (type) this.set(type, f, q, sr, gainDb);
  }
  set(type, f, q, sr, gainDb = 0) {
    f = clamp(f, 10, sr * 0.45);
    q = Math.max(0.05, q);
    const w = (TAU * f) / sr;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const al = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'hp':
        b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case 'bp':
        b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case 'peak': {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; break;
      }
      case 'lp':
      default:
        b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  /** Filter a buffer in place (optionally a sub-range). */
  process(buf, from = 0, to = buf.length) {
    for (let i = from; i < to; i++) buf[i] = this.run(buf[i]);
    return buf;
  }
}

/** One-pole lowpass, cheap smoothing. */
export class OnePole {
  constructor(f, sr) { this.y = 0; this.setF(f, sr); }
  setF(f, sr) { this.a = 1 - Math.exp((-TAU * f) / sr); }
  run(x) { this.y += this.a * (x - this.y); return this.y; }
}

/** Linear interpolation through breakpoints [[t, v], ...]. */
export function bp(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (t <= p[0]) {
      const q = points[i - 1];
      return q[1] + ((p[1] - q[1]) * (t - q[0])) / (p[0] - q[0] || 1);
    }
  }
  return points[points.length - 1][1];
}

/** Smoothed random signal ("wobble") generator at ~rate Hz. */
export function makeWobble(rnd, rate, sr) {
  let cur = rnd() * 2 - 1, next = rnd() * 2 - 1, ph = 0;
  const inc = rate / sr;
  return () => {
    ph += inc;
    if (ph >= 1) { ph -= 1; cur = next; next = rnd() * 2 - 1; }
    const s = ph * ph * (3 - 2 * ph);
    return cur + (next - cur) * s;
  };
}

export function buf(sr, seconds) {
  return new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
}

/**
 * Add an exponentially decaying sinusoid (a "mode"). Optional exponential chirp to fEnd over
 * `chirp` seconds. `wrap` writes modulo the buffer length (for seamless loops).
 */
export function addMode(out, sr, t0, f, decay, amp, o = {}) {
  const start = Math.floor(t0 * sr);
  const n = out.length;
  const len = Math.min(Math.ceil(decay * 7 * sr), o.wrap ? n : n - start);
  const fEnd = o.fEnd ?? f;
  const chirp = o.chirp ?? decay;
  const att = Math.max(1, Math.floor((o.attack ?? 0.0005) * sr));
  let ph = o.phase ?? 0;
  const k = Math.exp(-1 / (decay * sr));
  let a = amp;
  const ratio = fEnd / f;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const fi = ratio === 1 ? f : f * Math.pow(ratio, Math.min(1, t / chirp));
    ph += (TAU * fi) / sr;
    const e = i < att ? i / att : 1;
    let idx = start + i;
    if (o.wrap) idx %= n; else if (idx >= n) break;
    out[idx] += Math.sin(ph) * a * e;
    a *= k;
  }
}

/** Bubble / droplet: sinusoid rising in pitch with fast decay (Minnaert-style). */
export function addBubble(out, sr, t0, f0, dur, amp, rise = 0.6, wrap = false) {
  const start = Math.floor(t0 * sr);
  const n = out.length;
  const len = Math.ceil(dur * sr);
  const tau = dur / 4.5;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = f0 * (1 + rise * (t / dur) * (1 + (t / dur)));
    ph += (TAU * f) / sr;
    let idx = start + i;
    if (wrap) idx %= n; else if (idx >= n) break;
    const e = Math.exp(-t / tau) * Math.min(1, i / 8);
    out[idx] += Math.sin(ph) * amp * e;
  }
}

/** Single-sample-ish click (2-sample impulse with alternating sign). */
export function addClick(out, sr, t0, amp) {
  const i = Math.floor(t0 * sr);
  if (i >= 0 && i < out.length) out[i] += amp;
  if (i + 1 < out.length) out[i + 1] -= amp * 0.6;
  if (i + 2 < out.length) out[i + 2] += amp * 0.2;
}

/**
 * Filtered-noise burst. env: function(t01) -> gain, or 'exp' with decay seconds.
 * filter: { type, f, q, f1 (end freq, exp sweep) }.
 */
export function addNoise(out, sr, rnd, t0, dur, amp, o = {}) {
  const start = Math.floor(t0 * sr);
  const n = out.length;
  const len = Math.ceil(dur * sr);
  const flt = o.type ? new Biquad(o.type, o.f, o.q ?? 0.707, sr) : null;
  const flt2 = o.type && o.steep ? new Biquad(o.type, o.f, o.q ?? 0.707, sr) : null;
  const sweep = o.type && o.f1 && o.f1 !== o.f;
  const att = Math.max(1, Math.floor((o.attack ?? 0.001) * sr));
  const decay = o.decay ?? dur / 5;
  const am = o.am || null; // function(t) -> multiplier
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    if (sweep && (i & 31) === 0) {
      const f = o.f * Math.pow(o.f1 / o.f, t / dur);
      flt.set(o.type, f, o.q ?? 0.707, sr);
      if (flt2) flt2.set(o.type, f, o.q ?? 0.707, sr);
    }
    let x = rnd() * 2 - 1;
    if (flt) x = flt.run(x);
    if (flt2) x = flt2.run(x);
    let e = o.env ? o.env(t / dur, t) : Math.exp(-t / decay);
    if (i < att) e *= i / att;
    if (am) e *= am(t);
    let idx = start + i;
    if (o.wrap) idx %= n; else if (idx >= n) break;
    out[idx] += x * e * amp;
  }
}

/** Additive tone with partials [[ratio, amp, decay], ...]. */
export function addTone(out, sr, t0, f, partials, amp, o = {}) {
  for (const [ratio, a, d] of partials) {
    if (f * ratio > sr * 0.45) continue;
    addMode(out, sr, t0, f * ratio, d, a * amp, { attack: o.attack ?? 0.002, phase: o.phase ?? 0, fEnd: o.fEnd ? o.fEnd * ratio : undefined, chirp: o.chirp, wrap: o.wrap });
  }
}

export function softClip(out, drive = 1) {
  const k = Math.tanh(drive);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * drive) / k;
  return out;
}

export function filter(out, sr, type, f, q = 0.707, gainDb = 0) {
  return new Biquad(type, f, q, sr, gainDb).process(out);
}

export function peakOf(out) {
  let p = 0;
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > p) p = a; }
  return p;
}

export function normalize(out, target = 0.9) {
  const p = peakOf(out);
  if (p > 1e-9) { const g = target / p; for (let i = 0; i < out.length; i++) out[i] *= g; }
  return out;
}

export function fade(out, sr, inS = 0.001, outS = 0.01) {
  const ni = Math.min(out.length, Math.floor(inS * sr));
  for (let i = 0; i < ni; i++) out[i] *= i / ni;
  const no = Math.min(out.length, Math.floor(outS * sr));
  for (let i = 0; i < no; i++) out[out.length - 1 - i] *= i / no;
  return out;
}

/** Remove DC offset with a gentle highpass (keeps thumps clean). */
export function dcBlock(out, sr, f = 20) {
  return filter(out, sr, 'hp', f, 0.707);
}

/** Make a buffer loop seamlessly by crossfading its tail into its head. */
export function loopify(out, sr, xf = 0.05) {
  const n = Math.floor(xf * sr);
  const L = out.length - n;
  const res = new Float32Array(L);
  for (let i = 0; i < L; i++) res[i] = out[i];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    res[i] = out[i] * Math.sqrt(t) + out[L + i] * Math.sqrt(1 - t);
  }
  return res;
}

/** PolyBLEP correction for band-limited saw/square. */
export function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** Quantise amplitude (bit-crush) in place. */
export function crush(out, levels) {
  for (let i = 0; i < out.length; i++) out[i] = Math.round(out[i] * levels) / levels;
  return out;
}
