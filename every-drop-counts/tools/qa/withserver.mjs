#!/usr/bin/env node
// Run a QA script with its own Vite dev server (EDC_NO_HMR) on QA_PORT (default 5179); kills it afterwards.
//   node tools/qa/withserver.mjs tools/qa/persona.mjs --level 1 ...
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT } from './lib.mjs';
const port = process.env.QA_PORT || '5179';
const url = `http://localhost:${port}/`;
let server = null;
const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
if (!(await up())) {
  server = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--port', port, '--strictPort'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, EDC_NO_HMR: '1' } });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const [script, ...rest] = process.argv.slice(2);
const child = spawn(process.execPath, [script, ...rest], { cwd: ROOT, stdio: 'inherit' });
const code = await new Promise((r) => child.on('close', r));
if (server) server.kill();
process.exit(code ?? 0);
