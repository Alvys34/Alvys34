// Bus event -> sound mapping. Every handler is wrapped by the engine (never throws out).
// Payload magnitudes (size, speed×mass, rate, amount, intensity) have no fixed units in the
// contract, so they are normalised adaptively against a slow running average: an average event
// maps to ~0.5, a big one towards 1.
import { DUCK } from './mix.js';

class Adapt {
  constructor(init) { this.ref = init; }
  norm(x) {
    x = Math.max(0, Number(x) || 0);
    this.ref += (x - this.ref) * 0.01;
    if (this.ref < 1e-6) this.ref = 1e-6;
    return x / (x + this.ref);
  }
}

const semis = (s) => Math.pow(2, s / 12);
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

function hashId(id) {
  const s = String(id ?? '');
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Donor voice playback rate: by type, plus a stable per-donor offset so each keeps "their" voice. */
function voiceRate(type, id) {
  const t = String(type || '').toLowerCase();
  let r = 1;
  if (t.includes('big')) r = 0.76;
  else if (t.includes('thin')) r = 1.13;
  else if (t.includes('inspect')) r = 0.9;
  return r * (1 + ((hashId(id) % 13) - 6) / 100);
}

export function makeHandlers(eng) {
  const A = {
    size: new Adapt(1), splash: new Adapt(1), energy: new Adapt(20), rate: new Adapt(1),
    amount: new Adapt(10), intensity: new Adapt(0.5),
  };
  const lastHurt = new Map();
  const rockets = [];
  let deathWindowT = -1, deathWindowN = 0;

  const P = (cls, name, o) => eng.play(cls, name, o);
  const now = () => eng.ctx.currentTime;

  const H = {
    'shift:start'() {
      P('stinger', 'jingleStart', { gain: 0.8, force: true });
      eng.loops && eng.loops.reset();
      eng.music && eng.music.setArrangement('shift', now() + 1.6);
      eng.duckMusic(DUCK.jingle);
      lastHurt.clear();
    },
    'shift:end'(p) {
      const r = p && p.result;
      const name = r === 'complete' ? 'jingleComplete' : r === 'failed' ? 'jingleFailed' : 'jingleTimeout';
      P('stinger', name, { gain: 0.85, force: true });
      eng.music && eng.music.holdUntil(now() + 2.8, 'results');
      eng.duckMusic(1);
    },
    'wave:incoming'() { P('machine', 'intakeBell', { gain: 0.32 }); },
    'hatch:open'(p) { P('machine', 'hatch', { gain: 0.75, pan: p.pan }); },

    'donor:spawn'(p) {
      if (eng.rnd() < 0.7) P('vocal', 'vSpawn', { gain: 0.5, pan: p.pan, rate: voiceRate(p.type, p.id), delay: eng.rnd() * 0.35, pitch: 0.4 });
    },
    'donor:hurt'(p) {
      const t = now();
      const key = p.id ?? 'x';
      if (t - (lastHurt.get(key) ?? -9) < 0.7) return;
      lastHurt.set(key, t);
      if (lastHurt.size > 400) lastHurt.clear();
      const n = A.amount.norm(p.amount);
      P('vocal', 'vHurt', { gain: 0.4 + 0.45 * n, pan: p.pan, rate: voiceRate(p.type, p.id), pitch: 0.5 });
    },
    'donor:death'(p) {
      const t = now();
      lastHurt.delete(p.id ?? 'x');
      const rate = voiceRate(p.type, p.id);
      const pan = p.pan;
      // several deaths in quick succession duck the music harder
      if (t - deathWindowT > 1) { deathWindowT = t; deathWindowN = 0; }
      deathWindowN++;
      eng.duckMusic(deathWindowN >= 3 ? DUCK.massDeath : DUCK.death);
      switch (p.cause) {
        case 'drown':
          P('vocal', 'vDrown', { gain: 0.6, pan, rate, pitch: 0.3 });
          P('splash', 'splash', { gain: 0.25, pan, rate: 1.3 });
          break;
        case 'bleedout':
          P('vocal', 'vSigh', { gain: 0.45, pan, rate, pitch: 0.3 });
          P('splat', 'splatBig', { gain: 0.5, pan });
          break;
        case 'explode':
          P('vocal', 'vHurt', { gain: 0.6, pan, rate: rate * 1.15, v: 2 }); // "eep"
          P('squelch', 'squelch', { gain: 1, pan, rate: 0.85 });
          break;
        case 'crush':
          P('vocal', 'vDeath', { gain: 0.7, pan, rate, stop: 0.22 }); // cut off mid-word
          P('bone', 'crack', { gain: 0.9, pan, rate: 0.8 });
          P('squelch', 'squelch', { gain: 1, pan, rate: 0.8 });
          break;
        case 'grind':
          P('vocal', 'vDeath', { gain: 0.65, pan, rate, stop: 0.35 });
          P('hazard', 'grindCrunch', { gain: 0.8, pan });
          P('squelch', 'squelch', { gain: 0.9, pan });
          break;
        case 'cut':
          P('vocal', 'vDeath', { gain: 0.7, pan, rate });
          P('squelch', 'squelch', { gain: 1, pan });
          P('tear', 'rip', { gain: 0.7, pan });
          break;
        case 'impale':
          P('vocal', 'vDeath', { gain: 0.7, pan, rate });
          P('squelch', 'squelch', { gain: 0.95, pan, rate: 0.9 });
          break;
        case 'impact':
        default:
          P('vocal', 'vDeath', { gain: 0.7, pan, rate });
          P('thud', 'thud', { gain: 0.9, pan, rate: 0.85 });
          P('squelch', 'squelch', { gain: 0.9, pan });
          break;
      }
    },
    'limb:sever'(p) {
      P('bone', 'crack', { gain: 0.8, pan: p.pan });
      P('tear', 'rip', { gain: 0.75, pan: p.pan });
      P('squelch', 'squelch', { gain: 0.55, pan: p.pan, rate: 1.15 });
    },
    'limb:break'(p) {
      P('bone', 'crack', { gain: 0.8, pan: p.pan, rate: 0.9 });
      P('thud', 'thud', { gain: 0.4, pan: p.pan, rate: 1.1 });
    },
    impact(p) {
      const e = Math.max(0, num(p.speed)) * Math.max(0.05, num(p.mass, 1));
      const n = A.energy.norm(e);
      if (n < 0.2) return; // soft contacts stay silent
      const g = 0.2 + 0.8 * Math.min(1, (n - 0.2) / 0.7);
      switch (p.kind) {
        case 'metal': P('metal', 'clang', { gain: g, pan: p.pan, rate: 1.1 - 0.25 * n }); break;
        case 'glass': P('glass', 'tink', { gain: g, pan: p.pan }); break;
        case 'prop': P('prop', 'knock', { gain: g, pan: p.pan, rate: 1.1 - 0.3 * n }); break;
        case 'flesh':
        default:
          P('thud', 'thud', { gain: g, pan: p.pan, rate: 1.2 - 0.4 * n });
          if (n > 0.7) P('splat', 'splatBig', { gain: 0.5 * g, pan: p.pan });
          break;
      }
    },
    'blood:spurt'(p) {
      const n = A.rate.norm(p.rate);
      P('spurt', 'spurt', { gain: 0.35 + 0.65 * n, pan: p.pan });
    },
    'blood:splat'(p) {
      const n = A.size.norm(p.size);
      eng.patter += 0.3 + n;
      if (n > 0.75) P('splat', 'splatBig', { gain: 0.4 + 0.5 * n, pan: p.pan });
      else P('splat', 'splat', { gain: 0.35 + 0.65 * n, pan: p.pan, rate: 1.15 - 0.3 * n });
    },
    splash(p) {
      const n = A.splash.norm(p.size);
      P('splash', 'splash', { gain: 0.35 + 0.65 * n, pan: p.pan, rate: 1.2 - 0.4 * n });
    },
    'hazard:contact'(p) {
      const n = A.intensity.norm(p.intensity);
      const g = 0.5 + 0.5 * n;
      switch (p.hazard) {
        case 'saw':
          if (eng.loops) { eng.loops.sawSeen = true; eng.loops.sawBoost = 1; }
          P('hazard', 'sawCut', { gain: g, pan: p.pan });
          break;
        case 'spike': P('hazard', 'shunk', { gain: g, pan: p.pan }); break;
        case 'grinder':
          if (eng.loops) eng.loops.grinderSeen = true;
          P('hazard', 'grindCrunch', { gain: g, pan: p.pan });
          break;
        case 'crusher':
          P('hazard', 'crushHit', { gain: g, pan: p.pan });
          eng.duckMusic(0.3);
          break;
        default: P('hazard', 'shunk', { gain: g * 0.7, pan: p.pan });
      }
    },
    'hazard:telegraph'(p) {
      if (p.hazard === 'crusher' || !p.hazard) P('machine', 'crusherTelegraph', { gain: 0.6, pan: p.pan });
      else P('machine', 'warnBeep', { gain: 0.4, pan: p.pan });
    },
    'grinder:clog'(p) {
      if (eng.loops) { eng.loops.clogged = true; eng.loops.grinderSeen = true; }
      P('machine', 'grinderClog', { gain: 0.8, pan: p.pan, force: true });
    },
    'grinder:clear'(p) {
      if (eng.loops) eng.loops.clogged = false;
      P('machine', 'grinderClear', { gain: 0.8, pan: p.pan, force: true });
    },
    slam() {
      P('machine', 'slam', { gain: 1, force: true });
      eng.duckMusic(DUCK.slam);
    },
    'slam:ready'() { P('machine', 'slamReady', { gain: 0.35 }); },
    combo(p) {
      const m = Math.max(1, Math.min(8, Math.round(num(p.multiplier, 2))));
      const deg = [0, 0, 2, 4, 7, 9, 12, 14, 16][m];
      P('stinger', 'comboHit', { gain: 0.4 + 0.04 * m, rate: semis(deg), force: true });
      P('stinger', 'comboRiser', { gain: 0.25 + 0.04 * m, rate: semis(deg * 0.5) * (0.85 + 0.03 * m), force: true });
    },
    bonus() { P('stinger', 'register', { gain: 0.7, force: true }); },
    fine() { P('stinger', 'buzzer', { gain: 0.6, force: true }); },
    'prop:puncture'(p) {
      P('rocket', 'puncture', { gain: 0.8, pan: p.pan, force: true });
      const v = P('rocket', 'rocket', { gain: 0.7, pan: p.pan, delay: 0.12, force: true });
      if (v) { rockets.push({ v, pan: num(p.pan) }); if (rockets.length > 8) rockets.shift(); }
    },
    'prop:explode'(p) {
      // cut the rocket hiss nearest to this explosion
      let best = -1, bd = 9;
      for (let i = 0; i < rockets.length; i++) {
        const r = rockets[i];
        if (!r.v.alive) continue;
        const d = Math.abs(r.pan - num(p.pan));
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) { eng.voices.kill(rockets[best].v, now(), 0.02); rockets.splice(best, 1); }
      for (let i = rockets.length - 1; i >= 0; i--) if (!rockets[i].v.alive) rockets.splice(i, 1);
      P('boom', 'explosion', { gain: 1, pan: p.pan, force: true });
      eng.duckMusic(DUCK.explosion);
    },
    'sphere:crack'(p) { P('glass', 'glassCrack', { gain: 0.9, pan: p.pan, force: true }); },
    'sphere:shatter'(p) {
      P('glass', 'glassShatter', { gain: 1, pan: p.pan, force: true });
      eng.duckMusic(DUCK.shatter);
    },
    'pa:announce'(p) {
      const mood = p.mood === 'urgent' ? 'urgent' : p.mood === 'glitch' ? 'glitch' : 'calm';
      const chime = mood === 'urgent' ? 'paUrgent' : mood === 'glitch' ? 'paGlitch' : 'paCalm';
      P('pa', chime, { gain: 0.8, force: true });
      const len = Math.max(0.8, Math.min(2.5, 0.5 + String(p.text || '').length * 0.045));
      const delay = mood === 'urgent' ? 0.75 : mood === 'glitch' ? 1.25 : 1.3;
      P('pa', mood === 'glitch' ? 'paSpeechGlitch' : 'paSpeech', { gain: 0.55, delay, stop: len, force: true, rate: mood === 'urgent' ? 1.08 : 1 });
      eng.duckMusic(DUCK.pa);
    },
    'timer:warning'(p) {
      const s = num(p.secondsLeft, 10);
      if (s <= 5) P('stinger', 'tickUrgent', { gain: 0.45 });
      else P('stinger', 'tick', { gain: 0.5 });
    },
    'game:pause'(p) {
      eng.pausedHint = !!(p && p.paused);
      P('ui', eng.pausedHint ? 'pauseOn' : 'pauseOff', { gain: 1, force: true });
    },
    'ui:hover'() { P('ui', 'uiHover', { gain: 0.6 }); },
    'ui:click'() { P('ui', 'uiClick', { gain: 1, force: true }); },
    'ui:back'() { P('ui', 'uiBack', { gain: 1, force: true }); },
    'ui:star'(p) {
      const n = Math.max(1, Math.min(3, Math.round(num(p.n, 1))));
      P('stinger', 'star', { gain: 0.75, rate: [1, semis(4), semis(7)][n - 1], force: true });
      if (n === 3) P('stinger', 'star3', { gain: 0.6, delay: 0.05, force: true });
    },
    achievement() { P('stinger', 'achievement', { gain: 0.7, force: true }); },
  };
  return H;
}

export const EVENT_NAMES = [
  'shift:start', 'shift:end', 'wave:incoming', 'hatch:open', 'donor:spawn', 'donor:hurt', 'donor:death',
  'limb:sever', 'limb:break', 'impact', 'blood:spurt', 'blood:splat', 'splash', 'hazard:contact',
  'hazard:telegraph', 'grinder:clog', 'grinder:clear', 'slam', 'slam:ready', 'combo', 'bonus', 'fine',
  'prop:puncture', 'prop:explode', 'sphere:crack', 'sphere:shatter', 'pa:announce', 'timer:warning',
  'game:pause', 'ui:hover', 'ui:click', 'ui:back', 'ui:star', 'achievement',
];
