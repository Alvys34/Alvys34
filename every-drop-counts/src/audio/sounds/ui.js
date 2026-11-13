// UI / feedback: PA chimes, hover/click/back, combo, bonus register, fine buzzer, stars, ticks,
// achievement, shift jingles, pause blips. Clean and "corporate friendly".
import { buf, addMode, addClick, addNoise, addTone, softClip, filter, rr, fade, mtof, crush, TAU } from '../dsp.js';

const VIBES = [[1, 1, 1.3], [4, 0.22, 0.25], [10, 0.05, 0.06]];
const CHIME = [[1, 1, 1.4], [2, 0.18, 0.5], [3, 0.06, 0.25], [5.2, 0.03, 0.08]];
const BRIGHT = [[1, 1, 0.5], [2, 0.4, 0.25], [3, 0.3, 0.15], [5, 0.15, 0.08]];
const BELL = [[0.5, 0.35, 1.2], [1, 1, 0.9], [1.19, 0.35, 0.6], [1.5, 0.3, 0.5], [2, 0.45, 0.4], [2.52, 0.2, 0.25], [3.01, 0.15, 0.2]];

function seqNotes(out, sr, notes, partials, amp, o = {}) {
  for (const [t, m, a = 1] of notes) addTone(out, sr, t, mtof(m), partials, amp * a, o);
}

