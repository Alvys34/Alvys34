// Continuous machine/ambience layers. Built once at unlock, always running, driven every frame
// from `state` with AudioParam smoothing (no per-frame node creation).
import { LOOP_LEVELS as L } from './mix.js';
import { clamp, smoothstep } from './dsp.js';

export class Loops {
  constructor(eng) {
    this.eng = eng;
    const ctx = (this.ctx = eng.ctx);
    const G = (v = 0, dst) => { const g = ctx.createGain(); g.gain.value = v; if (dst) g.connect(dst); return g; };
    const F = (type, f, q, dst) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (dst) b.connect(dst); return b; };
    const O = (type, f, dst) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; if (dst) o.connect(dst); return o; };
    const S = (name, dst, rate = 1) => {
      const s = ctx.createBufferSource(); s.buffer = eng.bank.get(name, 0); s.loop = true; s.playbackRate.value = rate; if (dst) s.connect(dst); return s;
    };
    this.sources = [];
    const keep = (...n) => { this.sources.push(...n); return n[0]; };

    this.out = G(1, eng.worldIn);
    const send = G(0.08, eng.reverbIn);
    this.out.connect(send);

    // --- drum motor: buzzy low fundamental + gear whine + mechanical rumble ---
    this.motorGain = G(0, this.out);
    this.motorLP = F('lowpass', 260, 3, this.motorGain);
    this.mA = keep(O('sawtooth', 40, this.motorLP));
    const mBg = G(0.35, this.motorLP);
    this.mB = keep(O('square', 80.4, mBg));
    this.mWhineG = G(0.04, this.motorGain);
    this.mWhine = keep(O('sine', 380, this.mWhineG));
    const rumbleLP = F('lowpass', 140, 0.9, G(0.7, this.motorGain));
    this.mRumble = keep(S('lpNoise', rumbleLP));

    // --- saw: bright whine whose pitch sags under load + grinding noise when cutting ---
    this.sawGain = G(0, this.out);
    const sBP = F('bandpass', 2800, 2.5, this.sawGain);
    this.sOsc = keep(O('sawtooth', 230, sBP));
    const sSineG = G(0.12, this.sawGain);
    this.sSine = keep(O('sine', 230 * 13, sSineG));
    this.sNoiseG = G(0, this.sawGain);
    const sNBP = F('bandpass', 3200, 1.2, this.sNoiseG);
    this.sNoise = keep(S('lpNoise', sNBP, 0.93));

    // --- grinder: roller hum + looped crunch chug ---
    this.grinderGain = G(0, this.out);
    this.gHumG = G(0.5, this.grinderGain);
    const gLP = F('lowpass', 220, 2, this.gHumG);
    this.gHum = keep(O('sawtooth', 55, gLP));
    this.gCrunchG = G(0.3, this.grinderGain);
    this.gCrunch = keep(S('lpGrind', this.gCrunchG));

    // --- blood slosh: low filtered noise with a slow wave LFO on the cutoff ---
    this.sloshGain = G(0, this.out);
    this.sloshLP = F('lowpass', 420, 1.6, this.sloshGain);
    this.slosh = keep(S('lpNoise', this.sloshLP, 0.71));
    const lfoG = G(160, this.sloshLP.frequency);
    this.sloshLfo = keep(O('sine', 0.31, lfoG));
    const ampLfoG = G(0, this.sloshGain.gain);
    this.sloshAmpLfoG = ampLfoG;
    this.sloshAmpLfo = keep(O('sine', 0.47, ampLfoG));

    // --- droplet patter bed (absorbs splat floods the voice limiter drops) ---
    this.patterGain = G(0, this.out);
    const pHP = F('highpass', 500, 0.7, this.patterGain);
    this.patter = keep(S('lpPatter', pHP));

    // --- fluorescent hum (clinical room tone) ---
    this.humGain = G(0, this.out);
    this.hum1 = keep(O('sine', 100, this.humGain));
    const h2 = G(0.4, this.humGain);
    this.hum2 = keep(O('sine', 200, h2));
    const h3 = G(0.15, this.humGain);
    this.hum3 = keep(O('triangle', 300, h3));

    // --- distant facility alarm at very high fill (mostly reverb) ---
    this.alarmGain = G(0, G(0.35, this.out));
    const aSend = G(0.9, eng.reverbIn);
    this.alarmGain.connect(aSend);
    this.alarm = keep(S('lpAlarm', this.alarmGain));

    // state
    this.prevW = 0;
    this.stillTime = 1;
    this.sawSeen = false;
    this.grinderSeen = false;
    this.clogged = false;
    this.sawBoost = 0;
    this.lastMotor = 0;
  }

  start() {
    const t = this.ctx.currentTime;
    for (const s of this.sources) {
      try { s.start(t, s.buffer ? Math.random() * s.buffer.duration * 0.9 : undefined); } catch (e) { /* noop */ }
    }
  }

  reset() {
    this.sawSeen = false;
    this.grinderSeen = false;
    this.clogged = false;
    this.sawBoost = 0;
  }

  update(dt, st, pf, playing, patterPressure) {
    const now = this.ctx.currentTime;
    const set = (param, v, tc = 0.05) => { if (Number.isFinite(v)) param.setTargetAtTime(v, now, tc); };
    const on = playing ? 1 : 0;

    // motor follows |omega| with an immediate attack
    const w = Math.min(10, Math.abs(Number(st.drumOmega) || 0));
    const wn = clamp(w / 2.2, 0, 1.3);
    const mT = on * (w > 0.01 ? 0.3 + 0.7 * Math.min(1, wn) : 0) * L.motor;
    const f = (30 + 48 * wn) * pf;
    if (mT > 0 && this.lastMotor < 0.002 && Number.isFinite(f)) {
      // first movement from rest: jump straight to an audible level and pitch on this frame
      for (const [prm, v] of [[this.motorGain.gain, mT * 0.7], [this.mA.frequency, f], [this.mB.frequency, f * 2.01], [this.motorLP.frequency, (160 + 520 * wn) * pf]]) {
        prm.cancelScheduledValues(now);
        prm.setValueAtTime(v, now);
      }
    }
    set(this.motorGain.gain, mT, mT > this.lastMotor ? 0.01 : 0.12);
    this.lastMotor = mT;
    set(this.mA.frequency, f, 0.02);
    set(this.mB.frequency, f * 2.01, 0.02);
    set(this.mWhine.frequency, f * 9.5, 0.02);
    set(this.mWhineG.gain, 0.02 + 0.06 * wn, 0.05);
    set(this.motorLP.frequency, (160 + 520 * wn) * pf, 0.03);
    set(this.mRumble.playbackRate, (0.5 + 0.6 * wn) * pf);
    if (playing && w > 0.08 && this.prevW <= 0.08 && this.stillTime > 0.25) {
      this.eng.play('machine', 'motorStart', { gain: 0.45, force: true });
    }
    this.stillTime = w < 0.03 ? this.stillTime + dt : 0;
    this.prevW = w;

    // saw
    const sawLoad = clamp(Number(st.sawLoad) || 0, 0, 1);
    if (sawLoad > 0.001 || st.hasSaw || st.sawCount > 0) this.sawSeen = true;
    this.sawBoost = Math.max(0, this.sawBoost - dt * 2.5);
    const sl = Math.min(1, sawLoad + this.sawBoost);
    set(this.sawGain.gain, on * (this.sawSeen ? 1 : 0) * L.saw * (0.75 + 0.35 * sl), 0.06);
    const sf = 230 * (1 - 0.33 * sl) * pf;
    set(this.sOsc.frequency, sf, 0.04);
    set(this.sSine.frequency, sf * 13, 0.04);
    set(this.sNoiseG.gain, sl * 1.0, 0.04);

    // grinder
    const gl = clamp(Number(st.grinderLoad) || 0, 0, 1);
    if (gl > 0.001 || st.hasGrinder || st.grinderCount > 0) this.grinderSeen = true;
    set(this.grinderGain.gain, on * (this.grinderSeen ? 1 : 0) * L.grinder, 0.08);
    if (this.clogged) {
      set(this.gHum.frequency, 24 * pf, 0.25);
      set(this.gHumG.gain, 0.7, 0.1);
      set(this.gCrunchG.gain, 0, 0.05);
    } else {
      set(this.gHum.frequency, 55 * (1 - 0.25 * gl) * pf, 0.1);
      set(this.gHumG.gain, 0.45, 0.1);
      set(this.gCrunchG.gain, 0.15 + 0.85 * gl, 0.08);
      set(this.gCrunch.playbackRate, (1.15 - 0.45 * gl) * pf, 0.1);
    }

    // slosh grows with fill and drum motion
    const fill = clamp(Number(st.fill) || 0, 0, 1);
    const sT = on * L.slosh * Math.pow(fill, 0.8) * (0.25 + 0.75 * Math.min(1, w / 1.2));
    set(this.sloshGain.gain, sT, 0.15);
    set(this.sloshAmpLfoG.gain, sT * 0.35, 0.15);
    set(this.sloshLP.frequency, (300 + 380 * Math.min(1, w / 2)) * pf, 0.1);

    // patter: rain of droplets beyond what one-shots can carry
    const pT = on * L.patter * Math.pow(clamp((patterPressure || 0) / 10, 0, 1), 0.7);
    set(this.patterGain.gain, pT, 0.08);
    set(this.patter.playbackRate, pf);

    // room hum: present during play, partially masked as the room fills
    set(this.humGain.gain, on * L.hum * (1 - 0.5 * fill), 0.3);

    // alarm: only when the room is nearly full
    set(this.alarmGain.gain, on * L.alarm * smoothstep(0.78, 0.98, fill), 0.5);
  }

  stop() {
    for (const s of this.sources) { try { s.stop(); } catch (e) { /* noop */ } try { s.disconnect(); } catch (e) { /* noop */ } }
    try { this.out.disconnect(); } catch (e) { /* noop */ }
  }
}
