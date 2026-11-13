/**
 * Applies settings to the other systems and integrates achievements. Every hook is feature-detected:
 * a missing method in render/audio/achievements never throws, it just does less.
 *
 * Render hooks used when present (VFX/ART): view.setQuality(name) [contract], view.setScreenShake(scale),
 *   view.setBloodColor('red'|'green') | view.setBloodTint(hex), view.setReduceFlashing(bool);
 *   fallback: mutate view.ctx.settings.{screenShake, shakeScale, bloodColor, reduceFlashing}
 *   (camera.js reads settings.screenShake / settings.shakeScale every frame).
 * Achievements (CONTENT, src/core/achievements.js), any of: export ACHIEVEMENTS | achievements |
 *   DEFINITIONS (array or id-map of { id, name|title, description|desc, hidden? }) and a factory
 *   createAchievementTracker | createAchievements | createTracker ({ bus, unlocked, save, stats }).
 *   The tracker emits `achievement { id }` on the bus; the UI persists, toasts and forwards to Steam.
 */
import { getSave, updateSave, unlockAchievement } from '../core/save.js';

const SHAKE = { off: 0, reduced: 0.4, full: 1 };
const BLOOD = { red: 0xb3001b, green: 0x3f8f1c };

export function desktop() {
  try { return (typeof window !== 'undefined' && window.edcDesktop && window.edcDesktop.isDesktop) ? window.edcDesktop : null; } catch { return null; }
}

