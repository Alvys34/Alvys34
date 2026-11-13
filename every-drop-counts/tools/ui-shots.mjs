#!/usr/bin/env node
/**
 * UI verification driver (Playwright, headless Chromium + SwiftShader). Drives the real flows by
 * keyboard (and a simulated gamepad), checks persistence, and screenshots every screen.
 *
 *   node tools/ui-shots.mjs [--port 5177] [--out tools/out/ui] [--sizes 1280x720,1920x1080,2560x1080,1280x800]
 *                           [--only flow|pad|corrupt|screens] [--url-base http://localhost:5177/]
 *   (start the server yourself: EDC_NO_HMR=1 npx vite --port 5177 --strictPort)
 *   --dist  use file://…/dist/index.html (built game) instead of the dev server
 * Exit code 1 on page errors or failed checks.
 */
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(`--${k}`);
const PORT = Number(get('port', '5177'));
const OUT = resolve(get('out', resolve(ROOT, 'tools/out/ui')));
const SIZES = get('sizes', '1280x720,1920x1080,2560x1080,1280x800').split(',').map((s) => s.split('x').map(Number));
const ONLY = get('only', null);
const EXTRA = get('query', ''); // e.g. --query "&quality=low" (software WebGL is slow on a loaded machine)
const BASE = has('dist') ? pathToFileURL(resolve(ROOT, 'dist/index.html')).href : get('url-base', `http://localhost:${PORT}/`);
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAD_SHIM = () => {
  // simulated gamepad: window.__pad.press(i) / hold(i, on) / axis(i, v)
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  const axes = [0, 0, 0, 0];
  const pad = { id: 'Simulated Xbox pad', index: 0, connected: true, mapping: 'standard', buttons, axes, timestamp: 0 };
  let on = false;
  window.__pad = {
    connect() { on = true; },
    hold(i, v) { buttons[i].pressed = v; buttons[i].value = v ? 1 : 0; },
    axis(i, v) { axes[i] = v; },
  };
  const orig = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
  navigator.getGamepads = () => (on ? [pad, null, null, null] : orig());
};

async function newPage(browser, w, h, { pad = false, storage = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  if (pad) await ctx.addInitScript(PAD_SHIM);
  if (storage !== null) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); if (s === '') localStorage.clear(); else localStorage.setItem('edc.save.v1', s); } }, storage);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  page.errs = errs;
  return page;
}
async function open(page, query = '') {
  await page.goto(`${BASE}?debug=1&seed=1${EXTRA}${query}`);
  await page.waitForFunction(() => window.__edc && window.__edc.getState, null, { timeout: 90000 });
  await page.evaluate(() => window.__edc.ready);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // software WebGL renders ~1 frame/s on a loaded machine: CSS transitions/animations would be
  // captured mid-way, so screenshots show end states (the real game runs them at 60 fps)
  await page.addStyleTag({ content: '*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation:none!important}' });
  await sleep(400);
}
const state = (page) => page.evaluate(() => window.__edc.getState());
const ui = (page, fn, arg) => page.evaluate(fn, arg);
async function key(page, k, wait = 260) { await page.keyboard.press(k); await sleep(wait); }
async function shot(page, name) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file, timeout: 240000 });
  console.log(`  shot ${file}`);
}
async function step(page, n, renderLast = 0) {
  let left = n;
  while (left > 0) {
    const k = Math.min(left, 60);
    await page.evaluate(([c, r]) => window.__edc.step(c, r), [k, left <= renderLast]);
    left -= k;
  }
}
/** scripted "operator": rocks the drum and slams; returns when the shift ends (or maxSteps) */
async function playShift(page, { maxSteps = 9000, period = 100, slamEvery = 150, render = 0 } = {}) {
  for (let i = 0; i < maxSteps; i += 30) {
    const dir = Math.floor(i / period) % 2 ? -1 : 1;
    const st = await page.evaluate(([d, sl]) => { window.__edc.setInput({ rotate: d, slam: sl }); window.__edc.step(30, false); return window.__edc.getState(); }, [dir, slamEvery > 0 && i % slamEvery < 30]);
    if (st.status === 'ended') break;
  }
  await page.evaluate(() => window.__edc.setInput(null));
  if (render) await step(page, render, render);
}
const focusedText = (page) => page.evaluate(() => { const f = window.__edc.ui.nav.focused; return f ? f.innerText.replace(/\s+/g, ' ').trim() : null; });
const topScreen = (page) => page.evaluate(() => (window.__edc.ui.nav.top ? window.__edc.ui.nav.top.name : null));
const save = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('edc.save.v1') || 'null'));
const reportErrors = (page, label) => {
  const e = [...new Set(page.errs)];
  check(e.length === 0, `${label}: no console errors${e.length ? ` (${e.slice(0, 3).join(' | ')})` : ''}`);
};

