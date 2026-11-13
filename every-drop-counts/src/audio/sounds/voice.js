// Formant "vocal blip" synthesiser for donors and the PA announcer.
// Polite, muffled, comic: a band-limited glottal pulse through 3 formant bandpasses that glide
// between vowels, with breath noise, vibrato and an optional lip-trill (for underwater blubbing).
import { Biquad, OnePole, buf, bp, polyBlep, addBubble, addNoise, filter, softClip, dcBlock, rr, fade, crush, TAU } from '../dsp.js';

// [F1, F2, F3, gain] (adult-ish formants, slightly cartoon-shifted)
const VOWELS = {
  a: [750, 1150, 2500, 1],
  o: [520, 860, 2450, 1],
  u: [330, 820, 2250, 0.9],
  e: [500, 1800, 2550, 0.95],
  i: [300, 2250, 3000, 0.8],
  '@': [520, 1400, 2500, 0.85], // schwa
  m: [260, 1050, 2200, 0.35], // nasal hum
  h: [600, 1300, 2500, 0.0], // breath only
};

function vowelAt(seq, t) {
  // seq: [[t, 'a'], ...] -> interpolated formant set
  let i = 0;
  while (i < seq.length - 1 && t > seq[i + 1][0]) i++;
  const A = VOWELS[seq[i][1]];
  if (i >= seq.length - 1) return A;
  const B = VOWELS[seq[i + 1][1]];
  const span = seq[i + 1][0] - seq[i][0] || 1;
  // vowel transitions happen over the last 60 ms before the next target
  const u = Math.max(0, Math.min(1, (t - (seq[i + 1][0] - Math.min(0.06, span))) / Math.min(0.06, span)));
  return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u, A[3] + (B[3] - A[3]) * u];
}

/**
 * spec: { dur, f0: [[t,hz]..], v: [[t,vowel]..], amp: [[t,a]..], breath: [[t,b]..] | number,
 *         trill: Hz, vib: depth, muffle: Hz, fShift: formant scale }
 */
export function sing(sr, rnd, spec) {
  const out = buf(sr, spec.dur);
  const n = out.length;
  const f1 = new Biquad(), f2 = new Biquad(), f3 = new Biquad();
  const tilt = new OnePole(1800, sr);
  const fs = spec.fShift ?? 1;
  const vibRate = rr(rnd, 5, 6.5);
  const vib = spec.vib ?? 0.012;
  const breathPts = typeof spec.breath === 'number' ? [[0, spec.breath]] : spec.breath || [[0, 0.06]];
  let ph = rnd();
  let g = 1, jitter = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      const V = vowelAt(spec.v, t);
      f1.set('bp', V[0] * fs, 6, sr);
      f2.set('bp', V[1] * fs, 9, sr);
      f3.set('bp', V[2] * fs, 12, sr);
      g = V[3];
      jitter = (rnd() * 2 - 1) * 0.006;
    }
    const f0 = bp(spec.f0, t) * (1 + vib * Math.sin(TAU * vibRate * t) + jitter);
    const dt = f0 / sr;
    ph += dt; if (ph >= 1) ph -= 1;
    const saw = 2 * ph - 1 - polyBlep(ph, dt);
    const br = bp(breathPts, t);
    const voiced = tilt.run(saw) * g;
    const src = voiced * (1 - br) * 2.2 + (rnd() * 2 - 1) * br;
    let y = f1.run(src) * 1.0 + f2.run(src) * 0.55 + f3.run(src) * 0.25;
    if (spec.trill) y *= 0.55 + 0.45 * Math.sin(TAU * spec.trill * t);
    out[i] = y * bp(spec.amp, t);
  }
  if (spec.muffle) { filter(out, sr, 'lp', spec.muffle, 0.6); filter(out, sr, 'lp', spec.muffle * 1.4, 0.6); }
  return fade(dcBlock(out, sr, 70), sr, 0.003, 0.03);
}

