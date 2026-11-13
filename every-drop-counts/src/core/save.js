/**
 * Save data — the ONLY module that touches localStorage (key `edc.save.v1`, one JSON object).
 *
 *   import { getSave, updateSave, recordShiftResult, recordOvertime, resetSave } from './save.js';
 *   const save = getSave();                          // cached, sanitised object (loads on first call)
 *   updateSave((s) => { s.settings.music = 0.5; });  // mutate + persist
 *   recordShiftResult(levelId, { liters, stars, levelNumber })   // -> { prev, isBest, ... }
 *   recordOvertime(liters, { time, initials })       // -> { rank (0-based or -1), entry }
 *   unlockAchievement(id) -> true if newly unlocked; addStats({ donorsProcessed: 3, ... })
 *
 * Robustness: bad JSON / wrong types / missing fields never throw — every field is sanitised
 * against the defaults; an unreadable save is kept under `edc.save.v1.corrupt` and replaced with a
 * fresh one. Works without localStorage (private mode, Node): falls back to memory.
 *
 * Schema versioning: `version` is the schema number inside the v1 key. To change the shape later,
 * bump SCHEMA_VERSION and add MIGRATIONS[oldVersion] = (raw) => raw' (raw JSON, before sanitising).
 */
export const SAVE_KEY = 'edc.save.v1';
export const SCHEMA_VERSION = 1;
export const OVERTIME_TABLE_SIZE = 10;

/** raw -> raw upgraders, keyed by the version they upgrade FROM. */
export const MIGRATIONS = {
  // 1: (raw) => { raw.newField = ...; raw.version = 2; return raw; },
};

export const SETTING_CHOICES = {
  quality: ['auto', 'low', 'medium', 'high'],
  screenShake: ['off', 'reduced', 'full'],
  bloodColor: ['red', 'green'],
};

export function defaultSettings() {
  return {
    master: 0.8, music: 0.6, sfx: 0.8,
    fullscreen: false,
    quality: 'auto',                      // 'auto' | 'low' | 'medium' | 'high'
    screenShake: 'full',                  // 'off' | 'reduced' | 'full'
    bloodColor: 'red',                    // 'red' | 'green' (streamer-safe)
    reduceFlashing: false,
    speechBubbles: true,
  };
}

export function defaultSave() {
  return {
    version: SCHEMA_VERSION,
    progress: { unlocked: 1, endingSeen: false },  // highest shift number unlocked
    best: {},                             // levelId -> { liters, stars }
    settings: defaultSettings(),
    overtime: [],                         // top-10 [{ liters, time, initials, date }]
    initials: 'OPR',                      // last initials used for the Overtime table
    achievements: {},                     // id -> unlock timestamp (ms)
    stats: {
      donorsProcessed: 0, litersTotal: 0, shiftsPlayed: 0, shiftsCompleted: 0,
      drownings: 0, limbsSevered: 0, slams: 0, overtimeRuns: 0, secondsOnShift: 0,
    },
  };
}

let cache = null;
let memoryStore = null;

function storage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch { /* access can throw in sandboxed contexts */ }
  if (!memoryStore) {
    const m = new Map();
    memoryStore = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  }
  return memoryStore;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);

function sanitizeSettings(raw) {
  const d = defaultSettings();
  const s = isObj(raw) ? raw : {};
  // legacy (phase-1 baseline): screenShake was a boolean, quality had no 'auto'
  let shake = s.screenShake;
  if (shake === true) shake = 'full';
  if (shake === false) shake = 'off';
  return {
    master: num(s.master, d.master, 0, 1),
    music: num(s.music, d.music, 0, 1),
    sfx: num(s.sfx, d.sfx, 0, 1),
    fullscreen: bool(s.fullscreen, d.fullscreen),
    quality: pick(s.quality, SETTING_CHOICES.quality, d.quality),
    screenShake: pick(shake, SETTING_CHOICES.screenShake, d.screenShake),
    bloodColor: pick(s.bloodColor, SETTING_CHOICES.bloodColor, d.bloodColor),
    reduceFlashing: bool(s.reduceFlashing, d.reduceFlashing),
    speechBubbles: bool(s.speechBubbles, d.speechBubbles),
  };
}

/** Turn any parsed JSON value into a valid save (never throws). */
export function sanitizeSave(raw) {
  const d = defaultSave();
  if (!isObj(raw)) return d;
  const out = d;
  const p = isObj(raw.progress) ? raw.progress : {};
  out.progress.unlocked = Math.round(num(p.unlocked, 1, 1, 99));
  out.progress.endingSeen = bool(p.endingSeen, false);
  if (isObj(raw.best)) {
    for (const [id, b] of Object.entries(raw.best)) {
      if (!isObj(b) || typeof id !== 'string' || id.length > 64) continue;
      out.best[id] = { liters: num(b.liters, 0, 0, 1e7), stars: Math.round(num(b.stars, 0, 0, 3)) };
    }
  }
  out.settings = sanitizeSettings(raw.settings);
  if (Array.isArray(raw.overtime)) {
    out.overtime = raw.overtime
      .filter((e) => isObj(e) && typeof e.liters === 'number' && Number.isFinite(e.liters))
      .map((e) => ({
        liters: num(e.liters, 0, 0, 1e7), time: num(e.time, 0, 0, 1e7),
        initials: cleanInitials(e.initials), date: typeof e.date === 'string' ? e.date.slice(0, 40) : '',
      }))
      .sort((a, b) => b.liters - a.liters)
      .slice(0, OVERTIME_TABLE_SIZE);
  }
  out.initials = cleanInitials(raw.initials);
  if (isObj(raw.achievements)) {
    for (const [id, ts] of Object.entries(raw.achievements)) {
      if (typeof id === 'string' && id.length <= 64) out.achievements[id] = num(ts, Date.now(), 0);
    }
  }
  const st = isObj(raw.stats) ? raw.stats : {};
  for (const k of Object.keys(out.stats)) out.stats[k] = num(st[k], 0, 0);
  return out;
}