// =============================================================== keyboard flow (fresh save)
async function flow(browser) {
  console.log('\n== keyboard flow (fresh save) 1280x720');
  const page = await newPage(browser, 1280, 720, { storage: '' });
  await open(page);
  check((await state(page)).screen === 'boot', 'starts on the boot splash');
  await key(page, 'Enter', 600);
  check(await topScreen(page) === 'title', 'any key -> title');
  check((await focusedText(page) || '').startsWith('Clock in'), 'title focuses "Clock in"');
  await key(page, 'ArrowDown'); await key(page, 'ArrowDown');
  check((await focusedText(page) || '').startsWith('Overtime'), 'arrow nav reaches Overtime (locked)');
  await key(page, 'Enter');
  check(await topScreen(page) === 'title', 'locked Overtime does not open');
  await key(page, 'ArrowUp'); await key(page, 'ArrowUp');
  await key(page, 'Enter', 700);
  check(await topScreen(page) === 'briefing', 'Clock in -> briefing card');
  await key(page, 'Escape', 600);
  check(await topScreen(page) === 'title', 'Esc on briefing -> back to title');
  await key(page, 'Enter', 700);
  await key(page, 'Enter', 700);
  check((await state(page)).screen === 'playing', 'Begin shift -> playing');
  await page.evaluate(() => window.__edc.setTimeScale(0));
  await step(page, 150, 30);
  await shot(page, 'flow-01-hud-start');
  // teaching prompt for ROTATE should be up in shift 1 until the player rotates
  check(await page.evaluate(() => !document.querySelector('.prompt').hidden), 'shift 1 shows the rotate prompt');
  await playShift(page, { maxSteps: 12000, render: 20 });
  let st = await state(page);
  console.log(`  shift 1 ended: L=${st.liters} stars=${st.stars} result=${st.result && st.result.result}`);
  await page.waitForFunction(() => window.__edc.getState().screen === 'results', null, { timeout: 240000 });
  await sleep(2600);
  await shot(page, 'flow-02-results');
  check(await topScreen(page) === 'results', 'results report shown');
  const sv = await save(page);
  check(sv && sv.best['shift-1'] && sv.best['shift-1'].liters > 0, 'best litres for shift 1 saved');
  check(sv && sv.progress.unlocked >= 2, 'shift 2 unlocked after a drop');
  check(sv && sv.achievements && sv.achievements.FIRST_SHIFT > 0, 'achievement FIRST_SHIFT persisted (tracker -> save)');
  await key(page, 'Enter', 800); // Next shift
  check(await topScreen(page) === 'briefing', 'Next -> shift 2 briefing');
  await key(page, 'Enter', 700);
  st = await state(page);
  check(st.screen === 'playing' && st.levelId === 'shift-2', 'shift 2 playing');
  await step(page, 260, 30);
  await shot(page, 'flow-03-hud-shift2');
  await key(page, 'Escape', 600);
  check((await state(page)).screen === 'paused', 'Esc pauses');
  await shot(page, 'flow-04-pause');
  await key(page, 'ArrowDown'); await key(page, 'ArrowDown');
  await key(page, 'Enter', 600);
  check(await topScreen(page) === 'settings', 'pause -> settings');
  for (let i = 0; i < 4; i++) await key(page, 'ArrowLeft', 120); // master 80 -> 60
  for (let i = 0; i < 6; i++) await key(page, 'ArrowDown', 120); // -> blood colour
  check((await focusedText(page) || '').startsWith('Blood colour'), 'settings nav reaches Blood colour');
  await key(page, 'ArrowRight', 300); // green
  await shot(page, 'flow-05-settings-changed');
  await key(page, 'Escape', 500);
  check(await topScreen(page) === 'pause', 'Esc from settings -> pause');
  check((await focusedText(page) || '').startsWith('Settings'), 'pause restores focus to Settings');
  await key(page, 'ArrowDown', 150);
  check((await focusedText(page) || '').startsWith('Quit to menu'), 'focus on Quit to menu');
  await key(page, 'Enter', 500);
  check(await topScreen(page) === 'confirm', 'quit asks for confirmation');
  check((await focusedText(page) || '') === 'Keep working', 'confirm defaults to the safe answer');
  await shot(page, 'flow-06-confirm');
  await key(page, 'ArrowRight', 200);
  await key(page, 'Enter', 800);
  check(await topScreen(page) === 'title', 'quit -> title');
  const sv2 = await save(page);
  check(sv2.settings.master === 0.6 && sv2.settings.bloodColor === 'green', 'settings persisted in save');
  // reload: progress + settings survive
  await page.reload();
  await page.waitForFunction(() => window.__edc && window.__edc.getState, null, { timeout: 90000 });
  await page.evaluate(() => window.__edc.ready);
  const sv3 = await save(page);
  check(sv3.progress.unlocked >= 2 && sv3.settings.master === 0.6 && sv3.settings.bloodColor === 'green', 'progress + settings survive reload');
  check(await page.evaluate(() => document.documentElement.dataset.blood === 'green'), 'blood colour applied at boot');
  await key(page, 'Enter', 600);
  check((await focusedText(page) || '').includes('Shift 2'), 'Clock in now targets shift 2');
  reportErrors(page, 'flow');
  await page.context().close();
}

