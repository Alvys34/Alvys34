#!/usr/bin/env node
// Builds ready-to-upload game folders (+ zips) for Steam depots:
//   desktop/release/EveryDropCounts-win-x64/EveryDropCounts.exe
//   desktop/release/EveryDropCounts-linux-x64/EveryDropCounts(.sh)
//
// Usage: node scripts/build.mjs [--platform linux|win|all] [--web-build] [--placeholder] [--no-zip]
//   (default)      package ../dist (fails if it does not exist)
//   --web-build    run `npm run build` in the parent (web game) package first
//   --placeholder  package desktop/placeholder instead of the game (explicit opt-in only)
//   --no-zip       skip the zip archives
//   --game-dir <d> package an arbitrary built web folder (testing only)
//   --version <v>  override the version (default: the web game's package.json version)
// Cross-builds Windows from Linux without wine: @electron/packager edits the exe resources
// (icon, version info) with the pure-JS `resedit` library.
import { packager } from '@electron/packager';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { generateIcons } from './make-icon.mjs';
import yazl from 'yazl';

const require = createRequire(import.meta.url);

/**
 * Zip `dir` (as a top-level folder of the same name) into `zipPath`, keeping Unix modes and symlinks.
 * Files whose base name is in `exec` are stored 0755 regardless of the host file system.
 */
function zipFolder(dir, zipPath, { exec = new Set() } = {}) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const top = path.basename(dir);
    const walk = (abs, rel) => {
      const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
      if (!entries.length) zip.addEmptyDirectory(rel);
      for (const e of entries) {
        const a = path.join(abs, e.name); const r = `${rel}/${e.name}`;
        const st = fs.lstatSync(a);
        if (st.isSymbolicLink()) zip.addBuffer(Buffer.from(fs.readlinkSync(a)), r, { mode: 0o120777, mtime: st.mtime, compress: false });
        else if (st.isDirectory()) walk(a, r);
        else if (st.isFile()) {
          const perm = exec.has(e.name) ? 0o755 : (st.mode & 0o777) | 0o644;
          zip.addFile(a, r, { mode: 0o100000 | perm, mtime: st.mtime, compress: true });
        }
      }
    };
    try { walk(dir, top); } catch (e) { reject(e); return; }
    const out = fs.createWriteStream(zipPath);
    out.on('close', resolve);
    out.on('error', reject);
    zip.outputStream.on('error', reject).pipe(out);
    zip.end();
  });
}
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DESKTOP, '..');
const RELEASE = path.join(DESKTOP, 'release');
const STAGE = path.join(DESKTOP, '.stage');
const EXE_NAME = 'EveryDropCounts';
const PRODUCT = 'Every Drop Counts';
const COMPANY = process.env.EDC_COMPANY_NAME || 'Every Drop Counts';   // TODO(release): set your legal/studio name
const KEEP_LOCALES = ['en-US'];

// Linux launcher (Steam launch target). See docs/STEAM_RELEASE.md "Linux sandbox".
const LINUX_LAUNCHER = `#!/bin/sh
# Every Drop Counts - Linux launcher. Point the Steam launch option at this file.
# Chromium's renderer sandbox needs a setuid-root chrome-sandbox (not possible in a Steam depot) or
# unprivileged user namespaces (blocked in some containers / hardened distros). Use the sandbox
# when the system allows it, otherwise (or if it fails to start) run with --no-sandbox.
# Overrides: EDC_NO_SANDBOX=1 (never sandbox), EDC_FORCE_SANDBOX=1 (always try the sandbox).
case "$0" in */*) HERE="\${0%/*}" ;; *) HERE=. ;; esac
HERE="$(cd "$HERE" && pwd -P)"
BIN="$HERE/${EXE_NAME}"
sandbox=0
if [ "\${EDC_NO_SANDBOX:-0}" = 1 ] || [ "$(id -u 2>/dev/null || echo 0)" = 0 ]; then
  sandbox=0
elif [ "\${EDC_FORCE_SANDBOX:-0}" = 1 ]; then
  sandbox=1
elif [ -u "$HERE/chrome-sandbox" ] && [ "$(stat -c %u "$HERE/chrome-sandbox" 2>/dev/null)" = 0 ]; then
  sandbox=1
elif command -v unshare >/dev/null 2>&1 && unshare -Ur true >/dev/null 2>&1; then
  sandbox=1
fi
if [ "$sandbox" = 1 ]; then
  start=$(date +%s)
  "$BIN" "$@"
  code=$?
  # A sandbox that cannot be set up aborts within a second or two (SIGTRAP/SIGABRT): retry once.
  if [ "$code" -ge 128 ] && [ $(( $(date +%s) - start )) -le 5 ]; then
    echo "${EXE_NAME}: sandboxed start failed (exit $code); retrying with --no-sandbox" >&2
    exec "$BIN" --no-sandbox "$@"
  fi
  exit "$code"
fi
exec "$BIN" --no-sandbox "$@"
`;

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const platformArg = opt('platform', 'all');
const PLATFORMS = platformArg === 'all' ? ['linux', 'win'] : [platformArg];
for (const p of PLATFORMS) if (!['linux', 'win'].includes(p)) die(`unknown --platform ${p} (linux|win|all)`);

