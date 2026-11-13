#!/usr/bin/env node
// Smoke test for the PACKAGED Linux build (works for the placeholder and for the real game).
// Launches the app twice under xvfb-run with a throw-away profile and checks:
//   window opens, WebGL context, edcDesktop bridge (exact contract), localStorage persistence
//   across launches, fullscreen preference persistence, clean exit via edcDesktop.quit(),
//   no page console errors, network blocked, and (real game with ?debug=1) __edc.ready + no errors.
// Exits non-zero on any failure.
//
// Usage: node scripts/smoke.mjs [--app <dir>] [--direct] [--out <dir>] [--wait <ms>]
//                               [--query <qs>] [--allow-console-errors] [--keep-profile]
//   --app      packaged folder (default release/EveryDropCounts-linux-x64)
//   --direct   run the binary instead of the EveryDropCounts.sh launcher
//   --query    page query string (default "debug=1&quality=low" for real-game builds, none for the placeholder)
//   --wait     ms to let the page run before probing (default 4000; real game: 8000)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };

const appDir = path.resolve(opt('app', path.join(DESKTOP, 'release', 'EveryDropCounts-linux-x64')));
const outDir = path.resolve(opt('out', path.join(DESKTOP, 'release', 'smoke')));
const EXPECTED_KEYS = ['isDesktop', 'isFullscreen', 'platform', 'quit', 'setFullscreen', 'unlockAchievement', 'version'];

if (process.platform !== 'linux') { console.error('smoke: Linux only (uses xvfb-run)'); process.exit(2); }
const bin = path.join(appDir, 'EveryDropCounts');
const launcher = path.join(appDir, 'EveryDropCounts.sh');
if (!fs.existsSync(bin)) { console.error(`smoke: ${bin} not found - run npm run build:linux first`); process.exit(2); }
let buildInfo;
try {
  const { extractFile } = await import('@electron/asar');
  buildInfo = JSON.parse(extractFile(path.join(appDir, 'resources', 'app.asar'), 'build-info.json').toString());
} catch (e) { console.error(`smoke: cannot read build-info.json from app.asar: ${e.message}`); process.exit(2); }
const isRealGame = buildInfo.gameSource !== 'placeholder';
// quality=low: software GL (SwiftShader under xvfb) renders the high preset at ~1 frame per few seconds
const query = opt('query', isRealGame ? 'debug=1&quality=low' : '');
const waitMs = Number(opt('wait', isRealGame ? 8000 : 4000));
const useLauncher = !flag('direct') && fs.existsSync(launcher);
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edc-smoke-profile-'));

console.log(`smoke: ${appDir}`);
console.log(`smoke: game=${buildInfo.gameSource} version=${buildInfo.version} electron=${buildInfo.electron} via ${useLauncher ? 'EveryDropCounts.sh' : 'binary'}${isRoot ? ' (root: --no-sandbox)' : ''}`);
console.log(`smoke: profile=${profile} out=${outDir}`);

function runOnce(n) {
  const runDir = path.join(outDir, `run${n}`);
  fs.mkdirSync(runDir, { recursive: true });
  const target = useLauncher ? launcher : bin;
  const appArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (!useLauncher && isRoot) appArgs.unshift('--no-sandbox');
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  // Inside the X server: start the app, grab an X11 root-window screenshot once the report exists.
  const inner = [
    `${q(target)} ${appArgs.map(q).join(' ')} > ${q(path.join(runDir, 'stdout.log'))} 2>&1 &`,
    'pid=$!',
    `for i in $(seq 1 3000); do [ -f ${q(path.join(runDir, 'report.json'))} ] && break; kill -0 $pid 2>/dev/null || break; sleep 0.1; done`,
    `[ -f ${q(path.join(runDir, 'report.json'))} ] && import -window root ${q(path.join(runDir, 'x11-root.png'))} 2>/dev/null`,
    'wait $pid',
    'exit $?',
  ].join('\n');
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('xvfb-run', ['-a', '-s', '-screen 0 1600x900x24', 'sh', '-c', inner], {
      env: {
        ...process.env,
        EDC_SMOKE_DIR: runDir,
        EDC_USER_DATA_DIR: profile,
        EDC_SMOKE_WAIT_MS: String(waitMs),
        EDC_SMOKE_HOLD_MS: '1500',
        EDC_QUERY: query,
        ELECTRON_ENABLE_LOGGING: '',
        NODE_OPTIONS: '',
      },
      stdio: 'inherit',
      detached: true,
    });
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 330000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf8')); } catch { return null; } };
      resolve({ n, code, signal, ms: Date.now() - t0, report: read('report.json'), exit: read('exit.json'), runDir });
    });
  });
}

const results = [];
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); };

for (const n of [1, 2]) {
  const r = await runOnce(n);
  results.push(r);
  console.log(`smoke: run ${n} exited code=${r.code} signal=${r.signal} in ${r.ms} ms`);
}