// =============================================================== overtime (real run to a dry tank)
async function overtime(browser) {
  console.log('\n== overtime run 1280x720');
  const page = await newPage(browser, 1280, 720, { storage: JSON.stringify({ version: 1, progress: { unlocked: 4 }, initials: 'ABC', overtime: [{ liters: 9999, time: 999, initials: 'TOP', date: 'a' }] }) });
  await open(page);
  await key(page, 'Enter', 600);
  await key(page, 'ArrowDown'); await key(page, 'ArrowDown');
  check((await focusedText(page) || '').startsWith('Overtime'), 'Overtime row reachable');
  await key(page, 'Enter', 700);
  check(await topScreen(page) === 'briefing', 'Overtime -> briefing');
  await shot(page, 'ot-01-briefing');
  await key(page, 'Enter', 700);
  check((await state(page)).levelId === 'overtime', 'Overtime running');
  await page.evaluate(() => window.__edc.setTimeScale(0));
  for (let i = 0; i < 80; i++) {
    // a lazy operator: rocks for the first minute (a few litres reach the tank), then gives up
    const st = await page.evaluate((k) => { window.__edc.setInput(k < 12 ? { rotate: k % 2 ? 1 : -1, slam: true } : null); window.__edc.step(300, false); return window.__edc.getState(); }, i);
    if (st.status === 'ended') break;
  }
  await page.waitForFunction(() => window.__edc.getState().screen === 'results', null, { timeout: 240000 });
  await sleep(800);
  check(await topScreen(page) === 'overtime-report', 'tank dry -> Overtime report');
  check((await focusedText(page) || '').replace(/\s/g, '') === 'ABC', 'initials prefilled from last time, focused');
  await key(page, 'KeyZ', 150); await key(page, 'ArrowDown', 150); // Z, then next slot B -> C
  await shot(page, 'ot-02-report-initials');
  await key(page, 'Enter', 400);
  const sv = await save(page);
  const me = sv.overtime.find((e) => e.initials === 'ZCC');
  check(!!me && sv.overtime.length === 2 && sv.overtime[0].initials === 'TOP', `entry signed into the local top-10 (${sv.overtime.map((e) => e.initials).join(',')})`);
  check(sv.initials === 'ZCC', 'initials remembered');
  await shot(page, 'ot-03-report-signed');
  reportErrors(page, 'overtime');
  await page.context().close();
}

