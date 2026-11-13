// Sound bank: lazily renders procedural definitions into AudioBuffers (one per variant), with a
// time-budgeted background warm-up so no single frame pays for many renders.
import { makeRng, normalize } from './dsp.js';
import { GORE } from './sounds/gore.js';
import { MACHINES, LOOPS } from './sounds/machines.js';
import { VOICE } from './sounds/voice.js';
import { UI } from './sounds/ui.js';
import { INSTRUMENTS } from './sounds/instruments.js';

export const DEFS = { ...GORE, ...MACHINES, ...LOOPS, ...VOICE, ...UI, ...INSTRUMENTS };

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class Bank {
  constructor(ctx, rnd, seed = 1) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.rnd = rnd;
    this.seed = seed;
    this.cache = new Map();
    this.last = new Map();
    this.queue = [];
    this.renderMs = 0;
    this.renderCount = 0;
    this.maxRenderMs = 0;
  }

  variants(name) { const d = DEFS[name]; return d ? d.variants || 1 : 0; }

  get(name, v = 0) {
    const key = name + '#' + v;
    const b = this.cache.get(key);
    if (b) return b;
    return this.render(name, v);
  }

  /** Random variant, never the same one twice in a row. */
  pick(name) {
    const n = this.variants(name);
    if (!n) return null;
    let v = Math.floor(this.rnd() * n);
    const last = this.last.get(name);
    if (n > 1 && v === last) v = (v + 1 + Math.floor(this.rnd() * (n - 1))) % n;
    this.last.set(name, v);
    return this.get(name, v);
  }

  render(name, v) {
    const def = DEFS[name];
    if (!def) return null;
    const t0 = nowMs();
    const rnd = makeRng((hashStr(name) ^ Math.imul(v + 1, 0x9e3779b1) ^ this.seed) >>> 0);
    let data = def.render(this.sr, rnd, v);
    // Never let a NaN/Inf into the graph: it would poison downstream filters permanently.
    for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) data[i] = 0;
    if (def.peak !== null) normalize(data, def.peak ?? 0.9);
    const b = this.ctx.createBuffer(1, data.length, this.sr);
    if (b.copyToChannel) b.copyToChannel(data, 0); else b.getChannelData(0).set(data);
    this.cache.set(name + '#' + v, b);
    const ms = nowMs() - t0;
    this.renderMs += ms;
    this.renderCount++;
    if (ms > this.maxRenderMs) this.maxRenderMs = ms;
    return b;
  }

  /** Queue every variant of the given names (in order) for background rendering. */
  enqueue(names) {
    for (const name of names) {
      const n = this.variants(name);
      for (let v = 0; v < n; v++) this.queue.push([name, v]);
    }
  }

  enqueueAll(priority = []) {
    const seen = new Set(priority);
    this.enqueue(priority);
    this.enqueue(Object.keys(DEFS).filter((k) => !seen.has(k)));
  }

  /** Render queued variants until `budgetMs` is spent. Returns remaining queue length. */
  warm(budgetMs = 2) {
    const t0 = nowMs();
    while (this.queue.length && nowMs() - t0 < budgetMs) {
      const [name, v] = this.queue.shift();
      if (!this.cache.has(name + '#' + v)) this.render(name, v);
    }
    return this.queue.length;
  }
}
