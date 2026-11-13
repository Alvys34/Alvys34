/**
 * UI tests that run headless (no DOM): brand single source, report headlines, briefing novelties,
 * save robustness (future versions, teaching counters, quality order).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRAND, BRAND_TAGLINE } from '../src/core/brand.js';
import * as copy from '../src/ui/copy.js';
import { levelNovelties } from '../src/ui/briefing.js';
import { listLevels, getLevel } from '../src/sim/levels/index.js';
import { sanitizeSave, SETTING_CHOICES, SAVE_KEY, loadSave, saveInfo, SCHEMA_VERSION } from '../src/core/save.js';

test('brand: one source of truth, no trademark sign, re-exported by copy.js', () => {
  assert.equal(copy.BRAND, BRAND);
  assert.ok(/^[A-Z]{3,12}$/.test(BRAND), `brand is a short all-caps word: ${BRAND}`);
  assert.ok(!/™/.test(BRAND + BRAND_TAGLINE));
  const tex = readFileSync(new URL('../src/render/environment/textures.js', import.meta.url), 'utf8');
  assert.ok(tex.includes("from '../../core/brand.js'"), 'signage atlas imports the brand');
  assert.ok(!tex.includes('™'), 'no trademark sign on signage');
});

test('report headline is keyed by drops (UI owns the words)', () => {
  const h = (stars, result = 'complete', title = 'Meets expectations.') => copy.resultHeadline({ stars, result, report: { title } });
  assert.equal(h(1), 'Quota met.');
  assert.equal(h(2), 'Meets expectations.');
  assert.equal(h(3), 'Operator of the Shift.');
  assert.match(h(0, 'timeout'), /^Quota not met/);
  assert.match(h(0, 'failed'), /^Quota not met/);
  assert.match(h(0, 'complete'), /^Quota not met/);
});

test('briefing: lesson on every shift, novelties only list what is new', () => {
  const levels = listLevels().map((l) => getLevel(l.id));
  assert.ok(levels.length >= 8);
  for (const lv of levels) assert.ok(typeof lv.lesson === 'string' && lv.lesson.length > 10, `shift ${lv.number} has a lesson`);
  const nov = Object.fromEntries(levels.map((lv) => [lv.number, levelNovelties(lv, levels)]));
  assert.deepEqual(nov[1], ['rotate', 'spikes']);
  assert.ok(nov[2].includes('slam') && nov[2].includes('saw') && !nov[2].includes('spikes'));
  assert.ok(nov[5].includes('inspector'));
  assert.ok(nov[7].includes('crusher') && nov[7].includes('thinBlood'));
  for (const n of Object.keys(nov)) {
    assert.ok(nov[n].length <= 4);
    for (const k of nov[n]) assert.ok(copy.NOVELTY[k], `callout copy for ${k}`);
  }
});

test('save: quality order is low → auto, teach counters sanitised, old saves load', () => {
  assert.deepEqual(SETTING_CHOICES.quality, ['low', 'medium', 'high', 'auto']);
  const old = sanitizeSave({ version: 1, progress: { unlocked: 3 }, settings: { quality: 'auto' } });
  assert.equal(old.progress.unlocked, 3);
  assert.deepEqual(old.teach, {});
  const t = sanitizeSave({ version: 1, teach: { brake: 2, slam: 'x', rotate: 400, bogus: 1 } });
  assert.deepEqual(t.teach, { brake: 2, slam: 0, rotate: 99 });
});

test('save: a future-version save is backed up and loaded sanitised', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const raw = JSON.stringify({ version: 99, progress: { unlocked: 4 }, newThing: { a: 1 } });
    store.set(SAVE_KEY, raw);
    const s = loadSave();
    assert.equal(saveInfo.status, 'future');
    assert.equal(store.get(`${SAVE_KEY}.future`), raw);
    assert.equal(s.version, SCHEMA_VERSION);
    assert.equal(s.progress.unlocked, 4);
    assert.equal(JSON.parse(store.get(SAVE_KEY)).version, SCHEMA_VERSION);
  } finally {
    delete globalThis.localStorage;
  }
});