// =============================================================== hold-R restart + focus-loss pause
async function misc(browser) {
  console.log('\n== hold-R restart, focus loss, resize 1280x720');
  const page = await newPage(browser, 1280, 720, { storage: '' });
  await open(page, '&autopause=1');
  await key(page, 'Enter', 500); await key(page, 'Enter', 600); await key(page, 'Enter', 600);
  check((await state(page)).screen === 'playing', 'playing shift 1');
  await page.evaluate(() => window.__edc.setTimeScale(0));
  await step(page, 300, 0);
  const t0 = (await state(page)).time;
  await page.keyboard.down('KeyR');
  await page.waitForFunction((t) => window.__edc.getState().time < t, t0, { timeout: 120000 });
  await page.keyboard.up('KeyR');
  check((await state(page)).screen === 'playing', 'hold R restarts the shift (sim clock reset)');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(300);
  check((await state(page)).screen === 'paused', 'window blur auto-pauses');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await sleep(800);
  check((await focusedText(page) || '').startsWith('Resume'), 'resize keeps menu focus');
  await key(page, 'Escape', 500);
  check((await state(page)).screen === 'playing', 'Esc resumes');
  await step(page, 30, 10);
  await shot(page, 'misc-resized-1920');
  reportErrors(page, 'misc');
  await page.context().close();
}

// =============================================================== gamepad
async function pad(browser) {
  console.log('\n== simulated gamepad 1280x800');
  const page = await newPage(browser, 1280, 800, { pad: true, storage: '' });
  await open(page);
  // the pad is polled once per rendered frame: hold until two frames have seen it
  const frames = () => page.evaluate(() => window.__edc.loop.stats.frames);
  const waitFrames = async (n) => { const f0 = await frames(); await page.waitForFunction(([a, k]) => window.__edc.loop.stats.frames >= a + k, [f0, n], { timeout: 240000 }); };
  const press = async (i) => { await page.evaluate((b) => window.__pad.hold(b, true), i); await waitFrames(1); await page.evaluate((b) => window.__pad.hold(b, false), i); await waitFrames(1); };
  await page.evaluate(() => window.__pad.connect());
  await press(0); // A
  check(await topScreen(page) === 'title', 'pad A on boot -> title');
  check(await page.evaluate(() => window.__edc.input.lastDevice) === 'gamepad', 'last device = gamepad');
  check(await page.evaluate(() => !!document.querySelector('.title-scr .glyph.btn')), 'menu shows gamepad glyphs');
  await shot(page, 'pad-01-title');
  for (let i = 0; i < 4; i++) await press(13); // d-pad down x4 -> Settings
  check((await focusedText(page) || '').startsWith('Settings'), 'd-pad reaches Settings');
  await press(0, 600);
  check(await topScreen(page) === 'settings', 'A opens settings');
  await press(15); // right: master +5
  const m = (await save(page)).settings.master;
  check(Math.abs(m - 0.85) < 1e-6, `d-pad right raises master volume (${m})`);
  // left stick down moves focus
  await page.evaluate(() => window.__pad.axis(1, 0.9)); await waitFrames(1); await page.evaluate(() => window.__pad.axis(1, 0)); await waitFrames(1);
  check((await focusedText(page) || '').startsWith('Music'), 'left stick moves focus');
  await shot(page, 'pad-02-settings');
  await press(1); // B
  check(await topScreen(page) === 'title', 'B goes back');
  check((await focusedText(page) || '').startsWith('Settings'), 'B restores focus to Settings');
  for (let i = 0; i < 6 && !(await focusedText(page) || '').startsWith('Shift select'); i++) await press(12); // d-pad up
  await press(0); // shift select
  check(await topScreen(page) === 'shifts', 'A opens shift select');
  await press(0);
  check(await topScreen(page) === 'briefing', 'A on shift 1 -> briefing');
  await press(0);
  check((await state(page)).screen === 'playing', 'A begins the shift');
  await page.evaluate(() => window.__edc.setTimeScale(0));
  await step(page, 120, 20);
  await shot(page, 'pad-03-hud-prompt');
  check(await page.evaluate(() => !!document.querySelector('.prompt .glyph.stick, .prompt .glyph.trig')), 'teaching prompt uses pad glyphs');
  await press(9); // Start
  check((await state(page)).screen === 'paused', 'Start pauses');
  await press(9);
  check((await state(page)).screen === 'playing', 'Start resumes');
  reportErrors(page, 'pad');
  await page.context().close();
}

