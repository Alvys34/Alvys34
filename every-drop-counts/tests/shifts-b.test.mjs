/**
 * Every shift completes headless under several policies: no exceptions, no escapes / NaN, body
 * budget respected, blood conserved (incl. grinder pending), litres = collected + bonus - fines.
 * Also guards the balance targets so later tuning cannot silently break them:
 *   idle earns 0 drops everywhere; smart earns >= 2 drops; careless rocking earns >= 1 on shifts 1-2.
 * (Split in two files so node --test runs them in parallel. Seeds are fixed: deterministic.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkShift } from './shift-check.mjs';

for (const level of [5, 6, 7, 8]) {
  test(`shift ${level}: idle / rock / smart complete cleanly and hit the balance targets`, async () => {
    const idle = await checkShift(level, 'idle', 10 + level);
    const rock = await checkShift(level, 'rock', 10 + level);
    const smart = await checkShift(level, 'smart', 10 + level);
    assert.equal(idle.stars, 0, `shift ${level}: idle must earn 0 drops (${idle.liters} L)`);
    assert.ok(smart.stars >= 2, `shift ${level}: smart should earn >= 2 drops (${smart.liters} L, quota ${smart.quota})`);
    if (level <= 2) assert.ok(rock.stars >= 1, `shift ${level}: careless rocking should scrape 1 drop (${rock.liters} L)`);
  });
}
