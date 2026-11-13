#!/usr/bin/env node
/**
 * Composes the Steam capsules / library art from in-game renders + the title set in the game's own
 * bundled font (Nunito, @fontsource-variable, OFL). No downloaded art. Renders each asset as an HTML
 * page in Chrome at the exact pixel size and screenshots it.
 *   node tools/local/compose-capsules.mjs <sourcesDir> <outDir>
 * sourcesDir needs: hero.png (wide clean render, >= 3840 px), key.png (clean 16:9 render, the
 * main key art), tall.png (clean render for portrait crops), icon.png (square-ish crop source).
 * Each spec: { file, w, h, src, pos (CSS object-position), title: 'stack'|'line'|null, align }.
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import { ROOT } from './lib.mjs';

const [srcDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
mkdirSync(outDir, { recursive: true });
const font = pathToFileURL(resolve(ROOT, 'node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2')).href;
const img = (n) => `data:image/png;base64,${readFileSync(resolve(srcDir, n)).toString('base64')}`;

// Title: white heavy type with the ink outline the HUD uses; the one red thing is the drop (red = blood only)
const DROP = (size) => `<svg width="${size * 0.62}" height="${size * 0.86}" viewBox="0 0 62 86" style="display:inline-block;vertical-align:-0.06em;margin:0 0.02em"><path d="M31 2 C31 2 4 38 4 56 a27 27 0 0 0 54 0 C58 38 31 2 31 2Z" fill="#c4001f" stroke="#1b3a33" stroke-width="5"/><ellipse cx="21" cy="55" rx="5" ry="9" fill="#ff6b78" opacity=".55"/></svg>`;
function title(kind, size) {
  const st = `font-family:Nunito;font-weight:1000;color:#fff;line-height:0.86;letter-spacing:-0.01em;-webkit-text-stroke:${Math.max(2, size * 0.09)}px #1b3a33;paint-order:stroke fill;text-shadow:0 ${size * 0.06}px ${size * 0.14}px rgba(0,0,0,.55)`;
  if (kind === 'stack') return `<div style="${st};font-size:${size}px;text-transform:uppercase">EVERY<br>${DROP(size)}DROP<br>COUNTS</div>`;
  return `<div style="${st};font-size:${size}px;text-transform:uppercase;white-space:nowrap">EVERY ${DROP(size)}DROP COUNTS</div>`;
}
const SPECS = [
  { file: 'header_capsule_920x430.png', w: 920, h: 430, src: 'key.png', pos: '50% 55%', title: 'line', size: 74, place: 'left:40px;bottom:34px' },
  { file: 'small_capsule_462x174.png', w: 462, h: 174, src: 'key.png', pos: '50% 50%', title: 'stack', size: 46, place: 'left:22px;top:18px', dim: 0.25 },
  { file: 'main_capsule_1232x706.png', w: 1232, h: 706, src: 'key.png', pos: '50% 50%', title: 'line', size: 98, place: 'left:56px;bottom:50px' },
  { file: 'vertical_capsule_748x896.png', w: 748, h: 896, src: 'tall.png', pos: '50% 50%', title: 'stack', size: 118, place: 'left:48px;top:44px' },
  { file: 'library_capsule_600x900.png', w: 600, h: 900, src: 'tall.png', pos: '50% 50%', title: 'stack', size: 104, place: 'left:40px;top:44px' },
  { file: 'library_header_920x430.png', w: 920, h: 430, src: 'key.png', pos: '50% 55%', title: 'line', size: 74, place: 'left:40px;bottom:34px' },
  { file: 'library_hero_3840x1240.png', w: 3840, h: 1240, src: 'hero.png', pos: '50% 50%', title: null },
  { file: 'page_background_1438x810.png', w: 1438, h: 810, src: 'key.png', pos: '50% 50%', title: null, ambient: true },
  { file: 'event_cover_800x450.png', w: 800, h: 450, src: 'key.png', pos: '50% 50%', title: 'line', size: 64, place: 'left:34px;bottom:30px' },
  { file: 'library_logo_1280x720.png', w: 1280, h: 720, src: null, title: 'stack', size: 210, place: 'left:50%;top:50%;transform:translate(-50%,-50%);text-align:left', transparent: true },
  { file: 'shortcut_icon_256x256.png', w: 256, h: 256, src: 'icon.png', pos: '50% 50%', title: null, icon: true },
  { file: 'app_icon_184x184.png', w: 184, h: 184, src: 'icon.png', pos: '50% 50%', title: null, icon: true },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
for (const s of SPECS) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: s.w, height: s.h });
  const bg = s.src ? `<img src="${img(s.src)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${s.pos};${s.ambient ? 'filter:blur(14px) saturate(.75) brightness(.55);transform:scale(1.06)' : ''}">` : '';
  // soft ink vignette under the title keeps it legible on any render (Valve: logotype must be legible)
  const shade = s.title && s.src ? `<div style="position:absolute;inset:0;background:radial-gradient(120% 90% at ${s.title === 'stack' ? '20% 15%' : '25% 95%'}, rgba(10,25,22,${0.62 + (s.dim || 0)}) 0%, rgba(10,25,22,0) 60%)"></div>` : '';
  const ttl = s.title ? `<div style="position:absolute;${s.place}">${title(s.title, s.size)}</div>` : '';
  await page.setContent(`<!doctype html><html><head><style>@font-face{font-family:Nunito;src:url(${font}) format('woff2');font-weight:200 1000}html,body{margin:0;width:${s.w}px;height:${s.h}px;overflow:hidden;background:${s.transparent ? 'transparent' : '#1b3a33'}}</style></head><body>${bg}${shade}${ttl}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(outDir, s.file), omitBackground: !!s.transparent });
  await page.close();
  console.log('wrote', s.file);
}
await browser.close();
