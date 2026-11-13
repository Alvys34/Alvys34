/**
 * Attract mode: while menus are up, the real sim runs a calm scene behind them (a few sedated
 * donors gently rocked in a clean drum, no hazards, nobody can get hurt).
 *
 * The sim is created with a GATED bus (createSimBus) so attract-mode events (shift:start, impacts,
 * speech…) never reach audio, VFX or the achievement tracker. UI-side taps still see everything.
 *
 *   // main.js
 *   const simBus = createSimBus(bus);
 *   const sim = createSim({ RAPIER, bus: simBus, seed });
 *   simBus.setOpen(false)   // attract: events stay inside the sim
 *   simBus.tap('donor:speak', fn)   // always called, open or not
 */
export function createSimBus(bus) {
  let open = true;
  const taps = new Map();
  return {
    on: (type, fn) => bus.on(type, fn),
    once: (type, fn) => (bus.once ? bus.once(type, fn) : bus.on(type, fn)),
    emit(type, payload) {
      const set = taps.get(type);
      if (set) for (const fn of [...set]) { try { fn(payload, open); } catch (e) { console.error('[edc] sim tap failed', e); } }
      if (open) bus.emit(type, payload);
    },
    clear: () => bus.clear && bus.clear(),
    tap(type, fn) {
      let set = taps.get(type);
      if (!set) { set = new Set(); taps.set(type, set); }
      set.add(fn);
      return () => set.delete(fn);
    },
    setOpen(v) { open = !!v; },
    get open() { return open; },
    get inner() { return bus; },
  };
}

/** Inline level object: no hazards, immortal donors, slow chatter. */
export const ATTRACT_LEVEL = {
  id: 'attract',
  number: 0,
  name: 'Attract',
  duration: 1e9,
  capacity: 400,
  quota: [1e9, 1e9, 1e9],
  startAngle: 0.2,
  hatch: { wall: 'back', x: 0, y: 1.5, offset: 1.2 },
  hazards: [],
  waves: [{ at: 0.6, count: 7 }],
  advanceWhenClear: false,
  pa: [],
  tunables: {
    damage: { impactMinDv: 1e6, crushForce: 1e12, crushDps: 0 },
    donor: { drownSeconds: 1e9, speakInterval: [7, 18] },
    levels: { timerWarnings: [] },
  },
};

/**
 * Drives the drum while menus are up: a slow cradle rock (PD controller toward a sine target).
 * attract.update(sim, realDt) -> sets sim input.
 */
export function createAttract() {
  let t = 0;
  return {
    reset() { t = 0; },
    update(sim, dt) {
      t += dt;
      const st = sim.state;
      if (!st || !st.drum) return;
      const target = 0.2 + Math.sin(t * 0.32) * 0.75 + Math.sin(t * 0.11) * 0.3;
      const err = target - st.drum.theta;
      // rotate +1 = clockwise = negative omega (sim/drum.js), so the PD output is negated
      const rot = Math.max(-0.45, Math.min(0.45, -(err * 0.9 - st.drum.omega * 0.8)));
      sim.setInput({ rotate: rot, brake: false });
    },
  };
}