// =============================================================== corrupted save
async function corrupt(browser) {
  console.log('\n== corrupted save');
  const page = await newPage(browser, 1280, 720, { storage: '{"version":1,"progress":{"unlocked":"lots"' });
  await open(page);
  const sv = await save(page);
  check(sv && sv.progress && sv.progress.unlocked === 1, 'bad JSON -> fresh save');
  check(await page.evaluate(() => !!localStorage.getItem('edc.save.v1.corrupt')), 'corrupt text kept for support');
  await sleep(900);
  check(await page.evaluate(() => !!document.querySelector('.toast')), 'player is told (toast)');
  await shot(page, 'corrupt-toast');
  reportErrors(page, 'corrupt');
  await page.context().close();
  const page2 = await newPage(browser, 1280, 720, { storage: JSON.stringify({ version: 1, progress: { unlocked: 99 }, settings: { master: 'loud', screenShake: true, quality: 'ultra' }, overtime: [{ liters: 'x' }, { liters: 50 }], best: { 'shift-1': { liters: -5, stars: 9 } } }) });
  await open(page2);
  const s2 = await save(page2);
  check(s2.settings.master === 0.8 && s2.settings.screenShake === 'full' && s2.settings.quality === 'auto', 'wrong-typed settings sanitised/migrated');
  check(s2.overtime.length === 1 && s2.best['shift-1'].stars === 3 && s2.best['shift-1'].liters === 0, 'bad entries clamped/dropped');
  reportErrors(page2, 'sanitise');
  await page2.context().close();
}