const MUFFLE = 2300;
const env = (dur, a = 0.02, r = 0.08) => [[0, 0], [a, 1], [Math.max(a, dur - r), 0.85], [dur, 0]];

// Phrase recipes; `p` = base pitch Hz (variant pitch is randomised per render).
const SPAWN = [
  (p) => ({ dur: 0.3, f0: [[0, p], [0.3, p * 1.35]], v: [[0, 'h'], [0.04, 'a'], [0.2, 'i']], amp: env(0.3), breath: [[0, 0.9], [0.05, 0.05]] }), // "hi!"
  (p) => ({ dur: 0.5, f0: [[0, p * 1.05], [0.18, p * 1.0], [0.25, p * 1.15], [0.5, p * 1.3]], v: [[0, 'h'], [0.03, 'e'], [0.17, '@'], [0.25, 'o'], [0.5, 'u']], amp: [[0, 0], [0.03, 1], [0.16, 0.8], [0.2, 0.35], [0.26, 1], [0.42, 0.8], [0.5, 0]], breath: [[0, 0.9], [0.04, 0.05]] }), // "hel-lo!"
  (p) => ({ dur: 0.65, f0: [[0, p * 1.1], [0.65, p * 1.75]], v: [[0, 'u'], [0.15, 'i']], amp: env(0.65, 0.05, 0.15), breath: 0.08, vib: 0.02 }), // "wheee"
  (p) => ({ dur: 0.24, f0: [[0, p * 1.05], [0.24, p * 1.4]], v: [[0, 'o'], [0.24, 'u']], amp: env(0.24), breath: 0.05 }), // "oh!"
  (p) => ({ dur: 0.34, f0: [[0, p * 0.85], [0.34, p * 1.2]], v: [[0, 'm'], [0.34, 'm']], amp: env(0.34, 0.03, 0.06), breath: 0.04 }), // "hm?"
];

const HURT = [
  (p) => ({ dur: 0.24, f0: [[0, p * 1.1], [0.24, p * 0.75]], v: [[0, 'u'], [0.14, '@']], amp: [[0, 0], [0.015, 1], [0.15, 0.7], [0.17, 0.2], [0.24, 0]], breath: [[0, 0.05], [0.16, 0.05], [0.18, 0.95]] }), // "oof"
  (p) => ({ dur: 0.28, f0: [[0, p * 1.3], [0.28, p * 0.9]], v: [[0, 'a'], [0.12, 'o'], [0.28, 'u']], amp: env(0.28, 0.01), breath: 0.06 }), // "ow"
  (p) => ({ dur: 0.15, f0: [[0, p * 1.8], [0.15, p * 2.1]], v: [[0, 'i'], [0.15, 'i']], amp: env(0.15, 0.008, 0.03), breath: 0.04 }), // "eep"
  (p) => ({ dur: 0.26, f0: [[0, p * 0.8], [0.26, p * 0.65]], v: [[0, '@'], [0.26, '@']], amp: env(0.26, 0.02), breath: 0.15, vib: 0.03 }), // "ugh"
  (p) => ({ dur: 0.18, f0: [[0, p * 1.5], [0.18, p * 1.2]], v: [[0, 'a'], [0.18, 'a']], amp: env(0.18, 0.006, 0.04), breath: 0.05 }), // "ah!"
  (p) => ({ dur: 0.16, f0: [[0, p * 1.35], [0.16, p * 1.5]], v: [[0, 'u'], [0.16, 'o']], amp: env(0.16, 0.01, 0.03), breath: 0.04 }), // "oop"
  (p) => ({ dur: 0.3, f0: [[0, p * 0.95], [0.3, p * 0.8]], v: [[0, 'm'], [0.12, '@']], amp: env(0.3, 0.02, 0.05), breath: 0.08 }), // "nngh"
  (p) => ({ dur: 0.22, f0: [[0, p * 1.2], [0.08, p * 1.5], [0.22, p * 1.0]], v: [[0, 'h'], [0.02, 'u'], [0.22, 'o']], amp: env(0.22, 0.01), breath: [[0, 0.8], [0.03, 0.06]] }), // "whoa"
];

