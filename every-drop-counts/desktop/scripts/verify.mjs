#!/usr/bin/env node
// Static verification of the packaged builds (no execution). This is the only check available for
// the Windows build on a Linux machine without wine: it does NOT prove that the .exe runs.
//
// Usage: node scripts/verify.mjs [--platform linux|win|all] [--allow-placeholder]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as ResEdit from 'resedit';
import { listPackage, extractFile } from '@electron/asar';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(DESKTOP, 'release');
const args = process.argv.slice(2);
const pi = args.indexOf('--platform');
const which = pi >= 0 ? args[pi + 1] : 'all';
const PLATS = which === 'all' ? ['win', 'linux'] : [which];

let failures = 0;
const ok = (cond, msg, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? `  -- ${detail}` : ''}`);
  return cond;
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

function peInfo(buf) {
  if (buf.readUInt16LE(0) !== 0x5a4d) return null;               // MZ
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x00004550) return null;          // PE\0\0
  const machine = buf.readUInt16LE(pe + 4);
  const characteristics = buf.readUInt16LE(pe + 22);
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  const subsystem = buf.readUInt16LE(opt + 68);
  return { machine, magic, subsystem, characteristics, dll: !!(characteristics & 0x2000) };
}
function elfInfo(buf) {
  if (buf.readUInt32BE(0) !== 0x7f454c46) return null;
  return { class: buf[4] === 2 ? 'ELF64' : 'ELF32', machine: buf.readUInt16LE(18) };     // 0x3e = x86-64
}

const REQUIRED_IN_ASAR = ['package.json', 'build-info.json', 'src/main.js', 'src/preload.js', 'src/steam.js', 'game/index.html',
  'node_modules/steamworks.js/index.js', 'node_modules/steamworks.js/package.json'];

function verifyAsar(dir, plat) {
  const asar = path.join(dir, 'resources', 'app.asar');
  if (!ok(fs.existsSync(asar), 'resources/app.asar present')) return;
  ok(!fs.existsSync(path.join(dir, 'resources', 'default_app.asar')), 'default_app.asar removed');
  const files = new Set(listPackage(asar, { isPack: false }).map((f) => f.replace(/\\/g, '/').replace(/^\//, '')));
  for (const f of REQUIRED_IN_ASAR) ok(files.has(f), `asar contains ${f}`);
  const gameFiles = [...files].filter((f) => f.startsWith('game/'));
  const info = JSON.parse(extractFile(asar, 'build-info.json').toString());
  ok(true, 'build-info.json', JSON.stringify(info));
  if (info.gameSource === 'placeholder' && args.includes('--allow-placeholder')) console.log('  WARN  packaged game is the PLACEHOLDER (allowed by --allow-placeholder; not shippable)');
  else ok(info.gameSource === 'dist', 'packaged game is the real web build (not the placeholder)', `gameSource=${info.gameSource}, ${gameFiles.length} entries under game/`);
  const pkg = JSON.parse(extractFile(asar, 'package.json').toString());
  ok(pkg.main === 'src/main.js' && !pkg.devDependencies, 'asar package.json (main, no devDependencies)', `main=${pkg.main} version=${pkg.version}`);
  const leaked = [...files].filter((f) => /(^|\/)(\.stage|release|placeholder|scripts|steam_appid\.txt)(\/|$)/.test(f) && !f.startsWith('game/'));
  ok(leaked.length === 0, 'no build-only files in asar', leaked.slice(0, 5).join(', '));
  const keep = plat === 'win' ? 'win64' : 'linux64';
  const otherNative = [...files].filter((f) => f.includes('steamworks.js/dist/') && !new RegExp(`steamworks\\.js/dist/${keep}(/|$)`).test(f));
  ok(otherNative.length === 0, 'only this platform\'s steamworks binaries', otherNative.join(', '));
  return info;
}

for (const plat of PLATS) {
  const dir = path.join(RELEASE, `EveryDropCounts-${plat}-x64`);
  console.log(`\n== ${plat}: ${dir}`);
  if (!ok(fs.existsSync(dir), 'release folder exists')) continue;

  if (plat === 'win') {
    const exePath = path.join(dir, 'EveryDropCounts.exe');
    if (!ok(fs.existsSync(exePath), 'EveryDropCounts.exe present')) continue;
    ok(!fs.existsSync(path.join(dir, 'electron.exe')), 'no stray electron.exe');
    const buf = fs.readFileSync(exePath);
    const pe = peInfo(buf);
    ok(pe && pe.machine === 0x8664 && pe.magic === 0x20b, 'PE32+ x86-64 executable', pe ? `machine=0x${pe.machine.toString(16)} magic=0x${pe.magic.toString(16)}` : 'not a PE file');
    ok(pe && pe.subsystem === 2, 'Windows GUI subsystem (no console window)', pe ? `subsystem=${pe.subsystem}` : '');
    const exe = ResEdit.NtExecutable.from(buf, { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(exe);
    const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
    const lang = vi.getAllLanguagesForStringValues()[0];
    const strings = vi.getStringValues(lang);
    ok(strings.ProductName === 'Every Drop Counts' && strings.FileDescription === 'Every Drop Counts', 'version info: ProductName / FileDescription',
      `ProductName="${strings.ProductName}" FileDescription="${strings.FileDescription}"`);
    ok(strings.OriginalFilename === 'EveryDropCounts.exe' && !!strings.CompanyName, 'version info: OriginalFilename / CompanyName',
      `OriginalFilename="${strings.OriginalFilename}" CompanyName="${strings.CompanyName}" LegalCopyright="${strings.LegalCopyright}"`);
    ok(/^\d+\.\d+\.\d+/.test(strings.FileVersion || '') && strings.ProductVersion === strings.FileVersion, 'version info: FileVersion == ProductVersion',
      `FileVersion=${strings.FileVersion} ProductVersion=${strings.ProductVersion}`);
    // icon: compare the exe's icon images with our generated icon.ico
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(DESKTOP, 'resources', 'icons', 'icon.ico')));
    const want = new Set(ico.icons.map((i) => sha(Buffer.from(i.data.bin ?? i.data.generate()))));
    let got = [];
    if (groups.length === 1) {
      const ids = new Set(groups[0].icons.map((i) => i.iconID));
      got = res.entries.filter((e) => e.type === 3 && ids.has(e.id)).map((e) => sha(Buffer.from(e.bin)));
    }
    const sizes = groups[0] ? groups[0].icons.map((i) => i.width || 256).join(',') : '';
    ok(groups.length === 1 && got.length === want.size && got.every((h) => want.has(h)), 'exe icon == generated blood-drop icon.ico', `sizes ${sizes}`);
    ok(res.entries.some((e) => e.type === 24), 'application manifest present');
    // fuses
    const wire = await getCurrentFuseWire(exePath);
    ok(fuseDisabled(wire, FuseV1Options.RunAsNode), 'fuse RunAsNode disabled', fuseStr(wire));
    ok(fuseEnabled(wire, FuseV1Options.OnlyLoadAppFromAsar), 'fuse OnlyLoadAppFromAsar enabled');
    // runtime files
    for (const f of ['ffmpeg.dll', 'icudtl.dat', 'resources.pak', 'v8_context_snapshot.bin', 'snapshot_blob.bin', 'd3dcompiler_47.dll',
      'vk_swiftshader.dll', 'vulkan-1.dll', 'chrome_100_percent.pak', 'locales/en-US.pak', 'LICENSE', 'LICENSES.chromium.html']) {
      ok(fs.existsSync(path.join(dir, f)), `runtime file ${f}`);
    }
    const locs = fs.readdirSync(path.join(dir, 'locales'));
    ok(locs.length >= 1 && locs.every((l) => l.startsWith('en-US')), 'locales pruned to en-US', locs.join(','));
    const info = verifyAsar(dir, 'win');
    const nat = path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'steamworks.js', 'dist', 'win64');
    for (const f of ['steamworksjs.win32-x64-msvc.node', 'steam_api64.dll']) {
      const p = path.join(nat, f);
      const e = fs.existsSync(p) ? peInfo(fs.readFileSync(p)) : null;
      ok(e && e.machine === 0x8664 && e.dll, `unpacked native ${f} is a win64 DLL`, e ? `machine=0x${e.machine.toString(16)}` : 'missing');
    }
    if (info) ok(true, 'NOTE: the Windows build was NOT executed (no Windows/wine here)');
  } else {
    const bin = path.join(dir, 'EveryDropCounts');
    if (!ok(fs.existsSync(bin), 'EveryDropCounts binary present')) continue;
    const st = fs.statSync(bin);
    ok((st.mode & 0o111) !== 0, 'binary is executable');
    const e = elfInfo(fs.readFileSync(bin).subarray(0, 64));
    ok(e && e.class === 'ELF64' && e.machine === 0x3e, 'ELF64 x86-64', JSON.stringify(e));
    const sh = path.join(dir, 'EveryDropCounts.sh');
    ok(fs.existsSync(sh) && (fs.statSync(sh).mode & 0o111) !== 0, 'EveryDropCounts.sh launcher present and executable');
    ok(fs.existsSync(path.join(dir, 'chrome-sandbox')), 'chrome-sandbox present (used only if made setuid by a packager/distro)');
    const wire = await getCurrentFuseWire(bin);
    ok(fuseDisabled(wire, FuseV1Options.RunAsNode), 'fuse RunAsNode disabled', fuseStr(wire));
    ok(fuseEnabled(wire, FuseV1Options.OnlyLoadAppFromAsar), 'fuse OnlyLoadAppFromAsar enabled');
    for (const f of ['libffmpeg.so', 'icudtl.dat', 'resources.pak', 'v8_context_snapshot.bin', 'snapshot_blob.bin', 'chrome_crashpad_handler',
      'libvk_swiftshader.so', 'locales/en-US.pak', 'LICENSE', 'LICENSES.chromium.html', 'icons/256x256.png']) {
      ok(fs.existsSync(path.join(dir, f)), `runtime file ${f}`);
    }
    verifyAsar(dir, 'linux');
    const nat = path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'steamworks.js', 'dist', 'linux64');
    for (const f of ['steamworksjs.linux-x64-gnu.node', 'libsteam_api.so']) {
      const p = path.join(nat, f);
      const el = fs.existsSync(p) ? elfInfo(fs.readFileSync(p).subarray(0, 64)) : null;
      ok(el && el.machine === 0x3e, `unpacked native ${f} is ELF x86-64`, el ? el.class : 'missing');
    }
  }
}

function fuseState(wire, o) { const v = wire[o]; return typeof v === 'number' ? String.fromCharCode(v) : String(v); }
function fuseDisabled(wire, o) { return fuseState(wire, o) === '0'; }
function fuseEnabled(wire, o) { return fuseState(wire, o) === '1'; }
function fuseStr(wire) {
  return Object.keys(FuseV1Options).filter((k) => isNaN(Number(k))).map((k) => `${k}=${fuseState(wire, FuseV1Options[k])}`).join(' ');
}

console.log(`\nverify: ${failures === 0 ? 'OK' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