// =============================================================== every screen at every size
const SEED_SAVE = JSON.stringify({
  version: 1, progress: { unlocked: 4 },
  best: { 'shift-1': { liters: 64.2, stars: 3 }, 'shift-2': { liters: 91.7, stars: 2 }, 'shift-3': { liters: 40, stars: 1 } },
  overtime: [{ liters: 412.6, time: 263, initials: 'KAT', date: '2026-11-12T10:00:00Z' }, { liters: 198.3, time: 141, initials: 'OPR', date: '2026-11-12T11:00:00Z' }],
  achievements: { 'first-drop': 1763000000000 },
  stats: { donorsProcessed: 212, litersTotal: 1823.4, shiftsPlayed: 9, shiftsCompleted: 6, drownings: 7, limbsSevered: 340, slams: 96, overtimeRuns: 2 },
});
async function screens(browser) {
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    console.log(`\n== screens ${tag}`);
    const page = await newPage(browser, w, h, { storage: SEED_SAVE });
    await open(page);
    await sleep(1500);
    await shot(page, `${tag}-01-boot`);
    await key(page, 'Enter', 900);
    await shot(page, `${tag}-02-title`);
    await key(page, 'ArrowDown'); await key(page, 'Enter', 700);
    await shot(page, `${tag}-03-shifts`);
    await key(page, 'ArrowDown'); await key(page, 'Enter', 900);
    await shot(page, `${tag}-04-briefing`);
    await key(page, 'Enter', 600);
    await page.evaluate(() => window.__edc.setTimeScale(0));
    await page.evaluate(() => window.__edc.setInput({ rotate: 1 }));
    await step(page, 200, 0);
    await page.evaluate(() => window.__edc.setInput({ rotate: -1, slam: true }));
    await step(page, 400, 0);
    await page.evaluate(() => window.__edc.setInput(null));
    await step(page, 120, 30);
    // force a few HUD states so the shot shows them
    await page.evaluate(() => { const b = window.__edc.bus; b.emit('pa:announce', { text: 'Partial donations are still donations.', mood: 'calm' }); });
    await step(page, 2, 2);
    await sleep(1400);
    // a live Sponsor Match + callouts right before the shot (they decay within ~3 s)
    await page.evaluate(() => { const sc = window.__edc.sim.ctx.scoring; sc.combo.count = 3; sc.combo.multiplier = 3; sc.combo.timer = 2.2; const b = window.__edc.bus; b.emit('combo', { count: 3, multiplier: 3 }); b.emit('bonus', { liters: 2, reason: 'early-finish' }); b.emit('fine', { liters: 25, reason: 'workplace-incident' }); });
    await sleep(250);
    await shot(page, `${tag}-05-hud`);
    await page.evaluate(() => { window.__edc.bus.emit('pa:announce', { text: 'Please do not let donors drown. It wastes product.', mood: 'urgent' }); });
    await sleep(1600);
    await shot(page, `${tag}-06-hud-urgent`);
    await key(page, 'Escape', 700);
    await shot(page, `${tag}-07-pause`);
    await key(page, 'ArrowDown'); await key(page, 'ArrowDown'); await key(page, 'Enter', 700);
    await shot(page, `${tag}-08-settings`);
    await key(page, 'Escape', 400); await key(page, 'Escape', 600);
    // results (real data from a played shift is covered by the flow test; here a representative report)
    await page.evaluate(() => window.__edc.ui.debug.showResults({ result: 'complete', liters: 96.4, stars: 2, levelId: 'shift-2', levelNumber: 2, collected: 84.1, bonus: 12.3, fines: 0, kills: 21, drownings: 2, bestCombo: 4, time: 130, donorsTotal: 24, causes: { cut: 12, impale: 7, drown: 2 } }, { severs: 37, combos: 6, slams: 31 }));
    await sleep(3200);
    await shot(page, `${tag}-09-results`);
    await page.evaluate(() => window.__edc.ui.debug.showOvertime({ result: 'failed', liters: 287.5, time: 214, kills: 63, mode: 'overtime' }, { rank: 1, entry: { liters: 287.5, time: 214, initials: 'OPR', date: 'x' }, qualifies: true }));
    await sleep(900);
    await shot(page, `${tag}-10-overtime-report`);
    await page.evaluate(() => window.__edc.ui.debug.toTitle());
    await sleep(500);
    await page.evaluate(() => window.__edc.ui.debug.open('records'));
    await sleep(700);
    await shot(page, `${tag}-11-records`);
    await key(page, 'Escape', 400);
    await page.evaluate(() => window.__edc.ui.debug.open('credits'));
    await sleep(700);
    await shot(page, `${tag}-12-credits`);
    await key(page, 'Escape', 400);
    await page.evaluate(() => window.__edc.ui.debug.toast({ title: 'Commendation', name: 'Orientation Complete', kind: 'ach', ms: 120000 }));
    await shot(page, `${tag}-13-toast`);
    // Overtime HUD
    await page.evaluate(() => { window.__edc.startOvertime(); window.__edc.setTimeScale(0); window.__edc.setInput({ rotate: 0.6 }); });
    await step(page, 1800, 0);
    await page.evaluate(() => window.__edc.setInput(null));
    await step(page, 60, 30);
    await sleep(600);
    await shot(page, `${tag}-14-hud-overtime`);
    // Inspector shift (5): briefing + HUD
    await page.evaluate(() => window.__edc.ui.debug.toTitle());
    await sleep(300);
    await page.evaluate(() => window.__edc.ui.debug.brief(5));
    await sleep(900);
    await shot(page, `${tag}-15-briefing-5`);
    await key(page, 'Enter', 600);
    await page.evaluate(() => window.__edc.setTimeScale(0));
    await step(page, 400, 30);
    await sleep(1500);
    await shot(page, `${tag}-16-hud-inspector`);
    // last 10 seconds
    await page.evaluate(() => { const m = window.__edc.sim.ctx.mode; m.clock.t = m.clock.duration - 7.6; });
    await step(page, 2, 2);
    await sleep(900);
    await shot(page, `${tag}-17-hud-last10`);
    // ending sting
    page.evaluate(() => window.__edc.ui.debug.playEnding()).catch(() => {});
    await sleep(4200);
    await shot(page, `${tag}-18-ending-pa`);
    await page.waitForFunction(() => document.querySelector('.ending.dropping'), null, { timeout: 60000 });
    await sleep(1800);
    await shot(page, `${tag}-19-ending-drop`);
    reportErrors(page, tag);
    await page.context().close();
  }
}

