// Music instruments for the elevator-muzak bossa: rendered once at a base pitch and replayed at
// other pitches via playbackRate. `base` is the MIDI note each variant was rendered at.
import { buf, addMode, addClick, addNoise, addTone, filter, dcBlock, rr, fade, mtof, polyBlep, TAU, makeWobble } from '../dsp.js';

export const INSTRUMENT_BASES = {
  mi_ep: [52, 64],
  mi_vib: [72],
  mi_bass: [36],
  mi_flute: [72],
  mi_pad: [60],
};

export const INSTRUMENTS = {
  // Rhodes-ish electric piano (2-op FM + tine).
  mi_ep: {
    variants: 2,
    render(sr, rnd, v) {
      const f = mtof(INSTRUMENT_BASES.mi_ep[v]);
      const dur = 3.0;
      const out = buf(sr, dur);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const I = 0.3 + 1.6 * Math.exp(-t / 0.18);
        const mod = Math.sin(TAU * f * t) * I;
        const tine = Math.sin(TAU * f * 7.02 * t) * 0.12 * Math.exp(-t / 0.05);
        const car = Math.sin(TAU * f * t + mod) + tine + 0.1 * Math.sin(TAU * f * 2 * t) * Math.exp(-t / 0.6);
        const e = Math.min(1, t / 0.002) * (0.45 * Math.exp(-t / 0.3) + 0.55 * Math.exp(-t / 2.2));
        out[i] = car * e;
      }
      return fade(out, sr, 0.0005, 0.1);
    },
  },
  // Vibraphone with motor tremolo.
  mi_vib: {
    variants: 1,
    render(sr) {
      const f = mtof(72);
      const out = buf(sr, 2.6);
      addTone(out, sr, 0, f, [[1, 1, 1.4], [4, 0.2, 0.22], [10, 0.04, 0.05]], 1, { attack: 0.001 });
      for (let i = 0; i < out.length; i++) out[i] *= 1 - 0.28 * (0.5 + 0.5 * Math.sin(TAU * 5.4 * (i / sr)));
      addClick(out, sr, 0, 0.1);
      return fade(out, sr, 0.0005, 0.1);
    },
  },
  // Round fretless/upright-ish bass.
  mi_bass: {
    variants: 1,
    render(sr, rnd) {
      const f = mtof(36);
      const out = buf(sr, 1.8);
      addTone(out, sr, 0, f, [[1, 1, 0.9], [2, 0.45, 0.4], [3, 0.18, 0.2], [4, 0.08, 0.1]], 1, { attack: 0.006 });
      addNoise(out, sr, rnd, 0, 0.03, 0.25, { type: 'lp', f: 600, decay: 0.008 });
      filter(out, sr, 'lp', 1100, 0.7);
      return fade(dcBlock(out, sr, 25), sr, 0.001, 0.1);
    },
  },
  // Breathy "easy-listening" flute.
  mi_flute: {
    variants: 1,
    render(sr, rnd) {
      const f = mtof(72);
      const dur = 2.4;
      const out = buf(sr, dur);
      const w = makeWobble(rnd, 3, sr);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const vib = 1 + 0.006 * Math.min(1, Math.max(0, (t - 0.25) / 0.4)) * Math.sin(TAU * 5.2 * t);
        ph += (TAU * f * vib) / sr;
        const e = Math.min(1, t / 0.06) * (1 + 0.04 * w()) * (t > dur - 0.2 ? (dur - t) / 0.2 : 1);
        out[i] = (Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.07 * Math.sin(3 * ph)) * e;
      }
      addNoise(out, sr, rnd, 0, dur, 0.06, { type: 'bp', f: f * 2, q: 2, attack: 0.04, env: (u) => (u > 0.92 ? (1 - u) / 0.08 : 1) });
      addNoise(out, sr, rnd, 0, 0.06, 0.12, { type: 'bp', f: 3000, q: 1, decay: 0.02 });
      return fade(out, sr, 0.001, 0.05);
    },
  },
  // Soft string/organ pad for intensity layer.
  mi_pad: {
    variants: 1,
    render(sr, rnd) {
      const f = mtof(60);
      const dur = 3.2;
      const out = buf(sr, dur);
      const det = [-0.012, -0.005, 0, 0.006, 0.011];
      const ph = det.map(() => rnd());
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        let s = 0;
        for (let k = 0; k < det.length; k++) {
          const dt = (f * (1 + det[k])) / sr;
          ph[k] += dt; if (ph[k] >= 1) ph[k] -= 1;
          s += 2 * ph[k] - 1 - polyBlep(ph[k], dt);
        }
        out[i] = s * 0.2 * Math.min(1, t / 0.45) * (t > dur - 0.4 ? (dur - t) / 0.4 : 1);
      }
      filter(out, sr, 'lp', 1500, 0.6);
      filter(out, sr, 'lp', 2500, 0.6);
      return out;
    },
  },
  md_shaker: {
    variants: 3,
    render(sr, rnd) {
      const out = buf(sr, 0.09);
      addNoise(out, sr, rnd, 0, 0.09, 1, { type: 'hp', f: rr(rnd, 5000, 6500), attack: rr(rnd, 0.006, 0.012), decay: rr(rnd, 0.018, 0.03), steep: true });
      return fade(out, sr, 0.0005, 0.01);
    },
  },
  md_rim: {
    variants: 2,
    render(sr, rnd) {
      const out = buf(sr, 0.1);
      addClick(out, sr, 0, 0.6);
      addMode(out, sr, 0, rr(rnd, 1650, 1800), 0.012, 0.8);
      addMode(out, sr, 0, rr(rnd, 420, 480), 0.02, 0.5);
      addNoise(out, sr, rnd, 0, 0.02, 0.3, { type: 'bp', f: 3500, q: 1, decay: 0.004 });
      return fade(out, sr, 0.0002, 0.01);
    },
  },
  md_kick: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 0.35);
      addMode(out, sr, 0, 105, 0.13, 1, { fEnd: 48, chirp: 0.06, attack: 0.002 });
      return fade(dcBlock(out, sr, 25), sr, 0.0005, 0.03);
    },
  },
  md_brush: {
    variants: 2,
    render(sr, rnd) {
      const out = buf(sr, 0.22);
      addNoise(out, sr, rnd, 0, 0.22, 1, { type: 'bp', f: rr(rnd, 2500, 3500), q: 0.8, attack: 0.03, env: (u) => Math.pow(1 - u, 2) });
      return fade(out, sr, 0.001, 0.02);
    },
  },
  md_conga: {
    variants: 2,
    render(sr, rnd, v) {
      const out = buf(sr, 0.3);
      const f = v ? 330 : 220;
      addMode(out, sr, 0, f * 1.08, 0.11, 1, { fEnd: f, chirp: 0.03 });
      addMode(out, sr, 0, f * 1.6, 0.03, 0.25);
      addNoise(out, sr, rnd, 0, 0.02, 0.3, { type: 'bp', f: 2500, q: 1, decay: 0.005 });
      return fade(dcBlock(out, sr, 40), sr, 0.0005, 0.02);
    },
  },
  md_hat: {
    variants: 2,
    render(sr, rnd) {
      const out = buf(sr, 0.06);
      addNoise(out, sr, rnd, 0, 0.06, 1, { type: 'hp', f: 7500, decay: 0.012, steep: true });
      for (const r of [1, 1.34, 1.79]) addMode(out, sr, 0, 6100 * r, 0.01, 0.15);
      return fade(out, sr, 0.0002, 0.01);
    },
  },
};