function die(msg) { console.error(`\n[build] ERROR: ${msg}\n`); process.exit(1); }
function step(msg) { console.log(`[build] ${msg}`); }
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst, filter = () => true) {
  fs.cpSync(src, dst, { recursive: true, dereference: true, filter: (s) => filter(s) });
}
function dirSize(p) {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    n += e.isDirectory() ? dirSize(f) : fs.lstatSync(f).size;
  }
  return n;
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// ------------------------------------------------------------------ 1. game source
let gameDir;
let gameSource;
if (opt('game-dir')) {
  gameDir = path.resolve(opt('game-dir'));
  gameSource = 'custom';
  if (!fs.existsSync(path.join(gameDir, 'index.html'))) die(`${gameDir}/index.html not found`);
  step(`using a CUSTOM game dir (--game-dir ${gameDir}); for testing only.`);
} else if (flag('placeholder')) {
  gameDir = path.join(DESKTOP, 'placeholder');
  gameSource = 'placeholder';
  step('using the PLACEHOLDER page (--placeholder). This build is NOT shippable.');
} else {
  if (flag('web-build')) {
    step('running `npm run build` in the web game package ...');
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) die('web build failed (npm run build in the parent package)');
  }
  gameDir = path.join(ROOT, 'dist');
  gameSource = 'dist';
  if (!fs.existsSync(path.join(gameDir, 'index.html'))) {
    die(`${path.relative(DESKTOP, gameDir)}/index.html not found.\n  Build the web game first (npm run build in ${ROOT}),\n  or pass --web-build, or --placeholder for a wrapper-only test build.`);
  }
  const html = fs.readFileSync(path.join(gameDir, 'index.html'), 'utf8');
  if (/\s(src|href)="\/(?!\/)/.test(html)) {
    die('dist/index.html uses absolute "/..." asset URLs. vite.config.js must set base: \'./\'.');
  }
  if (/\s(src|href)="https?:\/\//i.test(html)) {
    console.warn('[build] WARNING: dist/index.html references http(s) URLs; they are blocked at runtime (offline game).');
  }
}

// ------------------------------------------------------------------ 2. version, app id, icons
const desktopPkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
let version = opt('version');
if (!version) {
  try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { /* fall through */ }
}
version = version || desktopPkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`version "${version}" must be MAJOR.MINOR.PATCH`);
const electronVersion = require('electron/package.json').version;
let steamAppId = null;
const appIdFile = path.join(DESKTOP, 'steam_appid.txt');
if (fs.existsSync(appIdFile)) {
  const v = fs.readFileSync(appIdFile, 'utf8').trim().split(/\s+/)[0];
  if (/^\d+$/.test(v) && Number(v) > 0) steamAppId = Number(v);
}
step(`version ${version}, electron ${electronVersion}, steam app id ${steamAppId ?? '(none - Steam disabled unless launched by Steam)'}`);
const iconDir = generateIcons(path.join(DESKTOP, 'resources', 'icons'));

