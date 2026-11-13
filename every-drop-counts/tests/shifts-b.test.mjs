/**
 * Every shift completes headless under several policies: no exceptions, no escapes / NaN, body
 * budget respected, blood conserved (incl. grinder pending), litres = collected + bonus - fines.
 * (Split in two files so node --test runs them in parallel.)
 */
import { test } from 'node:test';
import { checkShift } from './shift-check.mjs';

for (const level of [5, 6, 7, 8]) {
  test(`shift ${level}: idle / rock / smart complete cleanly`, async () => {
    for (const policy of ['idle', 'rock', 'smart']) await checkShift(level, policy, 10 + level);
  });
}
