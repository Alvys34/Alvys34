// Machinery and props: metal/glass/prop impacts, hydraulic slam, hatch, crusher telegraph,
// oxygen tank puncture/rocket/explosion, safety-sphere crack/shatter, grinder clog/clear.
import {
  buf, addMode, addBubble, addClick, addNoise, addTone, softClip, filter, dcBlock, rr, makeWobble, fade, TAU, mtof,
} from '../dsp.js';

const PLATE = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5];

export const MACHINES = {
  // Metal impact clang (inharmonic plate modes).
  clang: {
    variants: 6,
    render(sr, rnd) {
      const out = buf(sr, 0.9);
      const f = rr(rnd, 280, 620);
      addClick(out, sr, 0, 0.6);
      for (const r of PLATE) addMode(out, sr, 0, f * r * rr(rnd, 0.97, 1.03), rr(rnd, 0.08, 0.45) / Math.sqrt(r), rr(rnd, 0.2, 0.5));
      addNoise(out, sr, rnd, 0, 0.03, 0.4, { type: 'hp', f: 2500, decay: 0.006 });
      addMode(out, sr, 0, rr(rnd, 90, 140), 0.04, 0.4);
      return fade(dcBlock(out, sr, 50), sr, 0.0002, 0.1);
    },
  },

  // Glass tink.
  tink: {
    variants: 5,
    render(sr, rnd) {
      const out = buf(sr, 0.6);
      const f = rr(rnd, 2000, 3400);
      addClick(out, sr, 0, 0.4);
      for (const [r, a] of [[1, 1], [2.32, 0.5], [4.25, 0.3], [6.63, 0.15]]) addMode(out, sr, 0, f * r, rr(rnd, 0.06, 0.25) / r, a * 0.5);
      return fade(dcBlock(out, sr, 200), sr, 0.0002, 0.05);
    },
  },

  // Hollow prop knock (plastic/wood).
  knock: {
    variants: 5,
    render(sr, rnd) {
      const out = buf(sr, 0.22);
      const f = rr(rnd, 200, 420);
      addClick(out, sr, 0, 0.5);
      for (const [r, a] of [[1, 1], [2.45, 0.5], [3.9, 0.3]]) addMode(out, sr, 0, f * r, rr(rnd, 0.02, 0.06), a * 0.6);
      addNoise(out, sr, rnd, 0, 0.02, 0.3, { type: 'bp', f: 1800, q: 1, decay: 0.004 });
      return fade(dcBlock(out, sr, 60), sr, 0.0002, 0.02);
    },
  },

  // Hydraulic SLAM: sub thump + body + metal rattle + hydraulic hiss.
  slam: {
    variants: 3,
    render(sr, rnd) {
      const out = buf(sr, 1.6);
      // sub drop
      addMode(out, sr, 0, rr(rnd, 95, 115), 0.35, 1.2, { fEnd: 36, chirp: 0.16, attack: 0.002 });
      addMode(out, sr, 0, rr(rnd, 52, 58), 0.45, 0.6, { fEnd: 34, chirp: 0.3, attack: 0.004 });
      // impact body (mid punch so it reads on small speakers too)
      addNoise(out, sr, rnd, 0, 0.12, 0.9, { type: 'lp', f: 500, q: 1.2, decay: 0.03 });
      addMode(out, sr, 0, rr(rnd, 190, 230), 0.06, 0.6, { fEnd: 95, chirp: 0.05 });
      addNoise(out, sr, rnd, 0, 0.05, 0.4, { type: 'bp', f: 1200, q: 0.8, decay: 0.01 });
      addClick(out, sr, 0, 0.9);
      // drum shell clank
      for (const r of PLATE.slice(0, 6)) addMode(out, sr, 0.004, rr(rnd, 120, 160) * r, rr(rnd, 0.15, 0.4) / r, 0.35);
      // rattle: chains/bolts/bodies settling
      const nr = 30;
      for (let i = 0; i < nr; i++) {
        const t = 0.02 + Math.pow(rnd(), 1.7) * 0.7;
        const a = 0.5 * (1 - t / 0.75);
        addClick(out, sr, t, a * 0.5);
        addMode(out, sr, t, rr(rnd, 700, 3200), rr(rnd, 0.01, 0.04), a * 0.45);
      }
      // hydraulic hiss release
      addNoise(out, sr, rnd, 0.06, 0.7, 0.18, { type: 'bp', f: 4500, q: 0.7, attack: 0.03, env: (u) => Math.pow(1 - u, 1.5) });
      softClip(out, 2.2);
      return fade(dcBlock(out, sr, 22), sr, 0.0002, 0.15);
    },
  },

  // Slam ready: tiny pressure tick + soft blip.
  slamReady: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 0.2);
      addNoise(out, sr, rnd, 0, 0.06, 0.25, { type: 'bp', f: 6000, q: 1, attack: 0.01, decay: 0.015 });
      addClick(out, sr, 0.03, 0.3);
      addTone(out, sr, 0.03, 1480, [[1, 0.6, 0.05], [2, 0.15, 0.02]], 1, { attack: 0.002 });
      return fade(out, sr, 0.0005, 0.02);
    },
  },

  // Intake hatch: latch clack, servo whirr, heavy clunk, small creak.
  hatch: {
    variants: 2,
    render(sr, rnd) {
      const out = buf(sr, 1.1);
      addClick(out, sr, 0, 0.6);
      for (const r of [1, 2.3, 3.7]) addMode(out, sr, 0, 1100 * r * rr(rnd, 0.95, 1.05), 0.02, 0.25);
      // servo
      const n = Math.floor(0.45 * sr), s0 = Math.floor(0.05 * sr);
      let ph = 0;
      const lp = new (class { constructor() { this.y = 0; } run(x) { this.y += 0.08 * (x - this.y); return this.y; } })();
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = 110 + 90 * (t / 0.45);
        ph += f / sr; ph -= Math.floor(ph);
        const e = Math.sin(Math.PI * (t / 0.45)) * 0.3;
        out[s0 + i] += lp.run(ph * 2 - 1) * e;
      }
      // heavy clunk
      const tc = 0.5;
      addMode(out, sr, tc, 140, 0.12, 0.9, { fEnd: 60, chirp: 0.08 });
      for (const r of PLATE.slice(0, 5)) addMode(out, sr, tc, rr(rnd, 180, 240) * r, rr(rnd, 0.08, 0.25) / r, 0.3);
      addNoise(out, sr, rnd, tc, 0.08, 0.6, { type: 'lp', f: 900, decay: 0.02 });
      // creak
      const cr = makeWobble(rnd, 6, sr);
      addNoise(out, sr, rnd, 0.62, 0.35, 0.15, { type: 'bp', f: 900, q: 12, attack: 0.05, env: (u) => Math.sin(Math.PI * u), am: () => 0.5 + 0.5 * cr() });
      softClip(out, 1.5);
      return fade(dcBlock(out, sr, 30), sr, 0.0002, 0.1);
    },
  },

  // Wave incoming: polite two-tone intake doorbell + pneumatic whoosh.
  intakeBell: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 1.6);
      const P = [[1, 1, 0.9], [2.0, 0.25, 0.35], [3.0, 0.08, 0.15], [4.2, 0.05, 0.08]];
      addTone(out, sr, 0, mtof(76), P, 0.5);
      addTone(out, sr, 0.34, mtof(72), P, 0.5);
      addNoise(out, sr, rnd, 0.2, 0.9, 0.12, { type: 'bp', f: 600, f1: 2400, q: 1.2, attack: 0.3, env: (u) => Math.sin(Math.PI * u) });
      return fade(out, sr, 0.001, 0.1);
    },
  },

  // Crusher telegraph: two warning beeps + rising pneumatic hiss.
  crusherTelegraph: {
    variants: 2,
    render(sr, rnd) {
      const out = buf(sr, 0.95);
      for (const t of [0, 0.22]) {
        const n = Math.floor(0.09 * sr), s0 = Math.floor(t * sr);
        for (let i = 0; i < n; i++) {
          const tt = i / sr;
          const sq = Math.sin(TAU * 1320 * tt) + 0.33 * Math.sin(TAU * 3960 * tt) + 0.2 * Math.sin(TAU * 6600 * tt);
          out[s0 + i] += sq * 0.22 * Math.min(1, i / 60) * Math.min(1, (n - i) / 200);
        }
      }
      addNoise(out, sr, rnd, 0.2, 0.72, 0.6, { type: 'bp', f: 1800, f1: 5200, q: 0.9, attack: 0.02, env: (u) => Math.pow(u, 1.6) * (u < 0.97 ? 1 : (1 - u) / 0.03) });
      addClick(out, sr, 0.9, 0.5);
      return fade(out, sr, 0.0005, 0.02);
    },
  },

  // Generic telegraph (non-crusher hazards).
  warnBeep: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 0.25);
      addTone(out, sr, 0, 1046, [[1, 1, 0.06], [3, 0.2, 0.03]], 0.4);
      addTone(out, sr, 0.11, 1046, [[1, 1, 0.06], [3, 0.2, 0.03]], 0.4);
      return fade(out, sr, 0.001, 0.02);
    },
  },

  // O2 tank puncture: metal pierce + pressure burst.
  puncture: {
    variants: 2,
    render(sr, rnd) {
      const out = buf(sr, 0.5);
      addClick(out, sr, 0, 0.9);
      for (const r of [1, 2.76, 5.4]) addMode(out, sr, 0, rr(rnd, 700, 900) * r, 0.08 / r, 0.35);
      addNoise(out, sr, rnd, 0.005, 0.45, 0.9, { type: 'hp', f: 3000, attack: 0.004, env: (u) => Math.pow(1 - u, 0.5) * (0.6 + 0.4 * (1 - u)) });
      addNoise(out, sr, rnd, 0.005, 0.45, 0.4, { type: 'bp', f: 7000, q: 2, attack: 0.004, env: (u) => 1 - u });
      return fade(dcBlock(out, sr, 80), sr, 0.0002, 0.05);
    },
  },

  // O2 tank rocketing around (~2.4 s): roaring hiss with whistle and wobble.
  rocket: {
    variants: 2,
    render(sr, rnd) {
      const dur = 2.4;
      const out = buf(sr, dur);
      const wob = makeWobble(rnd, 7, sr);
      addNoise(out, sr, rnd, 0, dur, 0.7, { type: 'bp', f: 2500, f1: 3500, q: 0.8, attack: 0.03, env: (u) => (u < 0.9 ? 1 : (1 - u) / 0.1), am: () => 0.7 + 0.3 * wob() });
      addNoise(out, sr, rnd, 0, dur, 0.6, { type: 'lp', f: 300, q: 1, attack: 0.05, env: (u) => (u < 0.9 ? 0.6 + 0.4 * u : (1 - u) / 0.1) });
      const wob2 = makeWobble(rnd, 4, sr);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = (1500 + 900 * (t / dur)) * (1 + 0.04 * wob2());
        ph += (TAU * f) / sr;
        const e = Math.min(1, t / 0.15) * (t > dur * 0.9 ? (dur - t) / (dur * 0.1) : 1);
        out[i] += Math.sin(ph) * 0.12 * e;
      }
      softClip(out, 1.3);
      return fade(dcBlock(out, sr, 40), sr, 0.01, 0.05);
    },
  },

  // Explosion: crack + boom + debris + shrapnel tinks.
  explosion: {
    variants: 3,
    render(sr, rnd) {
      const dur = 2.6;
      const out = buf(sr, dur);
      addClick(out, sr, 0, 1);
      addNoise(out, sr, rnd, 0, 0.03, 1, { type: 'hp', f: 1500, decay: 0.008 });
      addNoise(out, sr, rnd, 0, 1.8, 1.4, { type: 'lp', f: 900, f1: 120, q: 0.8, attack: 0.002, steep: true, decay: 0.35 });
      addNoise(out, sr, rnd, 0, 0.6, 0.8, { type: 'bp', f: 1100, f1: 500, q: 0.7, attack: 0.001, decay: 0.12 });
      addMode(out, sr, 0, 70, 0.5, 1.3, { fEnd: 28, chirp: 0.4 });
      addMode(out, sr, 0, 43, 0.7, 0.6, { fEnd: 25, chirp: 0.5, attack: 0.01 });
      for (let i = 0; i < 60; i++) {
        const t = 0.05 + Math.pow(rnd(), 2) * 1.8;
        const a = 0.4 * Math.exp(-t * 1.6);
        addClick(out, sr, t, a);
        addNoise(out, sr, rnd, t, 0.02, a, { type: 'bp', f: rr(rnd, 800, 3500), q: 2, decay: 0.004 });
      }
      for (let i = 0; i < 8; i++) {
        const t = rr(rnd, 0.1, 1.2);
        for (const r of PLATE.slice(0, 4)) addMode(out, sr, t, rr(rnd, 900, 1800) * r, 0.06 / r, 0.08);
      }
      softClip(out, 2.4);
      return fade(dcBlock(out, sr, 20), sr, 0.0002, 0.3);
    },
  },

  // Safety sphere crack: glassy crack with crackle run.
  glassCrack: {
    variants: 3,
    render(sr, rnd) {
      const out = buf(sr, 0.45);
      addClick(out, sr, 0, 1);
      for (const r of [1, 2.32, 4.25, 6.63]) addMode(out, sr, 0, rr(rnd, 1800, 2600) * r, 0.08 / r, 0.25);
      let t = 0.004;
      while (t < 0.12) {
        addClick(out, sr, t, rr(rnd, 0.2, 0.6));
        addMode(out, sr, t, rr(rnd, 3000, 8000), rr(rnd, 0.005, 0.02), 0.2);
        t += rr(rnd, 0.003, 0.015);
      }
      addNoise(out, sr, rnd, 0, 0.08, 0.3, { type: 'hp', f: 4000, decay: 0.02 });
      return fade(dcBlock(out, sr, 200), sr, 0.0001, 0.05);
    },
  },

  // Safety sphere shatter: burst + many tinkling shards.
  glassShatter: {
    variants: 2,
    render(sr, rnd) {
      const dur = 1.7;
      const out = buf(sr, dur);
      addClick(out, sr, 0, 1);
      addNoise(out, sr, rnd, 0, 0.25, 0.9, { type: 'hp', f: 2500, decay: 0.05 });
      addNoise(out, sr, rnd, 0, 0.1, 0.5, { type: 'lp', f: 900, decay: 0.03 });
      for (let i = 0; i < 70; i++) {
        const t = Math.pow(rnd(), 1.6) * dur * 0.85;
        const a = 0.35 * Math.exp(-t * 2.2) + 0.03;
        const f = rnd() < 0.2 ? rr(rnd, 1200, 2200) : rr(rnd, 2500, 8000);
        addClick(out, sr, t, a * 0.3);
        for (const [r, g] of [[1, 1], [2.32, 0.5], [4.25, 0.25]]) addMode(out, sr, t, f * r, rr(rnd, 0.03, 0.12) / r, a * g);
      }
      return fade(dcBlock(out, sr, 150), sr, 0.0001, 0.1);
    },
  },

  // Grinder clog: jam clunk + motor strain groan stalling.
  grinderClog: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 1.1);
      addMode(out, sr, 0, 120, 0.1, 0.9, { fEnd: 55, chirp: 0.08 });
      for (const r of PLATE.slice(0, 4)) addMode(out, sr, 0, 210 * r, 0.12 / r, 0.3);
      addNoise(out, sr, rnd, 0, 0.06, 0.5, { type: 'lp', f: 1200, decay: 0.02 });
      let ph = 0; const n = Math.floor(0.95 * sr);
      const lp = new (class { constructor() { this.y = 0; } run(x) { this.y += 0.05 * (x - this.y); return this.y; } })();
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const f = 95 * Math.pow(0.4, t / 0.9) * (1 + 0.05 * Math.sin(TAU * 9 * t));
        ph += f / sr; ph -= Math.floor(ph);
        const e = Math.min(1, t / 0.04) * (1 - t / 0.95);
        out[i] += lp.run(ph * 2 - 1) * e * 0.9;
      }
      softClip(out, 1.8);
      return fade(dcBlock(out, sr, 30), sr, 0.0002, 0.08);
    },
  },

  // Grinder clear: ka-chunk + wet blorp + motor revving back up.
  grinderClear: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 1.0);
      addMode(out, sr, 0, 150, 0.08, 0.8, { fEnd: 70, chirp: 0.06 });
      addClick(out, sr, 0, 0.6);
      addMode(out, sr, 0.09, 110, 0.1, 0.7, { fEnd: 50, chirp: 0.08 });
      for (let i = 0; i < 10; i++) addBubble(out, sr, rr(rnd, 0.05, 0.4), rr(rnd, 150, 500), rr(rnd, 0.03, 0.08), 0.4, 0.9);
      let ph = 0; const n = Math.floor(0.8 * sr), s0 = Math.floor(0.15 * sr);
      const lp = new (class { constructor() { this.y = 0; } run(x) { this.y += 0.06 * (x - this.y); return this.y; } })();
      for (let i = 0; i < n && s0 + i < out.length; i++) {
        const t = i / sr;
        const f = 40 + 60 * (1 - Math.exp(-t * 5));
        ph += f / sr; ph -= Math.floor(ph);
        out[s0 + i] += lp.run(ph * 2 - 1) * 0.6 * Math.min(1, t / 0.05) * (1 - t / 0.8);
      }
      softClip(out, 1.5);
      return fade(dcBlock(out, sr, 30), sr, 0.0002, 0.08);
    },
  },

  // Drum motor engage: relay clack + short servo spin-up.
  motorStart: {
    variants: 2,
    render(sr, rnd) {
      const out = buf(sr, 0.4);
      addClick(out, sr, 0, 0.7);
      for (const r of [1, 2.6]) addMode(out, sr, 0, rr(rnd, 1400, 1800) * r, 0.012, 0.3);
      addMode(out, sr, 0.01, 90, 0.06, 0.6, { fEnd: 60, chirp: 0.05 });
      addNoise(out, sr, rnd, 0.01, 0.3, 0.25, { type: 'bp', f: 300, f1: 900, q: 3, attack: 0.03, env: (u) => Math.sin(Math.PI * u) });
      return fade(dcBlock(out, sr, 30), sr, 0.0002, 0.04);
    },
  },
};

