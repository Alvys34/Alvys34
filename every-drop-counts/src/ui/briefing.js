/**
 * Briefing helpers (pure, Node-testable): what a shift introduces, derived from level data.
 *   levelNovelties(level, allLevels) -> ['saw', 'slam', ...]  (keys of copy.js NOVELTY, at most 4)
 */
import { BRIEFING_VERBS, NOVELTY } from './copy.js';

/** Novelty keys a level contains: verbs it teaches, hazard / donor / prop types, staff variant. */
export function levelFeatures(lv) {
  const out = [];
  const add = (k) => { if (k && !out.includes(k)) out.push(k); };
  for (const v of BRIEFING_VERBS[lv.number] || []) add(v);
  for (const hz of lv.hazards || []) add(hz.type);
  for (const w of lv.waves || []) {
    for (const t of Object.keys(w.types || {})) if (t !== 'standard') add(t);
    for (const p of w.props || []) add(p.type);
  }
  for (const p of lv.props || []) add(p.type);
  if (lv.variant === 'staff') add('staff');
  return out;
}

/** What is new this shift: keys with a NOVELTY entry that no earlier shift had (at most 4). */
export function levelNovelties(lv, all) {
  if (!lv || !Number.isFinite(lv.number) || lv.number < 1) return [];
  const seen = new Set();
  for (const o of all || []) if (o.number < lv.number) for (const k of levelFeatures(o)) seen.add(k);
  return levelFeatures(lv).filter((k) => NOVELTY[k] && !seen.has(k)).slice(0, 4);
}