const DEATH = [
  (p) => ({ dur: 1.0, f0: [[0, p * 1.7], [0.15, p * 1.8], [1.0, p * 0.8]], v: [[0, 'a'], [0.75, 'a'], [1.0, '@']], amp: env(1.0, 0.02, 0.25), breath: [[0, 0.05], [0.7, 0.1], [1, 0.4]], vib: 0.03 }), // "aaaaah"
  (p) => ({ dur: 0.85, f0: [[0, p * 1.3], [0.85, p * 0.75]], v: [[0, 'm'], [0.07, 'o'], [0.6, 'o'], [0.85, 'u']], amp: env(0.85, 0.03, 0.2), breath: 0.06, vib: 0.025 }), // "nooo"
  (p) => ({ dur: 0.8, f0: [[0, p * 1.15], [0.3, p * 1.0], [0.38, p * 1.2], [0.8, p * 0.85]], v: [[0, 'o'], [0.28, '@'], [0.36, 'e'], [0.6, '@']], amp: [[0, 0], [0.02, 1], [0.28, 0.8], [0.33, 0.3], [0.38, 1], [0.7, 0.6], [0.8, 0]], breath: 0.07 }), // "oh dear"
  (p) => ({ dur: 0.9, f0: [[0, p * 1.2], [0.3, p * 1.9], [0.9, p * 0.9]], v: [[0, 'u'], [0.2, 'a'], [0.55, 'o']], amp: env(0.9, 0.03, 0.2), breath: 0.06, vib: 0.03 }), // "whoa-oh"
  (p) => ({ dur: 0.7, f0: [[0, p * 1.6], [0.3, p * 2.4], [0.7, p * 2.0]], v: [[0, 'a'], [0.25, 'i'], [0.7, 'i']], amp: env(0.7, 0.01, 0.15), breath: 0.05, vib: 0.035 }), // "aiee"
  (p) => ({ dur: 0.75, f0: [[0, p * 1.2], [0.25, p * 1.25], [0.35, p * 1.15], [0.75, p * 0.85]], v: [[0, 'o'], [0.25, 'o'], [0.32, 'm'], [0.4, 'o'], [0.75, 'u']], amp: [[0, 0], [0.02, 1], [0.25, 0.8], [0.3, 0.3], [0.4, 1], [0.75, 0]], breath: 0.06 }), // "oh no"
];

export const VOICE = {
  vSpawn: { variants: 10, render: (sr, rnd, v) => sing(sr, rnd, { ...SPAWN[v % SPAWN.length](rr(rnd, 150, 230)), muffle: MUFFLE }) },
  vHurt: { variants: 16, render: (sr, rnd, v) => sing(sr, rnd, { ...HURT[v % HURT.length](rr(rnd, 140, 220)), muffle: MUFFLE }) },
  vDeath: { variants: 12, render: (sr, rnd, v) => sing(sr, rnd, { ...DEATH[v % DEATH.length](rr(rnd, 140, 210)), muffle: MUFFLE }) },
  // Drowning: blubbering "blblbl" with lip trill + bubbles, very muffled.
  vDrown: {
    variants: 4,
    render(sr, rnd) {
      const p = rr(rnd, 150, 200);
      const dur = rr(rnd, 1.1, 1.4);
      const out = sing(sr, rnd, { dur, f0: [[0, p * 1.4], [dur, p * 0.8]], v: [[0, 'u'], [dur * 0.5, 'o'], [dur, 'u']], amp: env(dur, 0.03, 0.3), breath: 0.1, trill: rr(rnd, 13, 18), vib: 0.04, muffle: 900 });
      for (let i = 0; i < 40; i++) addBubble(out, sr, rnd() * dur * 0.95, rr(rnd, 250, 900), rr(rnd, 0.02, 0.07), rr(rnd, 0.15, 0.4), rr(rnd, 0.6, 1.5));
      return out;
    },
  },
  // Bleed-out: faint, breathy, resigned "ohhh..."
  vSigh: {
    variants: 4,
    render(sr, rnd) {
      const p = rr(rnd, 120, 170);
      return sing(sr, rnd, { dur: 1.1, f0: [[0, p * 1.1], [1.1, p * 0.7]], v: [[0, 'o'], [0.6, '@'], [1.1, '@']], amp: [[0, 0], [0.1, 1], [0.6, 0.6], [1.1, 0]], breath: [[0, 0.3], [1.1, 0.7]], muffle: MUFFLE });
    },
  },
  // PA announcer mumble ("wah-wah" through a ceiling speaker).
  paSpeech: {
    variants: 5,
    render(sr, rnd) { return paMumble(sr, rnd, false); },
  },
  paSpeechGlitch: {
    variants: 3,
    render(sr, rnd) { return paMumble(sr, rnd, true); },
  },
};