const [a, b] = results;
for (const r of results) {
  const p = r.report?.probe;
  const tag = `run${r.n}`;
  check(`${tag}: process exit code 0`, r.code === 0, `code=${r.code} signal=${r.signal}`);
  check(`${tag}: smoke report written`, r.report?.ok === true, r.report?.reason || '');
  check(`${tag}: quit via edcDesktop.quit()`, r.exit?.via === 'bridge', JSON.stringify(r.exit));
  check(`${tag}: window visible`, r.report?.window?.visible === true, JSON.stringify(r.report?.window?.bounds));
  check(`${tag}: page served from app://game`, typeof p?.href === 'string' && p.href.startsWith('app://game/'), p?.href);
  const br = p?.bridge;
  check(`${tag}: bridge keys == contract`, br && JSON.stringify(br.keys) === JSON.stringify(EXPECTED_KEYS), br ? br.keys.join(',') : 'no edcDesktop');
  check(`${tag}: bridge values`, br && br.isDesktop === true && br.platform === 'linux' && br.version === buildInfo.version &&
    br.types.quit === 'function' && br.types.setFullscreen === 'function' && br.types.isFullscreen === 'function' && br.types.unlockAchievement === 'function',
    br ? `isDesktop=${br.isDesktop} platform=${br.platform} version=${br.version}` : '');
  check(`${tag}: isFullscreen()/setFullscreen() resolve booleans`, br && typeof br.isFullscreen === 'boolean' && typeof br.isFullscreenAfterSet === 'boolean' && br.isFullscreenAfterSet === false,
    br ? `before=${br.isFullscreen} after setFullscreen(false)=${br.isFullscreenAfterSet}` : '');
  const kt = r.report?.keyToggle;
  check(`${tag}: F11 and Alt+Enter toggle fullscreen`, kt && typeof kt.before === 'boolean' && kt.afterF11 === !kt.before && kt.afterAltEnter === kt.before,
    kt ? `start=${kt.before} F11->${kt.afterF11} Alt+Enter->${kt.afterAltEnter}${kt.error ? ' ' + kt.error : ''}` : 'no data');
  check(`${tag}: unlockAchievement() resolves boolean`, br && typeof br.unlockAchievement === 'boolean', `-> ${br?.unlockAchievement} (steam: ${r.report?.steam?.initialised ? 'on' : 'off - ' + r.report?.steam?.reason})`);
  check(`${tag}: no Node globals in page`, br && br.nodeLeak === false);
  check(`${tag}: WebGL context`, !!p?.webgl, p?.webgl ? `${p.webgl.context} | ${p.webgl.renderer}` : p?.webglError || 'none');
  check(`${tag}: WebAudio AudioContext`, !!p?.webaudio, p?.webaudio ? `state=${p.webaudio.state}` : p?.webaudioError || 'none');
  check(`${tag}: Gamepad API present`, p?.gamepadApi === true);
  check(`${tag}: remote network blocked`, p?.remoteFetchBlocked === true);
  check(`${tag}: window.open + external navigation blocked`, p?.windowOpenBlocked === true && p?.navigationBlocked === true, `open=${p?.windowOpenBlocked} nav=${p?.navigationBlocked}`);
  if (r.report?.app) check(`${tag}: Chromium sandbox ${r.report.app.chromiumSandbox ? 'ON' : 'OFF (--no-sandbox)'}`, true);
  check(`${tag}: screenshot not blank`, (r.report?.screenshot?.distinctSampledColors || 0) > 8, `${r.report?.screenshot?.distinctSampledColors} distinct sampled colours`);
  const errs = r.report?.consoleErrors || [];
  check(`${tag}: no page console errors`, flag('allow-console-errors') || errs.length === 0, errs.slice(0, 5).join(' | '));
  if (p?.placeholder) {
    const bad = Object.entries(p.placeholder).filter(([, v]) => v.status === 'fail');
    check(`${tag}: placeholder self-checks`, bad.length === 0, bad.map(([k, v]) => `${k}: ${v.detail}`).join(' | ') || `${Object.keys(p.placeholder).length} checks`);
  }
  if (p?.game) {
    check(`${tag}: game __edc.ready resolved`, p.game.ready === true, p.game.error || '');
    check(`${tag}: game __edc.errors empty`, flag('allow-console-errors') || !p.game.errors || p.game.errors.length === 0, (p.game.errors || []).slice(0, 5).join(' | '));
  } else if (isRealGame) {
    check(`${tag}: game debug harness (__edc) present`, !query.includes('debug=1'), 'window.__edc missing with ?debug=1');
  }
}
// real game: the play-through (boot -> title -> shift 1 with key input -> pause -> save -> UI quit)
for (const r of results) {
  const g = r.report?.gameFlow;
  if (!isRealGame || !query.includes('debug=1')) break;
  const tag = `run${r.n}`;
  if (!g || g.error) { check(`${tag}: game flow ran`, false, g?.error || 'no gameFlow in report'); continue; }
  check(`${tag}: boot splash -> title on a key press`, g.bootScreen === 'boot' && g.afterBoot === 'menu', `${g.bootScreen} -> ${g.afterBoot}`);
  check(`${tag}: audio unlocked by the key press`, g.audio && g.audio.state === 'running' && !g.audio.errors, JSON.stringify(g.audio));
  check(`${tag}: title -> briefing -> shift 1 with the keyboard`, g.afterClockIn === 'briefing' && g.afterBegin === 'playing' && !g.startedViaHarness, `${g.afterClockIn} -> ${g.afterBegin}`);
  check(`${tag}: shift runs and reacts to input`, // software GL under xvfb presents only ~1 frame every 2-4 s (JS per frame is ~15 ms, see perf), so this
    // asserts that key input reached the sim (drum turned, slam fired) rather than a real-time rate
    g.play?.screen === 'playing' && /^shift-\d$/.test(g.play?.levelId || '') && g.simAdvanced > 0.05 && g.drumTurned > 0.03 && g.play?.slams >= 1,
    `${g.play?.levelId}: sim +${g.simAdvanced}s in ${g.playWallMs} ms, drum turned ${g.drumTurned} rad, slams ${g.play?.slams}, fps ${g.play?.fps}, perf ${JSON.stringify(g.perf)}`);
  check(`${tag}: sound bank warm before play`, g.play?.audio && g.play.audio.bankQueue === 0, `${JSON.stringify(g.play?.audio)} bank render ${g.perf?.bankRenderMs} ms (max single ${g.perf?.bankMaxRenderMs} ms)`);
  check(`${tag}: Esc pauses and resumes`, g.paused === 'paused' && g.resumed === 'playing', `${g.paused} / ${g.resumed}`);
  check(`${tag}: settings fullscreen toggles through the bridge`, g.fsOn === true && g.fsOnWin === true && g.fsOff === false && g.fsOffWin === false, `on=${g.fsOn}/${g.fsOnWin} off=${g.fsOff}/${g.fsOffWin}`);
  check(`${tag}: achievement persisted`, (g.saveNow?.achievements || []).includes('FIRST_SHIFT'), JSON.stringify(g.saveNow?.achievements));
  if (g.fastForward) check(`${tag}: shift 1 finished and the report shown`, g.fastForward.status === 'ended' && g.results === 'results' && (g.saveNow?.best || []).includes('shift-1'), `${JSON.stringify(g.fastForward)} screen=${g.results}`);
  check(`${tag}: no game errors during play`, (g.errors || []).length === 0, (g.errors || []).slice(0, 3).join(' | '));
  check(`${tag}: Quit dialog opened from the title`, g.quitDialog === 'confirm', String(g.quitDialog));
}
if (isRealGame && query.includes('debug=1')) {
  const g1 = a.report?.gameFlow; const g2 = b.report?.gameFlow;
  check('game save persists across relaunch', (g2?.saveAtBoot?.best || []).includes('shift-1') && (g2?.saveAtBoot?.achievements || []).includes('FIRST_SHIFT') && (g2?.saveAtBoot?.secondsOnShift || 0) >= (g1?.saveNow?.secondsOnShift || 1),
    `run2 boot save: ${JSON.stringify(g2?.saveAtBoot)}`);
}
const la = a.report?.probe?.localStorage?.launchCount;
const lb = b.report?.probe?.localStorage?.launchCount;
check('localStorage persists across launches', Number.isInteger(la) && lb === la + 1, `run1=${la} run2=${lb}`);
check('first launch starts fullscreen', a.report?.probe?.bridge?.isFullscreen === true, `run1 isFullscreen=${a.report?.probe?.bridge?.isFullscreen}`);
check('windowed preference remembered', b.report?.probe?.bridge?.isFullscreen === false, `run2 isFullscreen=${b.report?.probe?.bridge?.isFullscreen}`);
check('userData dir named for the game', /EveryDropCounts$/.test(a.report?.defaultUserData || ''), a.report?.defaultUserData);

let failed = 0;
console.log('');
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  -- ${c.detail}` : ''}`);
}
const summary = { ok: failed === 0, failed, appDir, buildInfo, query, profile, checks, runs: results.map(({ n, code, signal, ms, runDir }) => ({ n, code, signal, ms, runDir })) };
fs.writeFileSync(path.join(outDir, 'smoke-summary.json'), JSON.stringify(summary, null, 2));
if (!flag('keep-profile')) fs.rmSync(profile, { recursive: true, force: true });
console.log(`\nsmoke: ${failed === 0 ? 'OK' : `${failed} FAILED`}  (screenshots: ${path.join(outDir, 'run1', 'screenshot.png')}, ${path.join(outDir, 'run1', 'x11-root.png')})`);
process.exit(failed === 0 ? 0 : 1);
