#!/usr/bin/env node
/**
 * Bot matrix: every shift × policy × seed, run in parallel child processes, printed as tables.
 *   node tools/botmatrix.mjs [--levels 1,2,3,overtime] [--policies idle,spin,rock,smart] [--seeds 3]
 *                            [--ot-seeds 2] [--jobs 4] [--json out.json] [--compact]
 * Default = the full fix-round table: every bot policy AND the PLAYTEST-1 personas (cautious, holder,
 * masher, thinker) × 3 seeds × shifts 1–8, plus Overtime × 2 seeds:
 *   node tools/botmatrix.mjs --json docs/qa/botmatrix-fix2-systems.json --compact
 * Columns: litres, drops, kills, drownings (n and % of product spawned), Inspector deaths, the time
 * the pool reached its fill cap (s, '-' = never), maxIdle (longest stretch with nothing to process).
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const levels = get('levels', '1,2,3,4,5,6,7,8,overtime').split(',');
const policies = get('policies', 'idle,spin,rock,rockR,tumble,slamSpam,flipper,rockAim,park,smart,cautious,holder,masher,thinker').split(',');
const seeds = Number(get('seeds', '3'));
const otSeeds = Number(get('ot-seeds', '2'));
const jobs = Number(get('jobs', String(Math.max(1, os.cpus().length))));
const seed0 = Number(get('seed', '1'));

const tasks = [];
for (const level of levels) for (const policy of policies) for (let k = 0; k < (level === 'overtime' ? otSeeds : seeds); k++) tasks.push({ level, policy, seed: seed0 + k });
// longest runs first (Overtime) so the pool of workers drains evenly
tasks.sort((a, b) => (b.level === 'overtime') - (a.level === 'overtime'));

function run(task) {
  return new Promise((res) => {
    const a = [resolve(ROOT, 'tools/simbot.mjs'), '--policy', task.policy, '--seed', String(task.seed), '--json'];
    if (get('tune', null)) a.push('--tune', get('tune', null));
    if (task.level === 'overtime') a.push('--overtime', '--max', get('max', '900')); else a.push('--level', task.level);
    const p = spawn(process.execPath, a, { cwd: ROOT });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => {
      try { res(JSON.parse(out)[0]); } catch { res({ ...task, error: err.split('\n').slice(0, 3).join(' ') || 'no output' }); }
    });
  });
}

const results = [];
let next = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < tasks.length) {
    const task = tasks[next++];
    const r = await run(task);
    results.push({ ...task, ...r, level: task.level });
    process.stderr.write(`\r${results.length}/${tasks.length}`);
  }
}));
process.stderr.write(`\r${tasks.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);

const compact = args.includes('--compact');
for (const level of levels) {
  const rows = results.filter((r) => r.level === level);
  if (compact) { printCompact(level, rows); continue; }
  const q = rows.find((r) => r.quota) || {};
  console.log(`\n### Shift ${level}  quota ${JSON.stringify(q.quota || '')}`);
  console.log('| policy | litres (per seed) | drops | time s | kills | drown | insp. deaths | maxIdle s | fill@half | peak bodies | step ms mean/max |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const policy of policies) {
    const rs = rows.filter((r) => r.policy === policy).sort((a, b) => a.seed - b.seed);
    if (!rs.length) continue;
    if (rs.some((r) => r.error)) { console.log(`| ${policy} | ERROR ${rs.find((r) => r.error).error} |`); continue; }
    const f = (k, dgt = 0) => rs.map((r) => (r[k] == null ? '-' : (+r[k]).toFixed(dgt))).join(' / ');
    console.log(`| ${policy} | ${f('liters')} | ${f('stars')} | ${f('time')} | ${f('kills')} | ${f('drownings')} | ${f('inspectorDeaths')} | ${f('maxIdle')} | ${f('fillHalf', 2)} | ${Math.max(...rs.map((r) => r.peakBodies))} | ${(rs.reduce((s, r) => s + r.stepMsMean, 0) / rs.length).toFixed(2)} / ${Math.max(...rs.map((r) => r.stepMsMax)).toFixed(1)} |`);
  }
}
function printCompact(level, rows) {
  const q = rows.find((r) => r.quota) || {};
  const ot = level === 'overtime';
  console.log(`\n### ${ot ? 'Overtime' : `Shift ${level}`}${ot ? '' : `  quota ${JSON.stringify(q.quota || '')}, ${rows[0] && rows[0].duration} s`}`);
  console.log(ot ? '| policy | litres | % of smart | time s | kills | drown (%) | insp. deaths | peak bodies | step ms mean |'
    : '| policy | litres | drops | kills | drown (% of product) | insp. deaths | fill cap at s | maxIdle s |');
  console.log(ot ? '|---|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|---|---|');
  const smartMean = mean(rows.filter((r) => r.policy === 'smart').map((r) => r.liters));
  for (const policy of policies) {
    const rs = rows.filter((r) => r.policy === policy).sort((a, b) => a.seed - b.seed);
    if (!rs.length) continue;
    if (rs.some((r) => r.error)) { console.log(`| ${policy} | ERROR ${rs.find((r) => r.error).error} |`); continue; }
    const f = (k, dgt = 0) => rs.map((r) => (r[k] == null ? '-' : (+r[k]).toFixed(dgt))).join('/');
    const dr = `${f('drownings')} (${mean(rs.map((r) => r.drownPct)).toFixed(0)} %)`;
    if (ot) console.log(`| ${policy} | ${f('liters')} | ${(100 * mean(rs.map((r) => r.liters)) / smartMean).toFixed(0)} % | ${f('time')} | ${f('kills')} | ${dr} | ${f('inspectorDeaths')} | ${Math.max(...rs.map((r) => r.peakBodies))} | ${mean(rs.map((r) => r.stepMsMean)).toFixed(2)} |`);
    else console.log(`| ${policy} | ${f('liters')} | ${f('stars')} | ${f('kills')} | ${dr} | ${f('inspectorDeaths')} | ${f('capT')} | ${f('maxIdle')} |`);
  }
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

const jsonOut = get('json', null);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