// =============================================================== extras: callouts, toast, ending drop
async function extras(browser) {
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    console.log(`\n== extras ${tag}`);
    const page = await newPage(browser, w, h, { storage: SEED_SAVE });
    await open(page, '&autostart=2');
    await page.evaluate(() => window.__edc.setTimeScale(0));
    await page.evaluate(() => window.__edc.setInput({ rotate: 1 }));
    await step(page, 150, 0);
    await page.evaluate(() => window.__edc.setInput({ rotate: -1, slam: true }));
    await step(page, 300, 0);
    await page.evaluate(() => window.__edc.setInput(null));
    await step(page, 60, 20);
    // keep the short-lived callouts on screen for the (slow) software screenshot
    await page.evaluate(() => {
      window.__realSetTimeout = window.setTimeout;
      window.setTimeout = (f, ms, ...a) => (ms >= 1000 ? 0 : window.__realSetTimeout(f, ms, ...a));
      const sc = window.__edc.sim.ctx.scoring; sc.combo.count = 4; sc.combo.multiplier = 4; sc.combo.timer = 1.6;
      const b = window.__edc.bus;
      b.emit('combo', { count: 4, multiplier: 4 });
      b.emit('bonus', { liters: 20, reason: 'inspector-survived' });
      b.emit('fine', { liters: 25, reason: 'workplace-incident' });
      b.emit('achievement', { id: 'SPONSOR_MATCH_8' });
      b.emit('pa:announce', { text: 'The tank is nearly full. Please remain calm and productive.', mood: 'glitch' });
    });
    await sleep(2500);
    await shot(page, `${tag}-20-hud-callouts`);
    await page.evaluate(() => { window.setTimeout = window.__realSetTimeout; });
    check(await page.evaluate(() => document.querySelectorAll('.feed-row').length >= 2), `${tag}: bonus/fine callouts shown`);
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('edc.save.v1')).achievements.SPONSOR_MATCH_8 > 0), `${tag}: achievement event persisted`);
    // let the CSS camera push-in actually animate (screens otherwise run with animations off)
    await page.evaluate(() => { window.__edcHoldEnding = true; for (const st of document.querySelectorAll('style')) if (st.textContent.includes('animation:none!important')) st.remove(); });
    page.evaluate(() => window.__edc.ui.debug.playEnding()).catch(() => {});
    await page.waitForFunction(() => document.querySelector('.ending.dropping'), null, { timeout: 120000 });
    await sleep(4500);
    await shot(page, `${tag}-19-ending-drop`);
    await page.evaluate(() => { window.__edcHoldEnding = false; });
    reportErrors(page, `extras ${tag}`);
    await page.context().close();
  }
}