function paMumble(sr, rnd, glitch) {
  const dur = 2.6;
  const keys = ['a', 'e', 'o', '@', 'i', 'u', 'a', '@'];
  const f0 = [], v = [], amp = [[0, 0]], breath = [];
  let t = 0.02;
  const base = rr(rnd, 165, 190);
  while (t < dur - 0.25) {
    const syl = rr(rnd, 0.11, 0.2);
    const pitch = base * (1 + 0.12 * Math.sin(t * 2.1) + rr(rnd, -0.04, 0.06)) * (t > dur - 0.6 ? 0.88 : 1);
    f0.push([t, pitch], [t + syl, pitch * 0.97]);
    v.push([t, keys[Math.floor(rnd() * keys.length)]]);
    const cons = rnd() < 0.5;
    breath.push([t, cons ? 0.7 : 0.08], [t + 0.025, 0.06]);
    amp.push([t, cons ? 0.4 : 0.1], [t + 0.03, 1], [t + syl - 0.03, 0.85], [t + syl, 0.15]);
    t += syl;
    if (rnd() < 0.12) { amp.push([t + 0.02, 0], [t + 0.12, 0]); t += 0.14; } // word gap
  }
  amp.push([t + 0.05, 0], [dur, 0]);
  let out = sing(sr, rnd, { dur, f0, v, amp, breath, vib: 0.006 });
  // ceiling-speaker band: tinny, slightly overdriven
  filter(out, sr, 'hp', 420, 0.8);
  filter(out, sr, 'lp', 3200, 0.9);
  filter(out, sr, 'peak', 1800, 1.2, 6);
  softClip(out, 2.2);
  if (glitch) {
    // stutters, pitch-dropped chunks and crush
    const o2 = new Float32Array(out.length);
    let r = 0, w = 0;
    while (w < out.length) {
      const chunk = Math.floor(rr(rnd, 0.04, 0.12) * sr);
      const mode = rnd();
      if (mode < 0.25) { for (let k = 0; k < 3 && w < out.length; k++) for (let i = 0; i < chunk && w < out.length; i++) o2[w++] = out[(r + i) % out.length]; r += chunk; }
      else if (mode < 0.4) { for (let i = 0; i < chunk * 2 && w < out.length; i++) o2[w++] = out[(r + (i >> 1)) % out.length]; r += chunk; }
      else if (mode < 0.48) { for (let i = 0; i < chunk && w < out.length; i++) o2[w++] = 0; }
      else { for (let i = 0; i < chunk && w < out.length; i++) o2[w++] = out[(r + i) % out.length]; r += chunk; }
    }
    out = crush(o2, 10);
    addNoise(out, sr, rnd, rr(rnd, 0.3, 2), 0.08, 0.3, { type: 'hp', f: 2000, decay: 0.03 });
  }
  return fade(out, sr, 0.005, 0.05);
}
