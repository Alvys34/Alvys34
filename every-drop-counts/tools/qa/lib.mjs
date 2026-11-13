// QA helpers (playtest harness). Read-only on the game: drives window.__edc only.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const { chromium } = createRequire(import.meta.url)('playwright');
export const PORT = process.env.QA_PORT || '5179';
export const BASE = `http://localhost:${PORT}/`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const OUT = resolve(ROOT, 'docs/qa/img');
export const RAW = resolve(ROOT, 'docs/qa/raw');
mkdirSync(OUT, { recursive: true }); mkdirSync(RAW, { recursive: true });

export async function launch() {
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}
export async function newPage(browser, w = 1280, h = 720, { storage = '', pad = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  if (storage !== null) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); if (s === '') localStorage.clear(); else localStorage.setItem('edc.save.v1', s); } }, storage);
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  const errs = []; const warns = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e)));
  page.errs = errs; page.warns = warns;
  return page;
}
export async function open(page, query = '') {
  await page.goto(`${BASE}?debug=1&seed=1${query}`);
  await page.waitForFunction(() => window.__edc && window.__edc.getState, null, { timeout: 120000 });
  await page.evaluate(() => window.__edc.ready);
  await page.evaluate(() => document.fonts && document.fonts.ready);
}
export const noAnim = (page) => page.addStyleTag({ content: '*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation-duration:0s!important;animation-delay:0s!important}' });
export const state = (page) => page.evaluate(() => window.__edc.getState());
export async function key(page, k, wait = 300) { await page.keyboard.press(k); await sleep(wait); }
export async function shot(page, name, dir = OUT) {
  const file = resolve(dir, `${name}.png`);
  await page.screenshot({ path: file, timeout: 240000 });
  return file;
}
export const topScreen = (page) => page.evaluate(() => (window.__edc.ui.nav.top ? window.__edc.ui.nav.top.name : null));
export const focusedText = (page) => page.evaluate(() => { const f = window.__edc.ui.nav.focused; return f ? f.innerText.replace(/\s+/g, ' ').trim() : null; });
export const visibleText = (page) => page.evaluate(() => document.querySelector('.edc-ui').innerText.replace(/\n{2,}/g, '\n').trim());
/** record bus events into window.__qaEv */
export const tapBus = (page) => page.evaluate(() => {
  window.__qaEv = [];
  const types = ['shift:start','shift:end','wave:incoming','hatch:open','donor:spawn','donor:death','limb:sever','limb:break','blood:spurt','splash','hazard:contact','hazard:telegraph','grinder:clog','grinder:clear','slam','slam:ready','combo','bonus','fine','prop:puncture','prop:explode','sphere:crack','sphere:shatter','pa:announce','timer:warning','game:pause','achievement','ui:star','ending:start','donor:speak','impact','donor:hurt'];
  for (const t of types) window.__edc.bus.on(t, (p) => { window.__qaEv.push({ type: t, t: p && p.t, simT: window.__edc.sim.state && window.__edc.sim.state.time, p: JSON.parse(JSON.stringify(p || {}, (k, v) => (k === 'pos' ? undefined : v))) }); });
});
export const save = (file, obj) => writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1));