export function cleanInitials(v) {
  const s = String(typeof v === 'string' ? v : 'OPR').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  return (s + 'AAA').slice(0, 3);
}

function migrate(raw) {
  if (!isObj(raw)) return raw;
  let v = Number.isFinite(raw.version) ? raw.version : 1;
  let guard = 0;
  while (v < SCHEMA_VERSION && MIGRATIONS[v] && guard++ < 50) {
    try { raw = MIGRATIONS[v](raw) || raw; } catch { break; }
    v = Number.isFinite(raw.version) && raw.version > v ? raw.version : v + 1;
  }
  return raw;
}

/** Last load diagnostics (debug/UI): { status: 'fresh'|'loaded'|'corrupt' } */
export const saveInfo = { status: 'fresh' };

export function loadSave() {
  const st = storage();
  let text = null;
  try { text = st.getItem(SAVE_KEY); } catch { text = null; }
  let raw = null;
  saveInfo.status = 'fresh';
  if (text != null) {
    try {
      raw = JSON.parse(text);
      saveInfo.status = isObj(raw) ? 'loaded' : 'corrupt';
    } catch {
      raw = null;
      saveInfo.status = 'corrupt';
    }
    if (saveInfo.status === 'corrupt') {
      try { st.setItem(`${SAVE_KEY}.corrupt`, String(text).slice(0, 200000)); } catch { /* ignore */ }
    }
  }
  cache = sanitizeSave(migrate(raw));
  // persist the sanitised/migrated form so bad values never survive a second load
  if (saveInfo.status !== 'loaded' || JSON.stringify(cache) !== text) writeSave();
  return cache;
}

export function getSave() { return cache || loadSave(); }

export function writeSave() {
  if (!cache) return false;
  try { storage().setItem(SAVE_KEY, JSON.stringify(cache)); return true; } catch { return false; }
}

export function updateSave(mutator) {
  const s = getSave();
  try { mutator(s); } catch (e) { console.warn('[edc] save mutator failed', e); }
  writeSave();
  return s;
}

/**
 * Record a finished shift. Returns { prev: {liters, stars} | null, isBest, unlockedNext }.
 * Unlocks the next shift when at least one drop was earned.
 */
export function recordShiftResult(levelId, { liters, stars, levelNumber }) {
  let info = { prev: null, isBest: false, unlockedNext: false };
  updateSave((s) => {
    const prev = s.best[levelId] || null;
    const L = Math.max(0, Number(liters) || 0);
    const S = Math.max(0, Math.min(3, Math.round(Number(stars) || 0)));
    info.prev = prev ? { ...prev } : null;
    info.isBest = S >= 1 && (!prev || L > prev.liters);
    s.best[levelId] = { liters: Math.max(prev ? prev.liters : 0, L), stars: Math.max(prev ? prev.stars : 0, S) };
    if (S >= 1 && Number.isFinite(levelNumber)) {
      const before = s.progress.unlocked;
      s.progress.unlocked = Math.max(s.progress.unlocked, levelNumber + 1);
      info.unlockedNext = s.progress.unlocked > before;
    }
    s.stats.shiftsPlayed++;
    if (S >= 1) s.stats.shiftsCompleted++;
    s.stats.litersTotal += L;
  });
  return info;
}

/** Record an Overtime run. Returns { rank: 0-based position in the top-10 or -1, entry }. */
export function recordOvertime(liters, { time = 0, initials } = {}) {
  let rank = -1; let entry = null;
  updateSave((s) => {
    entry = { liters: Math.max(0, Number(liters) || 0), time: Math.max(0, Number(time) || 0), initials: cleanInitials(initials || s.initials), date: new Date().toISOString() };
    s.overtime.push(entry);
    s.overtime.sort((a, b) => b.liters - a.liters);
    s.overtime.length = Math.min(s.overtime.length, OVERTIME_TABLE_SIZE);
    rank = s.overtime.indexOf(entry);
    s.stats.overtimeRuns++;
    s.stats.litersTotal += entry.liters;
  });
  return { rank, entry };
}

/** Would `liters` make the Overtime top-10? */
export function overtimeQualifies(liters) {
  const t = getSave().overtime;
  return liters > 0 && (t.length < OVERTIME_TABLE_SIZE || liters > t[t.length - 1].liters);
}

/** Rename an Overtime entry (initials entry after the run). */
export function setOvertimeInitials(entry, initials) {
  updateSave((s) => {
    const clean = cleanInitials(initials);
    s.initials = clean;
    const e = s.overtime.find((x) => x === entry || (x.date === entry.date && x.liters === entry.liters));
    if (e) e.initials = clean;
  });
}

export function unlockAchievement(id) {
  if (typeof id !== 'string' || !id) return false;
  const s = getSave();
  if (s.achievements[id]) return false;
  updateSave((x) => { x.achievements[id] = Date.now(); });
  return true;
}

export function addStats(delta) {
  updateSave((s) => {
    for (const [k, v] of Object.entries(delta || {})) {
      if (typeof v === 'number' && Number.isFinite(v)) s.stats[k] = (s.stats[k] || 0) + v;
    }
  });
}

/** Wipe progress, bests, Overtime table, achievements and stats; keeps settings by default. */
export function resetSave({ keepSettings = true } = {}) {
  const settings = keepSettings && cache ? cache.settings : defaultSettings();
  cache = defaultSave();
  cache.settings = settings;
  writeSave();
  return cache;
}
