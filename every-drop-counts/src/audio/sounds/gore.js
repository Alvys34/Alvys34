// Gore: squelches, splats, splashes, spurts, bone cracks, tears, flesh thuds and hazard contacts.
// Each definition renders one mono variant into a Float32Array. Variation comes from the variant
// index (seeded RNG) at render time plus random pitch/gain at playback.
import {
  buf, addMode, addBubble, addClick, addNoise, softClip, filter, dcBlock, rr, makeWobble, fade,
} from '../dsp.js';

/** Wet "gurgle" amplitude modulator: jagged random 20-70 Hz flutter. */
function gurgle(rnd, sr, rate, depth) {
  const w = makeWobble(rnd, rate, sr);
  const w2 = makeWobble(rnd, rate * 2.7, sr);
  return () => Math.max(0, 1 - depth + depth * (0.6 * w() + 0.5 * w2() + 0.4));
}

/** Core wet layer used by most gore: swept band noise + bubble cluster. */
function wetLayer(out, sr, rnd, t0, dur, amp, o = {}) {
  const g = gurgle(rnd, sr, rr(rnd, 25, 55), 0.8);
  const fHi = o.fHi ?? rr(rnd, 900, 1700);
  const fLo = o.fLo ?? rr(rnd, 260, 450);
  // AM uses a per-sample generator so must be called sequentially: addNoise calls am(t) in order.
  addNoise(out, sr, rnd, t0, dur, amp, {
    type: 'bp', f: fHi, f1: fLo, q: o.q ?? rr(rnd, 1.6, 3.2), attack: 0.003,
    env: (u) => Math.pow(1 - u, 1.6), am: () => g(),
  });
  const nb = o.bubbles ?? Math.floor(rr(rnd, 6, 14));
  for (let i = 0; i < nb; i++) {
    const t = t0 + Math.pow(rnd(), 1.5) * dur * 0.8;
    const age = (t - t0) / dur;
    addBubble(out, sr, t, rr(rnd, o.bubLo ?? 220, o.bubHi ?? 1100) * (1 - 0.4 * age), rr(rnd, 0.012, 0.045),
      amp * rr(rnd, 0.25, 0.7) * (1 - age * 0.7), rr(rnd, 0.3, 1.4));
  }
}

function lowSlap(out, sr, rnd, t0, amp, f = 100) {
  addMode(out, sr, t0, f * rr(rnd, 1.2, 1.6), rr(rnd, 0.05, 0.09), amp, { fEnd: f * 0.5, chirp: 0.08, attack: 0.001 });
  addNoise(out, sr, rnd, t0, 0.05, amp * 0.6, { type: 'lp', f: rr(rnd, 700, 1300), decay: 0.012 });
}

