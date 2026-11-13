/**
 * Save data — the ONLY module that touches localStorage (key `edc.save.v1`, one JSON object).
 *
 *   import { loadSave, getSave, updateSave, recordShiftResult, resetSave } from './save.js';
 *   const save = getSave();                       // cached object (load on first call)
 *   updateSave((s) => { s.settings.music = 0.5; }); // mutate + persist
 *   recordShiftResult(levelId, { liters, stars }) // best litres/stars + unlock next shift
 *
 * Works without localStorage (private mode, Node): falls back to in-memory.
 */
export const SAVE_KEY = 'edc.save.v1';

export function defaultSave() {
  return {
    version: 1,
    progress: { unlocked: 1 },            // highest shift number unlocked
    best: {},                             // levelId -> { liters, stars }
    settings: {
      master: 0.8, music: 0.6, sfx: 0.8,
      fullscreen: false,
      quality: 'high',                    // 'low' | 'medium' | 'high'
      screenShake: true,
      bloodColor: 'red',                  // 'red' | 'green' (streamer-safe)
    },
    overtime: [],                         // top-10 [{ liters, date }]
    achievements: {},                     // id -> timestamp
    stats: { donorsProcessed: 0, litersTotal: 0, shiftsPlayed: 0 },
  };
}

let cache = null;

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* access can throw in sandboxed contexts */ }
  return null;
}

function merge(base, loaded) {
  if (!loaded || typeof loaded !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in loaded)) continue;
    const b = base[k]; const l = loaded[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && l && typeof l === 'object' && !Array.isArray(l)) {
      base[k] = merge(b, l);
      for (const extra of Object.keys(l)) if (!(extra in base[k])) base[k][extra] = l[extra];
    } else if (typeof l === typeof b || b == null) {
      base[k] = l;
    }
  }
  return base;
}

export function loadSave() {
  const st = storage();
  let data = null;
  if (st) {
    try { data = JSON.parse(st.getItem(SAVE_KEY) || 'null'); } catch { data = null; }
  }
  cache = merge(defaultSave(), data);
  return cache;
}

export function getSave() { return cache || loadSave(); }

export function writeSave() {
  const st = storage();
  if (!st || !cache) return false;
  try { st.setItem(SAVE_KEY, JSON.stringify(cache)); return true; } catch { return false; }
}

export function updateSave(mutator) {
  const s = getSave();
  mutator(s);
  writeSave();
  return s;
}

export function recordShiftResult(levelId, { liters, stars, levelNumber }) {
  return updateSave((s) => {
    const prev = s.best[levelId] || { liters: 0, stars: 0 };
    s.best[levelId] = { liters: Math.max(prev.liters, liters), stars: Math.max(prev.stars, stars) };
    if (stars >= 1 && Number.isFinite(levelNumber)) s.progress.unlocked = Math.max(s.progress.unlocked, levelNumber + 1);
    s.stats.shiftsPlayed++;
    s.stats.litersTotal += Math.max(0, liters);
  });
}

export function recordOvertime(liters) {
  return updateSave((s) => {
    s.overtime.push({ liters, date: new Date().toISOString() });
    s.overtime.sort((a, b) => b.liters - a.liters);
    s.overtime.length = Math.min(s.overtime.length, 10);
  });
}

export function resetSave() {
  cache = defaultSave();
  writeSave();
  return cache;
}
