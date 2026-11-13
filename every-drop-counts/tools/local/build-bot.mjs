#!/usr/bin/env node
/**
 * Bundles tools/policies.mjs (the sim bot policies) into one IIFE that a real browser page can load
 * with addScriptTag, so the real-GPU perf / capture scripts can drive the production build with the
 * same "smart" bot the headless balance runs use. Output: tools/local/out/bot.iife.js (window.EDCBOT).
 */
import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
await build({
  configFile: false,
  root: ROOT,
  logLevel: 'warn',
  build: {
    outDir: resolve(HERE, 'out'),
    emptyOutDir: false,
    minify: false,
    lib: { entry: resolve(ROOT, 'tools/policies.mjs'), formats: ['iife'], name: 'EDCBOT', fileName: () => 'bot.iife.js' },
  },
});
console.log('wrote tools/local/out/bot.iife.js');