export const GORE = {
  // Big wet squelch: body slap + swept wet noise + bubbles + suck tail.
  squelch: {
    variants: 8,
    render(sr, rnd, v) {
      const big = v >= 5; // last variants are bigger/longer
      const dur = big ? rr(rnd, 0.6, 0.8) : rr(rnd, 0.32, 0.5);
      const out = buf(sr, dur + 0.05);
      lowSlap(out, sr, rnd, 0, 0.45, rr(rnd, 110, 150));
      wetLayer(out, sr, rnd, 0.004, dur * 0.85, 1.1, { bubbles: big ? 24 : 14 });
      // slick top: short sticky smack
      addNoise(out, sr, rnd, 0, 0.05, 0.35, { type: 'bp', f: rr(rnd, 2200, 3500), q: 1.2, decay: 0.012 });
      // secondary "slop" as the mass settles
      if (rnd() < 0.8) wetLayer(out, sr, rnd, dur * rr(rnd, 0.25, 0.4), dur * 0.5, 0.4, { fHi: 700, fLo: 250, bubbles: 6 });
      // suck: low noise swell
      addNoise(out, sr, rnd, dur * 0.1, dur * 0.7, 0.25, { type: 'lp', f: 380, q: 1.5, env: (u) => Math.sin(Math.PI * u) * (1 - u) });
      filter(out, sr, 'lp', 6000, 0.7);
      softClip(out, 1.6);
      return fade(dcBlock(out, sr, 30), sr, 0.0005, 0.03);
    },
  },

  // Droplet landing ("glassy drip"): click + rising bubble + tiny pat.
  splat: {
    variants: 10,
    render(sr, rnd) {
      const out = buf(sr, 0.16);
      addClick(out, sr, 0, rr(rnd, 0.15, 0.3));
      addNoise(out, sr, rnd, 0, 0.012, 0.3, { type: 'hp', f: rr(rnd, 1800, 3500), decay: 0.003 });
      addMode(out, sr, 0, rr(rnd, 160, 260), 0.012, 0.35);
      const nb = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < nb; i++) {
        addBubble(out, sr, rr(rnd, 0.001, 0.04), rr(rnd, 650, 1900), rr(rnd, 0.025, 0.05), i ? rr(rnd, 0.3, 0.6) : 0.8, rr(rnd, 0.5, 1.6));
      }
      return fade(dcBlock(out, sr, 60), sr, 0.0002, 0.02);
    },
  },

  // Larger splat (a gob hitting the wall/glass).
  splatBig: {
    variants: 6,
    render(sr, rnd) {
      const out = buf(sr, 0.32);
      lowSlap(out, sr, rnd, 0, 0.6, rr(rnd, 120, 170));
      wetLayer(out, sr, rnd, 0.002, 0.24, 0.7, { fHi: rr(rnd, 1400, 2400), fLo: rr(rnd, 500, 700), bubbles: 8, bubLo: 400, bubHi: 1600 });
      softClip(out, 1.3);
      return fade(dcBlock(out, sr, 50), sr, 0.0003, 0.03);
    },
  },

  // Something hits the blood pool: plop + spray + bubbles + slosh.
  splash: {
    variants: 6,
    render(sr, rnd, v) {
      const dur = v >= 4 ? 1.2 : rr(rnd, 0.6, 0.9);
      const out = buf(sr, dur);
      addMode(out, sr, 0, rr(rnd, 150, 220), 0.06, 0.8, { fEnd: 60, chirp: 0.07 });
      addNoise(out, sr, rnd, 0.002, dur * 0.5, 0.6, { type: 'bp', f: rr(rnd, 2500, 3500), f1: 700, q: 0.8, decay: dur * 0.12 });
      addNoise(out, sr, rnd, 0.01, dur * 0.9, 0.3, { type: 'lp', f: 500, q: 1.4, env: (u) => Math.sin(Math.PI * Math.min(1, u * 2.5)) * Math.pow(1 - u, 2) });
      const nb = v >= 4 ? 45 : 25;
      for (let i = 0; i < nb; i++) {
        const t = Math.pow(rnd(), 1.8) * dur * 0.85;
        const age = t / dur;
        addBubble(out, sr, t, rr(rnd, 300, 1800) * (1 - age * 0.5), rr(rnd, 0.01, 0.05), rr(rnd, 0.2, 0.6) * (1 - age), rr(rnd, 0.4, 1.5));
      }
      softClip(out, 1.2);
      return fade(dcBlock(out, sr, 35), sr, 0.0003, 0.05);
    },
  },

  // Arterial spurt: pulsing pressurised hiss + gurgle + spray patter.
  spurt: {
    variants: 4,
    render(sr, rnd) {
      const dur = rr(rnd, 1.1, 1.5);
      const out = buf(sr, dur);
      const period = rr(rnd, 0.32, 0.42);
      const pulse = (t) => {
        const ph = (t % period) / period;
        const beat = ph < 0.12 ? ph / 0.12 : Math.exp(-(ph - 0.12) * 5);
        return (0.25 + 0.75 * beat) * Math.exp(-t * 0.9);
      };
      addNoise(out, sr, rnd, 0, dur, 0.55, { type: 'bp', f: rr(rnd, 2200, 3200), q: 0.9, attack: 0.01, env: (u, t) => pulse(t) });
      addNoise(out, sr, rnd, 0, dur, 0.35, { type: 'hp', f: 5000, attack: 0.01, env: (u, t) => pulse(t) * 0.8 });
      const g = gurgle(rnd, sr, 40, 0.9);
      addNoise(out, sr, rnd, 0, dur, 0.5, { type: 'bp', f: 520, q: 2.5, attack: 0.01, env: (u, t) => pulse(t), am: () => g() });
      for (let i = 0; i < 40; i++) {
        const t = rnd() * dur * 0.9;
        addBubble(out, sr, t, rr(rnd, 700, 2500), rr(rnd, 0.008, 0.025), 0.3 * pulse(t), rr(rnd, 0.5, 1.5));
      }
      return fade(dcBlock(out, sr, 80), sr, 0.005, 0.1);
    },
  },

  // Bone crack/snap: a few clicks exciting short bright modes + woody thock.
  crack: {
    variants: 8,
    render(sr, rnd, v) {
      const out = buf(sr, 0.22);
      const clicks = 2 + Math.floor(rnd() * 3);
      for (let c = 0; c < clicks; c++) {
        const t = c === 0 ? 0 : rr(rnd, 0.002, 0.022);
        const a = c === 0 ? 1 : rr(rnd, 0.3, 0.7);
        addClick(out, sr, t, a * 0.9);
        for (let m = 0; m < 3; m++) addMode(out, sr, t, rr(rnd, 1500, 4800), rr(rnd, 0.003, 0.012), a * 0.5);
        addNoise(out, sr, rnd, t, 0.03, a * 0.6, { type: 'hp', f: rr(rnd, 1500, 2600), decay: 0.006 });
      }
      // woody "thock" (dense bone body)
      addMode(out, sr, 0, rr(rnd, 280, 650), rr(rnd, 0.015, 0.03), 0.7);
      addMode(out, sr, 0, rr(rnd, 900, 1300), rr(rnd, 0.008, 0.015), 0.4);
      // splintering crackle tail
      const tail = v % 2 ? 6 : 3;
      for (let i = 0; i < tail; i++) {
        const t = rr(rnd, 0.02, 0.09);
        addClick(out, sr, t, rr(rnd, 0.1, 0.35));
        addMode(out, sr, t, rr(rnd, 2000, 5000), 0.004, 0.2);
      }
      softClip(out, 1.8);
      return fade(dcBlock(out, sr, 120), sr, 0.0001, 0.02);
    },
  },

  // Wet tear (sever): ripping band noise sweeping down with jagged grain.
  rip: {
    variants: 5,
    render(sr, rnd) {
      const dur = rr(rnd, 0.22, 0.34);
      const out = buf(sr, dur + 0.05);
      const grain = makeWobble(rnd, rr(rnd, 90, 180), sr);
      addNoise(out, sr, rnd, 0, dur, 0.9, {
        type: 'bp', f: rr(rnd, 2400, 3400), f1: rr(rnd, 500, 800), q: 1.3, attack: 0.004,
        env: (u) => Math.pow(1 - u, 1.2), am: () => Math.max(0, 0.3 + grain() * 1.2),
      });
      wetLayer(out, sr, rnd, dur * 0.3, dur * 0.7, 0.4, { bubbles: 5 });
      softClip(out, 1.4);
      return fade(dcBlock(out, sr, 80), sr, 0.002, 0.03);
    },
  },

  // Meaty thud on flesh impact.
  thud: {
    variants: 8,
    render(sr, rnd) {
      const out = buf(sr, 0.26);
      addMode(out, sr, 0, rr(rnd, 170, 220), rr(rnd, 0.045, 0.06), 1, { fEnd: rr(rnd, 105, 125), chirp: 0.04 });
      addMode(out, sr, 0, rr(rnd, 320, 420), 0.04, 0.75, { fEnd: 210, chirp: 0.03 });
      addNoise(out, sr, rnd, 0, 0.07, 0.8, { type: 'lp', f: rr(rnd, 1300, 2000), decay: 0.018 });
      addNoise(out, sr, rnd, 0, 0.015, 0.4, { type: 'bp', f: rr(rnd, 1500, 2500), q: 1, decay: 0.004 });
      if (rnd() < 0.7) addBubble(out, sr, rr(rnd, 0.005, 0.03), rr(rnd, 250, 500), 0.03, 0.25, 0.8);
      softClip(out, 2.0);
      return fade(dcBlock(out, sr, 30), sr, 0.0002, 0.03);
    },
  },

  // Saw cutting flesh: tooth-rate AM ripping noise + loaded whine dip + wet.
  sawCut: {
    variants: 5,
    render(sr, rnd) {
      const dur = rr(rnd, 0.4, 0.55);
      const out = buf(sr, dur + 0.05);
      const tooth = rr(rnd, 120, 190);
      addNoise(out, sr, rnd, 0, dur, 0.8, {
        type: 'bp', f: rr(rnd, 1800, 2600), f1: rr(rnd, 1200, 1700), q: 1.6, attack: 0.008, steep: true,
        env: (u) => Math.pow(1 - u, 0.8), am: (t) => 0.4 + 0.6 * Math.max(0, Math.sin(Math.PI * 2 * tooth * t)),
      });
      // whine bogging down
      const f0 = rr(rnd, 850, 1050);
      addMode(out, sr, 0, f0, dur * 0.4, 0.22, { fEnd: f0 * 0.82, chirp: dur * 0.6, attack: 0.01 });
      addMode(out, sr, 0, f0 * 2.01, dur * 0.3, 0.12, { fEnd: f0 * 1.64, chirp: dur * 0.6, attack: 0.01 });
      for (let i = 0; i < 4; i++) { const t = rr(rnd, 0, dur * 0.5); addClick(out, sr, t, 0.3); addMode(out, sr, t, rr(rnd, 1800, 4000), 0.006, 0.25); }
      wetLayer(out, sr, rnd, 0.01, dur * 0.9, 0.55, { bubbles: 10 });
      softClip(out, 1.5);
      return fade(dcBlock(out, sr, 60), sr, 0.002, 0.04);
    },
  },

  // Spike impale "shunk": metallic scrape then deep thud and squish.
  shunk: {
    variants: 5,
    render(sr, rnd) {
      const out = buf(sr, 0.55);
      addNoise(out, sr, rnd, 0, 0.07, 1.0, { type: 'bp', f: rr(rnd, 2500, 3500), f1: rr(rnd, 5000, 7000), q: 2.5, attack: 0.006, env: (u) => Math.pow(1 - u, 0.7) });
      const tHit = rr(rnd, 0.045, 0.06);
      addMode(out, sr, tHit, rr(rnd, 150, 190), 0.1, 0.7, { fEnd: 70, chirp: 0.08 });
      for (const r of [1, 2.32, 3.9]) addMode(out, sr, tHit, rr(rnd, 420, 620) * r, rr(rnd, 0.05, 0.1) / r, 0.45);
      addNoise(out, sr, rnd, tHit, 0.06, 0.6, { type: 'lp', f: 1100, decay: 0.015 });
      wetLayer(out, sr, rnd, tHit + 0.01, 0.35, 0.6, { fHi: 900, fLo: 300, bubbles: 9 });
      softClip(out, 1.8);
      return fade(dcBlock(out, sr, 30), sr, 0.001, 0.04);
    },
  },

  // Grinder chewing: irregular crunch train over a wet churn.
  grindCrunch: {
    variants: 5,
    render(sr, rnd) {
      const dur = rr(rnd, 0.6, 0.8);
      const out = buf(sr, dur + 0.05);
      const n = 5 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * dur * 0.85 + rr(rnd, 0, 0.03);
        const a = rr(rnd, 0.4, 1);
        addClick(out, sr, t, a * 0.8);
        for (let m = 0; m < 3; m++) addMode(out, sr, t + rr(rnd, 0, 0.008), rr(rnd, 1200, 3800), rr(rnd, 0.004, 0.012), a * 0.6);
        addMode(out, sr, t, rr(rnd, 180, 300), 0.035, a * 0.4, { fEnd: 110, chirp: 0.03 });
        addNoise(out, sr, rnd, t, 0.06, a * 0.7, { type: 'bp', f: rr(rnd, 900, 1800), q: 0.9, decay: 0.015 });
      }
      wetLayer(out, sr, rnd, 0, dur, 0.4, { fHi: 1000, fLo: 350, bubbles: 14 });
      softClip(out, 1.7);
      return fade(dcBlock(out, sr, 40), sr, 0.001, 0.05);
    },
  },

  // Crusher piston hitting a body: heavy metal slam + crunch + squelch + air release.
  crushHit: {
    variants: 4,
    render(sr, rnd) {
      const out = buf(sr, 1.0);
      addMode(out, sr, 0, rr(rnd, 75, 95), 0.25, 1, { fEnd: 40, chirp: 0.12 });
      for (const r of [1, 1.47, 2.09, 2.56, 3.3]) addMode(out, sr, 0, rr(rnd, 160, 230) * r, rr(rnd, 0.08, 0.25) / Math.sqrt(r), 0.25);
      addNoise(out, sr, rnd, 0, 0.1, 0.8, { type: 'lp', f: 1600, decay: 0.025 });
      for (let i = 0; i < 4; i++) { const t = rr(rnd, 0.005, 0.05); addClick(out, sr, t, 0.5); addMode(out, sr, t, rr(rnd, 1500, 4000), 0.008, 0.3); }
      wetLayer(out, sr, rnd, 0.02, 0.5, 0.7, { bubbles: 14 });
      addNoise(out, sr, rnd, 0.15, 0.7, 0.25, { type: 'hp', f: 3500, attack: 0.05, env: (u) => Math.pow(1 - u, 2) });
      softClip(out, 2.0);
      return fade(dcBlock(out, sr, 28), sr, 0.0005, 0.08);
    },
  },
};