// Loop beds (rendered seamless; played looping).
export const LOOPS = {
  lpNoise: {
    variants: 1,
    render(sr, rnd) { const out = buf(sr, 2); for (let i = 0; i < out.length; i++) out[i] = rnd() * 2 - 1; return out; },
    peak: 0.9,
  },
  // dense droplet patter for heavy blood rain
  lpPatter: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 2);
      for (let i = 0; i < 160; i++) {
        const t = rnd() * 2;
        addBubble(out, sr, t, rr(rnd, 700, 2400), rr(rnd, 0.01, 0.04), rr(rnd, 0.2, 1), rr(rnd, 0.4, 1.6), true);
        if (rnd() < 0.5) addNoise(out, sr, rnd, t, 0.01, 0.3, { type: 'hp', f: 3000, decay: 0.002, wrap: true });
      }
      return out;
    },
  },
  // grinder: one chug cycle (rollers catching), looped & rate-controlled
  lpGrind: {
    variants: 1,
    render(sr, rnd) {
      const out = buf(sr, 0.5);
      for (const t of [0, 0.25]) {
        addMode(out, sr, t, 110, 0.06, 0.8, { fEnd: 60, chirp: 0.05, wrap: true });
        addNoise(out, sr, rnd, t, 0.14, 0.7, { type: 'bp', f: 700, q: 1.4, decay: 0.04, wrap: true });
        for (let i = 0; i < 5; i++) {
          const tt = t + rr(rnd, 0, 0.12);
          addMode(out, sr, tt, rr(rnd, 1200, 3000), 0.006, 0.25, { wrap: true });
        }
      }
      return out;
    },
  },
  // distant two-tone facility alarm
  lpAlarm: {
    variants: 1,
    render(sr) {
      const out = buf(sr, 2);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = t < 1 ? 660 : 550;
        ph += f / sr; ph -= Math.floor(ph);
        const sq = Math.sin(TAU * ph) + 0.3 * Math.sin(3 * TAU * ph) + 0.15 * Math.sin(5 * TAU * ph);
        const tl = t % 1;
        const e = Math.min(1, tl / 0.02) * Math.min(1, (1 - tl) / 0.05);
        out[i] = sq * e;
      }
      return filter(out, sr, 'lp', 2500, 0.7);
    },
  },
};