// =============================================================== fix pass 2 evidence (--only fix2)
// briefings 1/3/5/7 (lesson + "new this shift"), HUD prompt placement, drowning popup, Overtime
// demand tier, report headlines at 1 and 3 drops, settings order. Names: fix2-ui-<size>-<what>.png
async function fix2(browser) {
  for (const [w, h] of SIZES) {
    const tag = `fix2-ui-${w}x${h}`;
    console.log(`\n== fix2 ${tag}`);
    const page = await newPage(browser, w, h, { storage: JSON.stringify({ ...JSON.parse(SEED_SAVE), progress: { unlocked: 9 } }) });
    await open(page);
    await key(page, 'Enter', 600);
    await shot(page, `${tag}-title`);
    for (const n of [1, 3, 5, 7]) {
      await page.evaluate(() => window.__edc.ui.debug.toTitle());
      await sleep(300);
      await page.evaluate((k) => window.__edc.ui.debug.brief(k), n);
      await sleep(900);
      check(await page.evaluate(() => !document.querySelector('.brief-tip').hidden && document.querySelector('.tip-t').textContent.length > 10), `${tag}: briefing ${n} shows the lesson`);
      check(await page.evaluate(() => { const p = document.querySelector('.brief .side-panel'); return p.scrollHeight <= p.clientHeight + 1; }), `${tag}: briefing ${n} fits the panel`);
      await shot(page, `${tag}-briefing-${n}`);
    }
    // shift 1 HUD: the rotate prompt sits above the drum, not on the spike bed
    await page.evaluate(() => window.__edc.ui.debug.toTitle());
    await sleep(300);
    await page.evaluate(() => window.__edc.ui.debug.brief(1));
    await sleep(600);
    await key(page, 'Enter', 600);
    await page.evaluate(() => window.__edc.setTimeScale(0));
    await step(page, 150, 30);
    // the prompt waits ~1.2 s of real frames (clamped dt; software WebGL renders ~1 frame/s)
    await page.waitForFunction(() => !document.querySelector('.prompt').hidden, null, { timeout: 120000 }).catch(() => {});
    check(await page.evaluate(() => { const p = document.querySelector('.prompt'); return !p.hidden && p.getBoundingClientRect().bottom < window.innerHeight * 0.2; }), `${tag}: rotate prompt shown in the top band`);
    // a drowning popup over a live donor
    await page.evaluate(() => {
      const d = window.__edc.sim.ctx.donors.find((x) => x.alive && x.parts && x.parts.head);
      if (d) { const hd = d.parts.head; window.__edc.bus.emit('donor:drowning', { id: d.id, x: hd.x, y: hd.y, z: hd.z, pan: 0, wasted: 2.4 }); }
    });
    await step(page, 30, 30);
    await shot(page, `${tag}-hud-shift1-prompt`);
    // Overtime HUD: jump the clock so the demand tier is > 1
    await page.evaluate(() => { window.__edc.startOvertime(); window.__edc.setTimeScale(0); window.__edc.setInput({ rotate: 0.6 }); });
    await step(page, 600, 0);
    await page.evaluate(() => { window.__edc.setInput(null); const m = window.__edc.sim.ctx.mode; m.clock.t = 150; });
    await step(page, 6, 6);
    await sleep(600);
    const dm = await page.evaluate(() => document.querySelector('.demand').innerText.replace(/\s+/g, ' '));
    console.log(`  demand: ${dm}`);
    check(/Tier [2-9]/.test(dm), `${tag}: Overtime demand shows a tier above 1 after 150 s`);
    await shot(page, `${tag}-hud-overtime`);
    // reports at 1 and 3 drops
    await page.evaluate(() => window.__edc.ui.debug.showResults({ result: 'complete', liters: 7.1, stars: 1, levelId: 'shift-1', levelNumber: 1, collected: 7.1, bonus: 0, fines: 0, kills: 1, drownings: 0, bestCombo: 0, time: 105, donorsTotal: 15, causes: { impact: 1 }, report: { title: 'Meets expectations.', lines: ['Litres collected: 7.1', 'Drownings: 0. Exemplary.', 'Complaints received: 0 (donors unavailable for comment)', 'Cookies distributed: 0'] } }));
    await sleep(3200);
    check(await page.evaluate(() => document.querySelector('.headline').textContent) === 'Quota met.', `${tag}: 1 drop reads "Quota met."`);
    check(await page.evaluate(() => !/Exemplary/.test(document.querySelector('.stat-lines').textContent)), `${tag}: no "Exemplary" with 1 donor processed`);
    await shot(page, `${tag}-report-1drop`);
    await page.evaluate(() => window.__edc.ui.debug.showResults({ result: 'complete', liters: 58.3, stars: 3, levelId: 'shift-1', levelNumber: 1, collected: 52.1, bonus: 6.2, fines: 0, kills: 14, drownings: 0, bestCombo: 4, time: 92, donorsTotal: 15, causes: { impale: 9, cut: 5 } }, { combos: 3, slams: 12 }));
    await sleep(3200);
    check(await page.evaluate(() => document.querySelector('.headline').textContent) === 'Operator of the Shift.', `${tag}: 3 drops reads "Operator of the Shift."`);
    await shot(page, `${tag}-report-3drops`);
    await page.evaluate(() => window.__edc.ui.debug.toTitle());
    await sleep(300);
    await page.evaluate(() => window.__edc.ui.debug.open('settings'));
    await sleep(700);
    check(await page.evaluate(() => [...document.querySelectorAll('.setting[data-key="quality"] .seg-o')].map((o) => o.dataset.v).join(',')) === 'low,medium,high,auto', `${tag}: quality order Low, Medium, High, Auto`);
    await shot(page, `${tag}-settings`);
    reportErrors(page, tag);
    await page.context().close();
  }
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  if (ONLY === 'fix2') await fix2(browser);
  if (!ONLY || ONLY === 'flow') await flow(browser);
  if (!ONLY || ONLY === 'pad') await pad(browser);
  if (!ONLY || ONLY === 'overtime') await overtime(browser);
  if (!ONLY || ONLY === 'misc') await misc(browser);
  if (!ONLY || ONLY === 'corrupt') await corrupt(browser);
  if (!ONLY || ONLY === 'screens') await screens(browser);
  if (!ONLY || ONLY === 'extras') await extras(browser);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join('\n  ')}` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
