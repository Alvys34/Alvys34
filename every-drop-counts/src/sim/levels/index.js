/**
 * Level registry. A level is plain data (see shift1.js for the annotated format).
 * Adding a shift = add a file + one registerLevel() line below. Lookup by id ('shift-3') or number (3).
 */
import shift1 from './shift1.js';
import shift2 from './shift2.js';

export const LEVELS = [];

export function registerLevel(def) {
  validateLevel(def);
  const i = LEVELS.findIndex((l) => l.id === def.id);
  if (i >= 0) LEVELS[i] = def; else LEVELS.push(def);
  LEVELS.sort((a, b) => a.number - b.number);
  return def;
}

export function getLevel(idOrNumber) {
  if (idOrNumber && typeof idOrNumber === 'object') return idOrNumber; // inline level def
  const n = Number(idOrNumber);
  const lvl = Number.isFinite(n) ? LEVELS.find((l) => l.number === n) : LEVELS.find((l) => l.id === idOrNumber);
  if (!lvl) throw new Error(`Unknown level "${idOrNumber}"`);
  return lvl;
}

export function listLevels() { return LEVELS.map((l) => ({ id: l.id, number: l.number, name: l.name, quota: l.quota })); }

export function nextLevel(idOrNumber) {
  const cur = getLevel(idOrNumber);
  return LEVELS.find((l) => l.number === cur.number + 1) || null;
}

function validateLevel(l) {
  const need = ['id', 'number', 'name', 'duration', 'capacity', 'quota', 'hatch', 'hazards', 'waves'];
  for (const k of need) if (l[k] == null) throw new Error(`Level ${l.id || '?'} missing "${k}"`);
  if (!Array.isArray(l.quota) || l.quota.length !== 3) throw new Error(`Level ${l.id}: quota must be [q1,q2,q3]`);
}

registerLevel(shift1);
registerLevel(shift2);
