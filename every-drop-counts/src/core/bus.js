/**
 * Event bus (contract: docs/ARCHITECTURE.md "Event bus contract").
 *
 *   const bus = createBus();
 *   const off = bus.on('donor:death', (payload) => {...});
 *   bus.emit('donor:death', { id, type, cause, pan });
 *
 * Listener exceptions are caught and reported (never break the emitter / game loop).
 * `bus.on('*', fn)` receives every event as fn(type, payload) — handy for debugging/logging.
 * Pure JS: safe to import from src/sim (no DOM).
 */
export function createBus({ onError } = {}) {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  const report = onError || ((err, type) => {
    // eslint-disable-next-line no-console
    console.error(`[bus] listener for "${type}" threw:`, err);
  });

  function on(type, fn) {
    let set = listeners.get(type);
    if (!set) { set = new Set(); listeners.set(type, set); }
    set.add(fn);
    return () => set.delete(fn);
  }

  function once(type, fn) {
    const off = on(type, (p) => { off(); fn(p); });
    return off;
  }

  function emit(type, payload = {}) {
    const set = listeners.get(type);
    if (set && set.size) {
      for (const fn of [...set]) {
        try { fn(payload); } catch (err) { report(err, type); }
      }
    }
    const any = listeners.get('*');
    if (any && any.size) {
      for (const fn of [...any]) {
        try { fn(type, payload); } catch (err) { report(err, '*'); }
      }
    }
  }

  function clear() { listeners.clear(); }

  return { on, once, emit, clear };
}