// ------------------------------------------------------------------ 3. per-platform
fs.mkdirSync(RELEASE, { recursive: true });
const summary = [];
for (const plat of PLATFORMS) {
  const electronPlatform = plat === 'win' ? 'win32' : 'linux';
  const stage = path.join(STAGE, plat);
  rmrf(stage);
  fs.mkdirSync(stage, { recursive: true });
  step(`[${plat}] staging app -> ${path.relative(DESKTOP, stage)}`);

  // app code
  copyDir(path.join(DESKTOP, 'src'), path.join(stage, 'src'));
  // game
  copyDir(gameDir, path.join(stage, 'game'), (s) => !/\.map$/i.test(s) || flag('keep-sourcemaps'));
  // icon for the Linux window / taskbar
  fs.mkdirSync(path.join(stage, 'resources', 'icons'), { recursive: true });
  fs.copyFileSync(path.join(iconDir, 'icon.png'), path.join(stage, 'resources', 'icons', 'icon.png'));
  // steamworks.js: only this platform's native binaries
  const swSrc = path.dirname(require.resolve('steamworks.js/package.json'));
  const swDst = path.join(stage, 'node_modules', 'steamworks.js');
  const nativeDir = plat === 'win' ? 'win64' : 'linux64';
  fs.mkdirSync(path.join(swDst, 'dist'), { recursive: true });
  for (const f of ['index.js', 'package.json', 'LICENSE', 'README.md']) {
    if (fs.existsSync(path.join(swSrc, f))) fs.copyFileSync(path.join(swSrc, f), path.join(swDst, f));
  }
  copyDir(path.join(swSrc, 'dist', nativeDir), path.join(swDst, 'dist', nativeDir), (s) => !s.endsWith('.lib'));
  // package.json + build info
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: 'every-drop-counts', productName: PRODUCT, version, main: 'src/main.js', private: true,
    description: desktopPkg.description, license: desktopPkg.license,
    dependencies: { 'steamworks.js': desktopPkg.dependencies['steamworks.js'] },
  }, null, 2));
  fs.writeFileSync(path.join(stage, 'build-info.json'), JSON.stringify({
    version, steamAppId, gameSource, electron: electronVersion, platform: electronPlatform, builtAt: new Date().toISOString(),
  }, null, 2));

  // package
  const tmpOut = path.join(RELEASE, '.tmp');
  rmrf(tmpOut);
  step(`[${plat}] packaging with @electron/packager (electron ${electronVersion}) ...`);
  const [outPath] = await packager({
    dir: stage,
    out: tmpOut,
    name: EXE_NAME,
    executableName: EXE_NAME,
    platform: electronPlatform,
    arch: 'x64',
    electronVersion,
    appVersion: version,
    buildVersion: version,
    appCopyright: `Copyright (c) ${new Date().getFullYear()} ${COMPANY}`,
    asar: { unpack: '**/node_modules/steamworks.js/dist/**' },
    prune: false,           // node_modules is staged by hand (steamworks.js only, no deps)
    derefSymlinks: true,
    overwrite: true,
    quiet: true,
    ignore: [/^\/\.stage/, /^\/release/],
    icon: plat === 'win' ? path.join(iconDir, 'icon.ico') : undefined,
    win32metadata: plat === 'win' ? {
      CompanyName: COMPANY,
      FileDescription: PRODUCT,
      ProductName: PRODUCT,
      InternalName: EXE_NAME,
      OriginalFilename: `${EXE_NAME}.exe`,
    } : undefined,
  });

  // post-process
  const finalDir = path.join(RELEASE, `${EXE_NAME}-${plat}-x64`);
  rmrf(finalDir);
  fs.renameSync(outPath, finalDir);
  rmrf(tmpOut);

  // locales: keep en-US only (Chromium falls back to en-US for its few built-in strings)
  const locDir = path.join(finalDir, 'locales');
  let pruned = 0;
  for (const f of fs.readdirSync(locDir)) {
    if (!KEEP_LOCALES.some((l) => f === `${l}.pak` || f === `${l}.pak.info`)) { fs.rmSync(path.join(locDir, f)); pruned++; }
  }
  // fuses: harden the shipped binary (no ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect; app only from asar)
  const exePath = path.join(finalDir, plat === 'win' ? `${EXE_NAME}.exe` : EXE_NAME);
  await flipFuses(exePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  if (plat === 'linux') {
    // Steam launch target. Chromium's sandbox needs either a setuid-root chrome-sandbox (impossible
    // in a Steam depot) or unprivileged user namespaces (blocked in some containers / Ubuntu 24.04
    // AppArmor setups). Try the sandbox when the system supports it, otherwise fall back.
    fs.writeFileSync(path.join(finalDir, `${EXE_NAME}.sh`), LINUX_LAUNCHER, { mode: 0o755 });
    fs.chmodSync(exePath, 0o755);
    const icons = path.join(finalDir, 'icons');
    fs.mkdirSync(icons, { recursive: true });
    for (const f of fs.readdirSync(iconDir)) if (f.endsWith('.png')) fs.copyFileSync(path.join(iconDir, f), path.join(icons, f));
  }
  fs.writeFileSync(path.join(finalDir, 'version.txt'), `${PRODUCT} ${version} (${electronPlatform}-x64, electron ${electronVersion}, game: ${gameSource})\n`);

  const size = dirSize(finalDir);
  step(`[${plat}] ${path.relative(DESKTOP, finalDir)}  ${mb(size)}  (pruned ${pruned} locale files)`);
  let zipSize = null;
  if (!flag('no-zip')) {
    const zipPath = `${finalDir}.zip`;
    rmrf(zipPath);
    // pure-Node zip (no `zip` binary on Windows). Linux: launcher, binary and helpers are stored
    // 0755 even when this host's file system cannot keep exec bits (NTFS) - the folder itself still
    // loses them there, so build the Linux depot on Linux / WSL (docs/STEAM_RELEASE.md).
    const exec = plat === 'linux' ? new Set([EXE_NAME, `${EXE_NAME}.sh`, 'chrome-sandbox', 'chrome_crashpad_handler']) : new Set();
    await zipFolder(finalDir, zipPath, { exec });
    zipSize = fs.statSync(zipPath).size;
    step(`[${plat}] ${path.relative(DESKTOP, zipPath)}  ${mb(zipSize)}`);
  }
  summary.push({ platform: plat, dir: finalDir, size, zipSize, gameSource });
}
rmrf(STAGE);
fs.writeFileSync(path.join(RELEASE, 'build-summary.json'), JSON.stringify({ version, electronVersion, steamAppId, builtAt: new Date().toISOString(), builds: summary }, null, 2));
step('done.');
for (const s of summary) console.log(`  ${s.platform.padEnd(5)} ${mb(s.size).padStart(9)} folder ${s.zipSize ? mb(s.zipSize).padStart(9) + ' zip' : ''}  ${s.dir}${s.gameSource === 'placeholder' ? '   [PLACEHOLDER]' : ''}`);
