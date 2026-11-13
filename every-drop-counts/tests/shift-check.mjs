/** Shared full-shift invariant check (used by shifts-a/b tests). */
import assert from 'node:assert/strict';
import { makeSim, runPolicy } from './helpers.mjs';

export async function checkShift(level, policy, seed) {
  const { sim, events } = await makeSim({ seed, level });
  let escapes = 0; let maxBodies = 0; let worst = 0;
  runPolicy(sim, policy, 200, (s) => {
    const c = s.ctx; let n = 0;
    for (const d of c.dyns) {
      if (d.removed) continue;
      n++;
      if (d.encased) continue;
      if (!(Math.abs(d.x) < c.drum.hw + 0.4 && Math.abs(d.y) < c.drum.hh + 0.4 && Math.abs(d.z) < c.drum.hd + 0.4)) escapes++;
      if (!Number.isFinite(d.x + d.y + d.z + d.vx + d.vy + d.vz)) escapes += 1000;
    }
    maxBodies = Math.max(maxBodies, n);
    const B = c.blood;
    let inBodies = 0;
    for (const dn of c.donors) for (const p of dn.partList) inBodies += p.blood;
    worst = Math.max(worst, Math.abs(B.collected + B.dissolved + B.pending + inBodies - B.donorTotal));
  });
  const tag = `shift ${level} ${policy}`;
  assert.equal(sim.state.status, 'ended', `${tag}: ended`);
  assert.equal(escapes, 0, `${tag}: bodies outside the drum / NaN`);
  assert.ok(maxBodies <= sim.ctx.T.sim.maxBodies, `${tag}: body budget ${maxBodies}`);
  assert.ok(worst < 1e-6, `${tag}: blood conservation ${worst}`);
  const end = events.filter((e) => e.type === 'shift:end');
  assert.equal(end.length, 1, `${tag}: exactly one shift:end`);
  const r = end[0].payload;
  assert.ok(['complete', 'timeout', 'failed'].includes(r.result));
  assert.ok(Math.abs(r.liters - (r.collected + r.bonus - r.fines)) < 0.2, `${tag}: liters = collected + bonus - fines`);
  assert.ok(r.report && r.report.title && r.report.lines.length, `${tag}: report text`);
  if (policy === 'idle') assert.equal(r.stars, 0, `${tag}: idle must not earn a drop (${r.liters} L)`);
  sim.dispose();
  return r;
}

/** shifts whose quotas must be retuned after the fix-round-2 systems pass (see shifts-a/b tests) */
export const RETUNE_PENDING = new Set([4, 5, 6]);
