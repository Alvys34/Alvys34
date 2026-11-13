// One-shot voice manager: token-bucket rate limiting per class, per-class polyphony caps with
// oldest-voice stealing, a global cap with priority stealing, and strict node cleanup.
//
// A voice is BufferSource -> Gain -> (StereoPanner) -> class bus. Nothing heavier per event.

export class Voices {
  constructor(eng, maxTotal) {
    this.eng = eng;
    this.maxTotal = maxTotal;
    this.list = [];
    this.dying = new Set(); // killed voices waiting for 'ended'
    this.nodesLive = 0; // nodes created by voices and not yet disconnected
    this.stats = { played: 0, limited: 0, dropped: 0, stolen: 0, peakVoices: 0, swept: 0, created: 0, stripsMade: 0 };
    this.pool = [];
  }

  takeStrip(bus, now) {
    const ctx = this.eng.ctx;
    let s = this.pool.pop();
    if (!s) {
      const g = ctx.createGain();
      const p = this.eng.hasPanner ? ctx.createStereoPanner() : null;
      if (p) g.connect(p);
      s = { g, p, bus: null };
      this.stats.stripsMade++;
    } else {
      s.g.gain.cancelScheduledValues(0);
      if (s.p) s.p.pan.cancelScheduledValues(0);
    }
    if (s.bus !== bus) {
      const out = s.p || s.g;
      if (s.bus) { try { out.disconnect(s.bus); } catch (e) { /* noop */ } }
      out.connect(bus);
      s.bus = bus;
    }
    s.g.gain.setValueAtTime(0, now);
    return s;
  }

  giveStrip(s) {
    if (!s) return;
    if (this.pool.length < 64) this.pool.push(s);
    else { try { s.g.disconnect(); } catch (e) { /* noop */ } try { if (s.p) s.p.disconnect(); } catch (e) { /* noop */ } }
  }

  /**
   * Play a buffer on a sound class.
   * o: { gain, rate, pan, delay, v (variant), stop (seconds), force, pitch (extra semis spread) }
   */
  play(clsName, bufName, o = {}) {
    const eng = this.eng;
    const ctx = eng.ctx;
    const cls = eng.classes[clsName];
    if (!cls) return null;
    const now = ctx.currentTime;

    // token bucket
    if (!o.force) {
      cls.tokens = Math.min(cls.burst, cls.tokens + (now - cls.refillAt) * cls.rate);
      cls.refillAt = now;
      if (cls.tokens < 1) { this.stats.limited++; return null; }
      cls.tokens -= 1;
    }
    // stagger events that land in the same instant (prevents phasey stacking)
    if (cls.frameAt === now) cls.frameN++; else { cls.frameAt = now; cls.frameN = 0; }
    const stagger = cls.frameN ? cls.frameN * (0.008 + eng.rnd() * 0.012) : 0;
    const when = now + (o.delay || 0) + stagger;

    // per-class cap: steal oldest
    if (cls.voices.length >= cls.max) this.kill(cls.voices[0], now);
    // global cap: steal lowest priority / oldest, or drop if everything is more important
    if (this.list.length >= this.maxTotal) {
      let victim = null;
      for (const v of this.list) if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start)) victim = v;
      if (victim && victim.prio <= cls.prio) this.kill(victim, now);
      else { this.stats.dropped++; return null; }
    }

    const buffer = o.v != null ? eng.bank.get(bufName, o.v) : eng.bank.pick(bufName);
    if (!buffer) return null;

    const spread = (o.pitch ?? cls.pitch) || 0;
    const semis = spread ? (eng.rnd() * 2 - 1) * spread : 0;
    const rate = Math.max(0.05, (o.rate ?? 1) * Math.pow(2, semis / 12));

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    // Gain (+ panner) strips are pooled: only the BufferSource is created per voice.
    const strip = this.takeStrip(cls.bus, now);
    const g = strip.g, p = strip.p;
    g.gain.setValueAtTime(Math.max(0, (o.gain ?? 1) * (eng.trims[bufName] ?? 1)), now);
    if (p) p.pan.setValueAtTime(o.pan != null && Number.isFinite(Number(o.pan)) ? Math.max(-1, Math.min(1, Number(o.pan))) * 0.85 : 0, now);
    src.connect(g);
    const det = cls.busName === 'world' ? eng.sfxDetune : null;
    if (det) det.connect(src.detune);

    const voice = { src, g, p, strip, det, cls, prio: cls.prio, start: when, end: when + buffer.duration / rate, alive: true, ended: false };
    src.onended = () => this.release(voice);
    src.start(when);
    if (o.stop) {
      const tEnd = when + o.stop;
      g.gain.setValueAtTime(Math.max(0, (o.gain ?? 1) * (eng.trims[bufName] ?? 1)), tEnd);
      g.gain.linearRampToValueAtTime(0, tEnd + 0.06);
      src.stop(tEnd + 0.07);
      voice.end = Math.min(voice.end, tEnd + 0.07);
    }
    this.nodesLive += p ? 3 : 2;
    this.stats.created++;
    cls.voices.push(voice);
    this.list.push(voice);
    this.stats.played++;
    if (this.list.length > this.stats.peakVoices) this.stats.peakVoices = this.list.length;
    return voice;
  }

  /** Fade a voice out quickly and remove it from the active lists (nodes freed on 'ended'). */
  kill(v, now = this.eng.ctx.currentTime, fade = 0.008) {
    if (!v || !v.alive) return;
    v.alive = false;
    this.unlist(v);
    this.dying.add(v);
    this.stats.stolen++;
    try {
      const t = Math.max(now, v.start);
      v.end = Math.min(v.end, t + fade * 6);
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(v.g.gain.value, t);
      v.g.gain.setTargetAtTime(0, t, fade);
      v.src.stop(t + fade * 6);
    } catch (e) { this.release(v); }
  }

  unlist(v) {
    let i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    const arr = v.cls.voices;
    i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1);
  }

  release(v) {
    if (v.ended) return;
    v.ended = true;
    v.alive = false;
    this.unlist(v);
    try { if (v.det) v.det.disconnect(v.src.detune); } catch (e) { /* already gone */ }
    try { v.src.disconnect(); } catch (e) { /* noop */ }
    v.src.onended = null;
    this.giveStrip(v.strip);
    this.nodesLive -= v.p ? 3 : 2;
    this.dying.delete(v);
  }

  /** Safety net: anything long past its end that never fired 'ended' gets released. */
  sweep(now) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      if (now > v.end + (v.end - v.start) * 1.5 + 1) { this.stats.swept++; try { v.src.stop(); } catch (e) { /* noop */ } this.release(v); }
    }
    for (const v of this.dying) if (now > v.end + 2) { this.stats.swept++; this.release(v); }
  }

  stopAll() {
    for (const v of [...this.list, ...this.dying]) { try { v.src.stop(); } catch (e) { /* noop */ } this.release(v); }
    for (const s of this.pool) { try { s.g.disconnect(); } catch (e) { /* noop */ } try { if (s.p) s.p.disconnect(); } catch (e) { /* noop */ } }
    this.pool = [];
  }

  count() { return this.list.length; }
}