export function createSystems({ bus, view, audio, loop, root, debug = false, lockQuality = false }) {
  const call = (obj, name, ...args) => {
    try { if (obj && typeof obj[name] === 'function') return { ok: true, value: obj[name](...args) }; } catch (e) { console.warn(`[edc] ${name} failed`, e); }
    return { ok: false };
  };
  const vs = () => (view && view.ctx && view.ctx.settings) || {};

  // ---------------- quality (with an 'auto' fallback governor) ----------------
  let autoQuality = false;
  let autoLevel = 'high';
  let fpsAcc = 0; let fpsN = 0; let fpsT = 0; let lowStreak = 0;
  function applyQuality(q) {
    autoQuality = false;
    if (q === 'auto') {
      const r = call(view, 'setQuality', 'auto');
      if (r.ok && r.value !== false) return; // VFX handles auto itself
      autoQuality = true;
      autoLevel = 'high';
      call(view, 'setQuality', autoLevel);
      return;
    }
    call(view, 'setQuality', q);
  }
  /** Feed frame times while playing; steps auto quality down after sustained low fps. */
  function tickQuality(realDt, playing) {
    if (!autoQuality || !playing || debug || !(realDt > 0)) return;
    fpsAcc += 1 / realDt; fpsN++; fpsT += realDt;
    if (fpsT < 3) return;
    const fps = fpsAcc / fpsN;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
    lowStreak = fps < 48 ? lowStreak + 1 : 0;
    if (lowStreak >= 2) {
      const next = autoLevel === 'high' ? 'medium' : autoLevel === 'medium' ? 'low' : null;
      if (next) { autoLevel = next; call(view, 'setQuality', next); console.info(`[edc] auto quality -> ${next} (${fps.toFixed(0)} fps)`); }
      lowStreak = 0;
    }
  }

  // ---------------- fullscreen ----------------
  let fsPending = false;
  async function setFullscreen(on) {
    const d = desktop();
    try {
      if (d && typeof d.setFullscreen === 'function') {
        const r = await d.setFullscreen(!!on);
        return typeof r === 'boolean' ? r : !!on;
      }
      if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } else if (!on && document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (e) {
      // browsers refuse without a user gesture; the boot splash press retries
      fsPending = !!on;
    }
    return !!document.fullscreenElement;
  }
  async function isFullscreen() {
    const d = desktop();
    try { if (d && typeof d.isFullscreen === 'function') return !!(await d.isFullscreen()); } catch { /* ignore */ }
    return !!document.fullscreenElement;
  }

  // ---------------- apply ----------------
  function apply(key, s) {
    const st = s || getSave().settings;
    switch (key) {
      case 'master': case 'music': case 'sfx':
        if (audio) audio((a) => a.setVolume(key, st[key]));
        break;
      case 'quality': if (!lockQuality) applyQuality(st.quality); break;
      case 'screenShake': {
        const scale = SHAKE[st.screenShake] ?? 1;
        const vSet = vs();
        vSet.screenShake = scale > 0;
        vSet.shakeScale = scale;
        call(view, 'setScreenShake', scale);
        break;
      }
      case 'bloodColor': {
        vs().bloodColor = st.bloodColor;
        const r = call(view, 'setBloodColor', st.bloodColor);
        if (!r.ok) call(view, 'setBloodTint', BLOOD[st.bloodColor] ?? BLOOD.red);
        root.dataset.blood = st.bloodColor;
        break;
      }
      case 'reduceFlashing':
        vs().reduceFlashing = !!st.reduceFlashing;
        call(view, 'setReduceFlashing', !!st.reduceFlashing);
        root.dataset.reduceFlashing = st.reduceFlashing ? '1' : '0';
        break;
      case 'speechBubbles': break; // read by the UI directly
      case 'fullscreen': break;    // async: see setFullscreen
      default:
    }
  }
  function applyAll() {
    for (const k of ['master', 'music', 'sfx', 'quality', 'screenShake', 'bloodColor', 'reduceFlashing']) apply(k);
    const d = desktop();
    if (d && getSave().settings.fullscreen) setFullscreen(true);
  }
  /** Call from the first user gesture (boot splash): browser fullscreen needs one. */
  function onFirstGesture() {
    if (!desktop() && (getSave().settings.fullscreen || fsPending)) { fsPending = false; setFullscreen(true); }
  }
  function onFsChange() {
    const on = !!document.fullscreenElement;
    if (desktop()) return;
    if (getSave().settings.fullscreen !== on && !fsPending) updateSave((s) => { s.settings.fullscreen = on; });
  }
  document.addEventListener('fullscreenchange', onFsChange);

  // ---------------- achievements ----------------
  const achievementModules = import.meta.glob('../core/achievements.js');
  let defs = [];
  let tracker = null;
  const listeners = new Set();
  async function loadAchievements() {
    const loader = achievementModules['../core/achievements.js'];
    if (!loader) return;
    try {
      const mod = await loader();
      defs = normalizeDefs(mod.ACHIEVEMENTS || mod.achievements || mod.DEFINITIONS || mod.definitions || (mod.default && (mod.default.ACHIEVEMENTS || mod.default.achievements)) || []);
      const factory = mod.createAchievementTracker || mod.createAchievements || mod.createTracker || (typeof mod.default === 'function' ? mod.default : null);
      if (factory) {
        const save = getSave();
        try {
          tracker = factory({ bus, unlocked: Object.keys(save.achievements), save, stats: save.stats });
        } catch (e) { console.warn('[edc] achievement tracker failed to start', e); }
        if (tracker && typeof tracker.seed === 'function') { try { tracker.seed(Object.keys(save.achievements)); } catch { /* ignore */ } }
      }
    } catch (e) {
      console.warn('[edc] achievements unavailable', e);
    }
  }
  function normalizeDefs(raw) {
    const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.entries(raw).map(([id, d]) => ({ id, ...(d || {}) })) : []);
    return arr.filter((d) => d && d.id).map((d) => ({
      id: String(d.id),
      name: String(d.name || d.title || d.id),
      description: String(d.description || d.desc || d.text || ''),
      hidden: !!(d.hidden || d.secret),
    }));
  }
  const offAch = bus.on('achievement', (p) => {
    const id = p && p.id;
    if (!id) return;
    const fresh = unlockAchievement(String(id));
    const d = desktop();
    if (d && typeof d.unlockAchievement === 'function') { try { Promise.resolve(d.unlockAchievement(String(id))).catch(() => {}); } catch { /* ignore */ } }
    if (fresh) for (const fn of listeners) { try { fn(defFor(id)); } catch (e) { console.error(e); } }
  });
  function defFor(id) { return defs.find((d) => d.id === id) || { id, name: String(id).replace(/[-_]+/g, ' '), description: '', hidden: false }; }
  /** Re-send every saved unlock to Steam (covers unlocks made while Steam was unavailable). */
  function syncSteam() {
    const d = desktop();
    if (!d || typeof d.unlockAchievement !== 'function') return;
    for (const id of Object.keys(getSave().achievements)) { try { Promise.resolve(d.unlockAchievement(id)).catch(() => {}); } catch { /* ignore */ } }
  }

  return {
    apply, applyAll, onFirstGesture, setFullscreen, isFullscreen, tickQuality,
    get autoQualityLevel() { return autoQuality ? autoLevel : null; },
    loadAchievements, syncSteam,
    get achievements() { return defs; },
    get tracker() { return tracker; },
    defFor,
    onAchievement(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { offAch(); document.removeEventListener('fullscreenchange', onFsChange); },
  };
}
