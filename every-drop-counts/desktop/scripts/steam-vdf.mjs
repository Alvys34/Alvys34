#!/usr/bin/env node
// Renders the SteamPipe templates in desktop/steam/*.template.vdf into desktop/steam/generated/
// with real ids and ABSOLUTE paths, and prints the steamcmd command to upload.
//
// Usage: node scripts/steam-vdf.mjs --app <appid> --win-depot <depotid> --linux-depot <depotid>
//                                   [--branch beta] [--desc "text"] [--preview]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEAM = path.join(DESKTOP, 'steam');
const OUT = path.join(STEAM, 'generated');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const id = (n) => {
  const v = opt(n);
  if (!/^\d+$/.test(v || '')) { console.error(`--${n} <numeric id> is required`); process.exit(1); }
  return v;
};
const appId = id('app');
const winDepot = id('win-depot');
const linuxDepot = id('linux-depot');
const branch = opt('branch', '');
if (branch === 'default') { console.error('Steam does not allow setting the default branch live from steamcmd; do it in Steamworks > SteamPipe > Builds.'); process.exit(1); }
let version = 'unknown';
try { version = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'release', 'build-summary.json'), 'utf8')).version; } catch { /* no build yet */ }
const desc = opt('desc', `Every Drop Counts ${version} (${new Date().toISOString().slice(0, 16)}Z)`).replace(/"/g, "'");

for (const plat of ['win', 'linux']) {
  const dir = path.join(DESKTOP, 'release', `EveryDropCounts-${plat}-x64`);
  if (!fs.existsSync(dir)) console.warn(`WARNING: ${dir} does not exist yet - run npm run build:all first.`);
}
fs.mkdirSync(OUT, { recursive: true });
const fill = (s) => s
  .replaceAll('__APP_ID__', appId).replaceAll('__WIN_DEPOT_ID__', winDepot).replaceAll('__LINUX_DEPOT_ID__', linuxDepot)
  .replaceAll('__BRANCH__', branch).replaceAll('__BUILD_DESC__', desc)
  .replace('"ContentRoot" "../release/"', `"ContentRoot" "${path.join(DESKTOP, 'release').replace(/\\/g, '/')}/"`)
  .replace('"BuildOutput" "./output/"', `"BuildOutput" "${path.join(STEAM, 'output').replace(/\\/g, '/')}/"`)
  .replace('"Preview"     "0"', `"Preview"     "${args.includes('--preview') ? '1' : '0'}"`);
for (const f of ['app_build', 'depot_build_windows', 'depot_build_linux']) {
  fs.writeFileSync(path.join(OUT, `${f}.vdf`), fill(fs.readFileSync(path.join(STEAM, `${f}.template.vdf`), 'utf8')));
}
console.log(`wrote ${OUT}/{app_build,depot_build_windows,depot_build_linux}.vdf`);
console.log('\nupload with:');
console.log(`  steamcmd +login <your_build_account> +run_app_build "${path.join(OUT, 'app_build.vdf')}" +quit`);
