/**
 * Intake hatch + wave spawner shared by modes.
 *
 * hatch: { wall: 'ceiling'|'floor'|'left'|'right', at: tangent coord, offset?: m inward }
 *      or { wall: 'back', x, y, offset?: m in front of the back wall }  (donors drop from mid-air)
 * wave:  { at: seconds, count, types?: { standard: 3, bigGiver: 1 } | ['standard', ...],
 *          props?: [{ type, count }] }
 */
import { wallFrame, wallPoint } from './physics.js';
import { spawnDonor } from './donor.js';
import { createProp } from './props/index.js';

export function createSpawner(ctx, hatch) {
  const T = ctx.T;
  const queue = [];
  let timer = 0;
  let wait = 0;
  const sp = {
    hatch: { wall: hatch.wall || 'ceiling', at: hatch.at || 0, x: hatch.x || 0, y: hatch.y || 0, offset: hatch.offset ?? 1.1, open: 0 },
    get pending() { return queue.length; },
    /** queued donors that are product (not Inspectors) */
    get pendingTargets() { return queue.filter((q) => q.kind === 'donor' && q.type !== 'inspector').length; },
    /** Queue a wave: returns number of entities queued. */
    openWave(wave) {
      const list = expandTypes(ctx, wave);
      for (const t of list) queue.push({ kind: 'donor', type: t });
      for (const p of wave.props || []) for (let i = 0; i < (p.count || 1); i++) queue.push({ kind: 'prop', spec: p });
      sp.hatch.open = 1;
      ctx.emit('hatch:open', { wave: wave.index ?? 0 }, sp.position());
      timer = 0.15;
      return list.length;
    },
    position() {
      const h = sp.hatch;
      if (h.wall === 'back') return [h.x, h.y, -ctx.drum.hd + h.offset];
      const [x, y] = wallPoint(ctx.drum, h.wall, h.at, h.offset);
      return [x, y, 0];
    },
    step(dt) {
      if (!queue.length) { sp.hatch.open = Math.max(0, sp.hatch.open - dt * 1.5); return; }
      sp.hatch.open = 1;
      timer -= dt;
      if (timer > 0) return;
      const back = sp.hatch.wall === 'back';
      const p0 = sp.position();
      const x = p0[0]; const y = p0[1];
      const z = back ? p0[2] + ctx.rng.range(0, 0.6) : ctx.rng.range(-1.5, 1.5);
      // wait if the hatch mouth is crowded (max 1.5 s)
      if (crowded(ctx, x, y, z, 0.7 * (T.donor.scale ?? 1)) && wait < 1.5) { wait += dt; return; }
      wait = 0;
      const item = queue.shift();
      // back hatch: push toward the camera and sideways in-plane; wall hatch: push along the normal
      const f = back ? { n: [0, 0], t: [1, 0] } : wallFrame(ctx.drum, sp.hatch.wall);
      const push = back ? 0 : 2.5;
      if (item.kind === 'donor') {
        if (ctx.dyns.length + 11 <= T.sim.maxBodies) {
          spawnDonor(ctx, item.type, x + ctx.rng.range(-0.3, 0.3) * f.t[0], y + ctx.rng.range(-0.3, 0.3) * f.t[1], z, {
            vx: f.n[0] * push + f.t[0] * ctx.rng.range(-1, 1), vy: f.n[1] * push + f.t[1] * ctx.rng.range(-1, 1),
            vz: back ? ctx.rng.range(0.8, 2.0) : ctx.rng.range(-0.5, 0.5),
          });
        }
      } else if (item.kind === 'prop') {
        const prop = createProp(ctx, { ...item.spec, pos: [x, y, z], vel: [f.n[0] * push, f.n[1] * push, back ? 1 : 0] }, ctx.nextPropId++);
        ctx.props.push(prop);
      }
      timer = T.levels.spawnInterval;
    },
  };
  return sp;
}

function crowded(ctx, x, y, z, r) {
  const r2 = r * r;
  for (const d of ctx.dyns) {
    if (d.removed) continue;
    const dx = d.x - x; const dy = d.y - y; const dz = d.z - z;
    if (dx * dx + dy * dy + dz * dz < r2) return true;
  }
  return false;
}

function expandTypes(ctx, wave) {
  const n = wave.count || 0;
  const t = wave.types;
  if (!t) return Array(n).fill('standard');
  if (Array.isArray(t)) return t.length >= n ? t.slice(0, Math.max(n, t.length)) : [...t, ...Array(n - t.length).fill('standard')];
  const list = [];
  for (const [type, k] of Object.entries(t)) for (let i = 0; i < k; i++) list.push(type);
  // deterministic shuffle
  for (let i = list.length - 1; i > 0; i--) { const j = ctx.rng.int(0, i); [list[i], list[j]] = [list[j], list[i]]; }
  while (list.length < n) list.push('standard');
  return list;
}