export const UI = {
  uiHover: {
    variants: 2,
    render(sr, rnd, v) {
      const out = buf(sr, 0.06);
      addTone(out, sr, 0, v ? 2700 : 2450, [[1, 1, 0.012], [1.5, 0.2, 0.006]], 1, { attack: 0.001 });
      return fade(out, sr, 0.0005, 0.01);
    },
  },
  uiClick: {
    variants: 2,
    render(sr, rnd, v) {
      const out = buf(sr, 0.16);
      addClick(out, sr, 0, 0.2);
      addTone(out, sr, 0, v ? 932 : 880, [[1, 1, 0.05], [4, 0.25, 0.012], [2.01, 0.15, 0.02]], 1);
      addTone(out, sr, 0.035, 1318, [[1, 0.6, 0.05], [4, 0.1, 0.01]], 1);
      return fade(out, sr, 0.0005, 0.02);
    },
  },
  uiBack: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 0.18);
      addTone(out, sr, 0, 784, [[1, 1, 0.045], [4, 0.2, 0.01]], 1);
      addTone(out, sr, 0.05, 587, [[1, 1, 0.06], [4, 0.2, 0.01]], 1);
      return fade(out, sr, 0.0005, 0.02);
    },
  },

  // PA chimes: calm (three descending soft bells), urgent (fast bright alternation),
  // glitch (calm chime that stutters and goes sour).
  paCalm: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 2.8);
      seqNotes(out, sr, [[0, 79], [0.42, 76], [0.84, 72, 1.1]], CHIME, 0.5);
      return fade(out, sr, 0.001, 0.2);
    },
  },
  paUrgent: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 1.6);
      seqNotes(out, sr, [[0, 84], [0.17, 79], [0.34, 84], [0.51, 79]], BRIGHT, 0.45);
      softClip(out, 1.6);
      return fade(out, sr, 0.001, 0.15);
    },
  },
  paGlitch: {
    variants: 2,
    render(sr, rnd) {
      const out = buf(sr, 2.8);
      seqNotes(out, sr, [[0, 79], [0.42, 76], [0.5, 76, 0.7], [0.58, 75.4, 0.6], [1.0, 70.6, 1.1]], CHIME, 0.5);
      for (let i = 0; i < 3; i++) addNoise(out, sr, rnd, rr(rnd, 0.3, 1.6), 0.05, 0.25, { type: 'hp', f: 3000, decay: 0.02 });
      crush(out, 12);
      return fade(filter(out, sr, 'lp', 5000, 0.9), sr, 0.001, 0.2);
    },
  },

  // Combo: bright pluck + sparkle (pitched by multiplier at playback) and a noise riser.
  comboHit: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 0.7);
      addTone(out, sr, 0, mtof(84), [[1, 1, 0.35], [2, 0.35, 0.18], [3, 0.12, 0.08], [4, 0.15, 0.05]], 0.6);
      addTone(out, sr, 0.06, mtof(91), [[1, 1, 0.3], [2, 0.3, 0.12]], 0.4);
      for (let i = 0; i < 10; i++) addMode(out, sr, rr(rnd, 0.05, 0.4), rr(rnd, 4000, 9000), 0.03, 0.08);
      return fade(out, sr, 0.001, 0.08);
    },
  },
  comboRiser: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 0.45);
      addNoise(out, sr, rnd, 0, 0.45, 0.6, { type: 'bp', f: 700, f1: 5000, q: 2.5, attack: 0.3, env: (u) => Math.pow(u, 1.5) * (u > 0.92 ? (1 - u) / 0.08 : 1) });
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += (TAU * (300 * Math.pow(4, t / 0.45))) / sr;
        out[i] += Math.sin(ph) * 0.15 * (t / 0.45) * (t > 0.41 ? (0.45 - t) / 0.04 : 1);
      }
      return fade(out, sr, 0.005, 0.01);
    },
  },

  // Bonus: cash register "ka-ching": drawer clunk + bell + coins.
  register: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 1.4);
      addMode(out, sr, 0, 160, 0.05, 0.6, { fEnd: 90, chirp: 0.04 });
      addNoise(out, sr, rnd, 0, 0.05, 0.4, { type: 'bp', f: 1500, q: 1, decay: 0.012 });
      addClick(out, sr, 0, 0.4);
      addTone(out, sr, 0.07, 2093, [[1, 1, 0.8], [2.76, 0.35, 0.3], [5.4, 0.12, 0.12]], 0.45);
      addTone(out, sr, 0.07, 2637, [[1, 0.7, 0.7], [2.76, 0.2, 0.25]], 0.45);
      for (let i = 0; i < 10; i++) {
        const t = rr(rnd, 0.12, 0.5);
        for (const r of [1, 2.4, 3.7]) addMode(out, sr, t, rr(rnd, 3500, 6500) * r, 0.03 / r, 0.07);
      }
      return fade(out, sr, 0.0005, 0.15);
    },
  },

  // Fine: sad game-show buzzer "womp-womp".
  buzzer: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 1.2);
      const notes = [[0, 0.32, 196, 190], [0.36, 0.75, 185, 160]];
      for (const [t0, d, fa, fb] of notes) {
        const s0 = Math.floor(t0 * sr), n = Math.floor(d * sr);
        let p1 = 0, p2 = 0;
        for (let i = 0; i < n && s0 + i < out.length; i++) {
          const t = i / sr;
          const f = fa + (fb - fa) * (t / d);
          p1 += f / sr; p1 -= Math.floor(p1);
          p2 += (f * 1.012) / sr; p2 -= Math.floor(p2);
          const e = Math.min(1, t / 0.015) * Math.min(1, (d - t) / 0.06) * (0.8 + 0.2 * Math.sin(TAU * 5 * t));
          out[s0 + i] += ((p1 < 0.5 ? 1 : -1) * 0.5 + (2 * p2 - 1) * 0.5) * e * 0.5;
        }
      }
      filter(out, sr, 'lp', 1400, 1.5);
      filter(out, sr, 'peak', 600, 2, 5);
      softClip(out, 1.4);
      return fade(out, sr, 0.001, 0.05);
    },
  },

  // Results star stinger (played at three ascending pitches); star3 adds a shimmer.
  star: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 1.6);
      addTone(out, sr, 0, mtof(79), BELL, 0.35);
      addTone(out, sr, 0.015, mtof(86), VIBES, 0.3);
      addTone(out, sr, 0.03, mtof(91), VIBES, 0.2);
      addMode(out, sr, 0, 120, 0.12, 0.5, { fEnd: 60, chirp: 0.1 });
      for (let i = 0; i < 12; i++) addMode(out, sr, rr(rnd, 0.02, 0.6), rr(rnd, 5000, 10000), 0.04, 0.05);
      return fade(out, sr, 0.001, 0.2);
    },
  },
  star3: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 2.2);
      seqNotes(out, sr, [[0, 77], [0.06, 81], [0.12, 84], [0.18, 88], [0.24, 91]], VIBES, 0.25);
      addNoise(out, sr, rnd, 0, 1.2, 0.15, { type: 'bp', f: 6000, q: 1, attack: 0.1, env: (u) => Math.pow(1 - u, 2) });
      return fade(out, sr, 0.001, 0.3);
    },
  },

  tick: {
    variants: 2,
    render(sr, rnd, v) {
      const out = buf(sr, 0.08);
      addClick(out, sr, 0, 0.3);
      addTone(out, sr, 0, v ? 1250 : 1150, [[1, 1, 0.018], [2.7, 0.4, 0.008]], 1);
      return fade(out, sr, 0.0002, 0.01);
    },
  },
  tickUrgent: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 0.22);
      addTone(out, sr, 0, 1760, [[1, 1, 0.07], [2, 0.3, 0.04], [3, 0.15, 0.02]], 1);
      addTone(out, sr, 0, 1765, [[1, 0.5, 0.08]], 1);
      return fade(out, sr, 0.0005, 0.02);
    },
  },

  achievement: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 2.0);
      seqNotes(out, sr, [[0, 72], [0.07, 76], [0.14, 79], [0.21, 83], [0.28, 84, 1.2], [0.28, 88, 0.6], [0.28, 79, 0.5]], VIBES, 0.3);
      return fade(out, sr, 0.001, 0.3);
    },
  },

  jingleStart: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 1.8);
      seqNotes(out, sr, [[0, 72], [0.12, 77], [0.24, 81], [0.36, 84, 1.2]], VIBES, 0.35);
      addTone(out, sr, 0.36, mtof(72), BELL, 0.2);
      addMode(out, sr, 0.36, 90, 0.15, 0.5, { fEnd: 50, chirp: 0.1 });
      addNoise(out, sr, rnd, 0.0, 0.36, 0.1, { type: 'bp', f: 1000, f1: 5000, q: 2, attack: 0.3, env: (u) => u });
      return fade(out, sr, 0.001, 0.3);
    },
  },
  jingleComplete: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 2.6);
      seqNotes(out, sr, [[0, 72], [0.14, 76], [0.28, 79], [0.5, 77], [0.5, 81], [0.5, 84], [0.5, 88, 0.7]], VIBES, 0.3);
      addTone(out, sr, 0.5, mtof(65), BELL, 0.18);
      return fade(out, sr, 0.001, 0.4);
    },
  },
  jingleTimeout: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 2.6);
      addTone(out, sr, 0, mtof(84), BELL, 0.3);
      addTone(out, sr, 0.35, mtof(84), BELL, 0.3);
      seqNotes(out, sr, [[0.8, 79], [1.0, 76], [1.2, 72], [1.45, 67, 1.2]], VIBES, 0.3);
      return fade(out, sr, 0.001, 0.4);
    },
  },
  jingleFailed: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 2.8);
      seqNotes(out, sr, [[0, 76], [0.22, 72.8], [0.44, 69.7], [0.7, 65.6, 1.2]], VIBES, 0.3);
      // sour low drone at the end
      const s0 = Math.floor(0.7 * sr), n = Math.floor(1.6 * sr);
      let p = 0;
      for (let i = 0; i < n && s0 + i < out.length; i++) {
        const t = i / sr;
        p += (mtof(41) * (1 - 0.03 * t)) / sr; p -= Math.floor(p);
        out[s0 + i] += (2 * p - 1) * 0.12 * Math.min(1, t / 0.05) * Math.exp(-t * 1.5);
      }
      return fade(filter(out, sr, 'lp', 3000, 0.7), sr, 0.001, 0.4);
    },
  },
  pauseOn: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 0.25);
      addTone(out, sr, 0, 660, [[1, 1, 0.06], [2, 0.2, 0.03]], 1, { fEnd: 440, chirp: 0.12 });
      return fade(out, sr, 0.001, 0.03);
    },
  },
  pauseOff: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 0.25);
      addTone(out, sr, 0, 440, [[1, 1, 0.06], [2, 0.2, 0.03]], 1, { fEnd: 660, chirp: 0.12 });
      return fade(out, sr, 0.001, 0.03);
    },
  },
};

