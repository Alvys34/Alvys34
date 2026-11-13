// EVERY DROP COUNTS — audio module (public facade). Implements the LOCKED audio contract:
//
//   const audio = createAudio();
//   audio.attach(bus); audio.unlock(); audio.update(dt, state);
//   audio.setVolume('master'|'music'|'sfx', v); audio.suspend(); audio.resume(); audio.dispose();
//
// Everything is synthesised at runtime with WebAudio (no samples, no dependencies). Every public
// method is wrapped: nothing ever throws into the caller, and everything is a silent no-op when
// WebAudio is unavailable or the context has not been unlocked by a user gesture yet.
//
// Optional (non-contract) options, used by tools/audio for measurement:
//   createAudio({ context: OfflineAudioContext|AudioContext, seed: number })
// and `audio.debug` exposes stats + the final output node for metering.
import { Engine } from './engine.js';
import { EVENT_NAMES } from './events.js';

export { EVENT_NAMES };

export function createAudio(opts = {}) {
  let eng = null;
  try { eng = new Engine(opts || {}); } catch (e) { eng = null; }
  let unsubs = [];

  const guard = (where, fn) => {
    try { return fn(); } catch (e) { if (eng) eng.fail(where, e); return undefined; }
  };

  const audio = {
    attach(bus) {
      guard('attach', () => {
        if (!eng || !bus || typeof bus.on !== 'function') return;
        for (const u of unsubs) { try { if (typeof u === 'function') u(); } catch (e) { /* noop */ } }
        unsubs = [];
        for (const type of EVENT_NAMES) {
          const off = bus.on(type, (payload) => { try { eng.onEvent(type, payload); } catch (e) { eng.fail(type, e); } });
          unsubs.push(off);
        }
      });
    },

    unlock() {
      guard('unlock', () => {
        if (!eng) return;
        if (!eng.init()) return;
        const ctx = eng.ctx;
        if (!eng.offline && ctx.state !== 'running' && ctx.resume) {
          const p = ctx.resume();
          if (p && p.catch) p.catch(() => {});
        }
      });
    },

    update(dt, state) { guard('update', () => { if (eng) eng.update(dt, state); }); },

    setVolume(kind, v) { guard('setVolume', () => { if (eng) eng.setVolume(kind, v); }); },

    suspend() {
      guard('suspend', () => {
        if (!eng || !eng.ready || eng.offline) return;
        const p = eng.ctx.suspend && eng.ctx.suspend();
        if (p && p.catch) p.catch(() => {});
      });
    },

    resume() {
      guard('resume', () => {
        if (!eng || !eng.ready || eng.offline) return;
        const p = eng.ctx.resume && eng.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      });
    },

    dispose() {
      guard('dispose', () => {
        for (const u of unsubs) { try { if (typeof u === 'function') u(); } catch (e) { /* noop */ } }
        unsubs = [];
        if (eng) eng.dispose();
      });
    },

    /** Non-contract diagnostics for tools/tests. */
    get debug() {
      if (!eng) return null;
      return {
        engine: eng,
        get ctx() { return eng.ctx; },
        get output() { return eng.output; },
        stats: () => eng.stats(),
        emit: (type, payload) => eng.onEvent(type, payload),
      };
    },
  };
  return audio;
}

export default createAudio;
