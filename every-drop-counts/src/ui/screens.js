/**
 * Menu screens (boot splash, title, shift select, briefing card, pause, settings, records, credits,
 * confirm dialogs). Visual grammar: laminated hospital wayfinding signs — each choice is a sign row
 * with a pictogram tile, a label and an arrow; the focused row flips to mint like a lit sign.
 *
 *   const screens = createScreens(app);  // app = the shell in index.js (actions + state)
 *   screens.title / .shifts / .briefing / .pause / .settings / .records / .credits / .boot
 *   screens.confirm({ text, yes, no, danger }) -> Promise<boolean>
 * Each screen: { name, el, layout, refresh?(), ...nav hooks } (see nav.js)
 */
import { icon, logoMark } from './icons.js';
import { esc, h, fmtL, fmtClock, pad2, onActivate } from './dom.js';
import { getSave, updateSave, SETTING_CHOICES } from '../core/save.js';
import { LICENSES } from './licenses.js';
import {
  BRAND, BRAND_SUB, GAME, MENU, SHIFT_SELECT, PAUSE, SETTINGS, RECORDS, CREDITS, BRIEFINGS, QUIT, OVERTIME, TOTAL_SHIFTS,
} from './copy.js';

const rowHtml = ({ ico, title, sub = '', disabled = false, cls = '', arrow = true, extra = '' }) => `
  <button type="button" class="row ${cls}" data-focus ${disabled ? 'aria-disabled="true"' : ''}>
    <span class="row-ico">${icon(disabled ? 'lock' : ico)}</span>
    <span class="row-main"><span class="row-t">${esc(title)}</span>${sub ? `<span class="row-s">${esc(sub)}</span>` : ''}</span>
    ${extra}
    ${arrow ? `<span class="row-arrow">${icon('arrow')}</span>` : ''}
  </button>`;

const hints = (list) => `<footer class="hints">${list.map(([g, t, act]) => `<span class="hint${act ? ' hint-btn' : ''}" ${act ? `data-act="${act}"` : ''}><span data-glyph="${g}"></span>${esc(t)}</span>`).join('')}</footer>`;

const brandHtml = () => `<header class="brand">${logoMark()}<div class="brand-txt"><b>${BRAND}</b><span>${BRAND_SUB}</span></div></header>`;

const dropsHtml = (n, cls = '') => `<span class="drops ${cls}" aria-label="${n} of 3 drops">${[0, 1, 2].map((i) => `<span class="d ${i < n ? 'on' : ''}">${icon(i < n ? 'drop' : 'dropOutline')}</span>`).join('')}</span>`;

export function createScreens(app) {
  const layer = app.layer;
  const add = (el) => { el.setAttribute('inert', ''); layer.appendChild(el); return el; };
  const bindHints = (el) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.hint-btn');
      if (!b || !el.contains(b)) return;
      const act = b.dataset.act;
      if (act === 'back') { app.bus.emit('ui:back', {}); app.back(); }
      if (act === 'confirm') app.nav.handle('confirm', null, {});
    });
  };

  // ---------------------------------------------------------------- boot splash
  const boot = {
    name: 'boot', layout: 'boot',
    el: add(h(`<section class="scr boot" aria-label="${esc(GAME)}">
      <div class="boot-card">
        ${logoMark('xl')}
        <div class="boot-brand"><b>${BRAND}</b><span>${BRAND_SUB}</span></div>
        <h1 class="game-title center">Every Drop<br>Counts</h1>
        <div class="boot-press"><span data-glyph="confirm"></span><span>${MENU.pressAny}</span></div>
      </div>
      <div class="boot-foot">${esc(MENU.terminal)} · v<span class="ver"></span></div>
    </section>`)),
    onKey(action, info) { if (info && info.repeat) return true; if (['confirm', 'back', 'pause', 'up', 'down', 'left', 'right', 'restart'].includes(action)) { app.leaveBoot(); return true; } return false; },
  };
  boot.el.querySelector('.ver').textContent = app.version;
  boot.el.addEventListener('pointerdown', () => { if (app.nav.top === boot) app.leaveBoot(); });

  // ---------------------------------------------------------------- title
  const title = {
    name: 'title', layout: 'side', wrap: true,
    el: add(h(`<section class="scr side title-scr" aria-label="Main menu">
      <div class="side-panel">
        ${brandHtml()}
        <h1 class="game-title">Every Drop<br>Counts</h1>
        <nav class="menu"></nav>
        <div class="side-foot">${hints([['confirm', MENU.select, 'confirm']])}<span class="ver-line">${esc(MENU.terminal)} · v${esc(app.version)}</span></div>
      </div>
    </section>`)),
    refresh() {
      const save = getSave();
      const cin = app.clockInTarget();
      const otLock = !app.overtimeUnlocked();
      const rows = [
        rowHtml({ ico: 'play', title: MENU.clockIn, sub: cin ? `Shift ${cin.number} · ${cin.name}` : '', cls: 'primary', extra: '' }),
        rowHtml({ ico: 'list', title: MENU.shifts, sub: `${Object.values(save.best).filter((b) => b.stars > 0).length} of ${TOTAL_SHIFTS} filed` }),
        rowHtml({ ico: 'pump', title: MENU.overtime, sub: otLock ? MENU.overtimeLocked(app.overtimeRequirement()) : (save.overtime[0] ? `Best ${fmtL(save.overtime[0].liters)} L` : 'Endless'), disabled: otLock }),
        rowHtml({ ico: 'rosette', title: MENU.records, sub: app.recordsSub() }),
        rowHtml({ ico: 'gear', title: MENU.settings }),
        rowHtml({ ico: 'clipboard', title: MENU.credits }),
      ];
      if (app.isDesktop) rows.push(rowHtml({ ico: 'door', title: MENU.quit, arrow: false, cls: 'quiet' }));
      const menu = title.el.querySelector('.menu');
      menu.innerHTML = rows.join('');
      const [cIn, sh, ot, rec, set, cred, quit] = menu.children;
      onActivate(cIn, () => app.clockIn());
      onActivate(sh, () => app.openShifts());
      onActivate(ot, () => app.openOvertime());
      onActivate(rec, () => app.openRecords());
      onActivate(set, () => app.openSettings());
      onActivate(cred, () => app.openCredits());
      if (quit) onActivate(quit, () => app.quitGame());
      title.focus = cIn;
      app.refreshGlyphs(title.el);
    },
    onBack() { if (app.isDesktop) app.quitGame(); },
  };
  bindHints(title.el);

  // ---------------------------------------------------------------- shift select
  const shifts = {
    name: 'shifts', layout: 'side', wrap: true,
    el: add(h(`<section class="scr side shifts-scr" aria-label="${esc(SHIFT_SELECT.heading)}">
      <div class="side-panel">
        <header class="side-head"><span class="head-ico">${icon('list')}</span><div><h2>${esc(SHIFT_SELECT.heading)}</h2><p>${esc(SHIFT_SELECT.sub)}</p></div></header>
        <nav class="menu shift-list"></nav>
        <div class="side-foot">${hints([['confirm', MENU.select, 'confirm'], ['back', MENU.back, 'back']])}</div>
      </div>
    </section>`)),
    refresh() {
      const save = getSave();
      const list = shifts.el.querySelector('.shift-list');
      const levels = app.levels();
      const byNum = new Map(levels.map((l) => [l.number, l]));
      const max = Math.max(TOTAL_SHIFTS, ...levels.map((l) => l.number));
      let html = '';
      for (let n = 1; n <= max; n++) {
        const lv = byNum.get(n);
        const unlocked = !!lv && n <= save.progress.unlocked;
        const best = lv && save.best[lv.id];
        const name = lv ? lv.name : app.fallbackName(n);
        const sub = !lv ? SHIFT_SELECT.soon : !unlocked ? SHIFT_SELECT.locked : best && best.stars > 0 ? SHIFT_SELECT.best(fmtL(best.liters)) : SHIFT_SELECT.noBest;
        html += `<button type="button" class="row shift-row ${unlocked ? '' : 'locked'}" data-focus data-n="${n}" ${unlocked ? '' : 'aria-disabled="true"'}>
          <span class="row-num num">${unlocked ? pad2(n) : icon('lock')}</span>
          <span class="row-main"><span class="row-t">${esc(name)}</span><span class="row-s">${esc(sub)}</span></span>
          ${unlocked ? dropsHtml(best ? best.stars : 0, 'small') : ''}
        </button>`;
      }
      list.innerHTML = html;
      let focusEl = null;
      for (const b of list.children) {
        const n = Number(b.dataset.n);
        onActivate(b, () => app.selectShift(n));
        if (n === app.lastShiftNumber()) focusEl = b;
      }
      shifts.focus = focusEl || list.children[0];
      app.refreshGlyphs(shifts.el);
    },
    onBack() { app.back(); },
  };
  bindHints(shifts.el);

  // ---------------------------------------------------------------- briefing card
  const briefing = {
    name: 'briefing', layout: 'side',
    el: add(h(`<section class="scr side brief" aria-label="Briefing">
      <div class="side-panel">
        ${brandHtml()}
        <div class="brief-ico"></div>
        <div class="brief-kicker"></div>
        <h2 class="brief-name"></h2>
        <p class="brief-text"></p>
        <div class="brief-meta"></div>
        <div class="brief-actions">
          <button type="button" class="btn primary" data-focus><span data-glyph="confirm"></span><span class="btn-t"></span></button>
          <span class="hint hint-btn" data-act="back"><span data-glyph="back"></span>${esc(MENU.back)}</span>
        </div>
      </div>
    </section>`)),
    show(info) {
      // info: { kicker, name, text, icon, quota?, duration?, overtime? }
      const e = briefing.el;
      e.querySelector('.brief-ico').innerHTML = icon(info.icon || 'drop');
      e.querySelector('.brief-kicker').textContent = info.kicker;
      e.querySelector('.brief-name').textContent = info.name;
      e.querySelector('.brief-text').textContent = info.text;
      const meta = e.querySelector('.brief-meta');
      if (info.quota) {
        meta.innerHTML = `<span class="meta-quota">${info.quota.map((q, i) => `<span class="q">${dropsHtml(i + 1, 'tiny')}<b class="num">${Math.round(q)}</b><i>L</i></span>`).join('')}</span>
          <span class="meta-time">${icon('clock')}<b class="num">${fmtClock(info.duration)}</b></span>
          ${info.best ? `<span class="meta-best">${icon('rosette')}Your best <b class="num">${fmtL(info.best.liters)} L</b>${dropsHtml(info.best.stars, 'tiny')}</span>` : ''}`;
      } else meta.innerHTML = info.metaHtml || '';
      const btn = e.querySelector('.btn');
      btn.querySelector('.btn-t').textContent = info.overtime ? MENU.beginOvertime : MENU.begin;
      onActivate(btn, () => app.beginShift());
      briefing.focus = btn;
      app.refreshGlyphs(e);
    },
    onBack() { app.back(); },
    onPause() { app.back(); },
  };
  bindHints(briefing.el);

  // ---------------------------------------------------------------- pause
  const pause = {
    name: 'pause', layout: 'side', wrap: true,
    el: add(h(`<section class="scr side pause-scr" aria-label="${esc(PAUSE.heading)}">
      <div class="side-panel">
        <header class="side-head"><span class="head-ico">${icon('pause')}</span><div><h2>${esc(PAUSE.heading)}</h2><p class="pause-sub"></p></div></header>
        <div class="pause-stats"></div>
        <nav class="menu"></nav>
        <p class="side-note">${esc(PAUSE.sub)}</p>
        <div class="side-foot">${hints([['confirm', MENU.select, 'confirm'], ['back', MENU.resume, 'back']])}</div>
      </div>
    </section>`)),
    refresh() {
      const run = app.run;
      const s = app.snapshot() || {};
      pause.el.querySelector('.pause-sub').textContent = run.overtime ? MENU.overtime : `Shift ${run.level.number} · ${run.level.name}`;
      pause.el.querySelector('.pause-stats').innerHTML = `
        <div class="pstat"><span>${run.overtime ? 'Delivered' : 'Collected'}</span><b class="num blood">${fmtL(s.liters)} L</b></div>
        <div class="pstat"><span>${run.overtime ? 'On shift' : 'Time left'}</span><b class="num">${fmtClock(run.overtime ? (s.clock && s.clock.t) : (s.clock && s.clock.left))}</b></div>`;
      const menu = pause.el.querySelector('.menu');
      menu.innerHTML = [
        rowHtml({ ico: 'play', title: MENU.resume, cls: 'primary' }),
        rowHtml({ ico: 'restart', title: run.overtime ? MENU.restartOvertime : MENU.restart, sub: '' }),
        rowHtml({ ico: 'gear', title: MENU.settings }),
        rowHtml({ ico: 'door', title: MENU.quitToMenu, arrow: false, cls: 'quiet' }),
      ].join('');
      const [res, rst, set, quit] = menu.children;
      onActivate(res, () => app.resume());
      onActivate(rst, () => app.restart());
      onActivate(set, () => app.openSettings());
      onActivate(quit, async () => { if (await confirm({ text: PAUSE.quitConfirm, yes: PAUSE.quitYes, no: PAUSE.quitNo })) app.quitToMenu(); });
      pause.focus = res;
      app.refreshGlyphs(pause.el);
    },
    onBack() { app.resume(); },
    onPause() { app.resume(); },
  };
  bindHints(pause.el);

  // ---------------------------------------------------------------- settings
  const SCHEMA = [
    { section: 'audio' },
    { key: 'master', type: 'slider' }, { key: 'music', type: 'slider' }, { key: 'sfx', type: 'slider' },
    { section: 'display' },
    { key: 'fullscreen', type: 'toggle' }, { key: 'quality', type: 'choice' },
    { section: 'comfort' },
    { key: 'screenShake', type: 'choice' }, { key: 'bloodColor', type: 'choice' },
    { key: 'reduceFlashing', type: 'toggle' }, { key: 'speechBubbles', type: 'toggle' },
    { section: 'data' },
    { key: 'reset', type: 'action' },
  ];
  const settings = {
    name: 'settings', layout: 'side wide', wrap: true,
    el: add(h(`<section class="scr side wide settings-scr" aria-label="${esc(SETTINGS.heading)}">
      <div class="side-panel">
        <header class="side-head"><span class="head-ico">${icon('gear')}</span><div><h2>${esc(SETTINGS.heading)}</h2><p>Saved automatically.</p></div></header>
        <div class="settings-list scroll"></div>
        <p class="help-line" aria-live="polite"></p>
        <div class="side-foot">${hints([['adjust', MENU.adjust], ['back', MENU.back, 'back']])}</div>
      </div>
    </section>`)),
    refresh() {
      const list = settings.el.querySelector('.settings-list');
      list.innerHTML = '';
      for (const item of SCHEMA) {
        if (item.section) { list.appendChild(h(`<div class="sect"><span>${esc(SETTINGS.sections[item.section])}</span></div>`)); continue; }
        const rowEl = h(`<div class="row setting" data-focus tabindex="0" data-key="${item.key}" data-type="${item.type}">
          <span class="set-label">${esc(SETTINGS[item.key])}</span><span class="set-ctl"></span></div>`);
        list.appendChild(rowEl);
        renderSetting(rowEl, item);
      }
      settings.focus = list.querySelector('[data-focus]');
      app.refreshGlyphs(settings.el);
    },
    onFocus(el) {
      const k = el && el.dataset.key;
      settings.el.querySelector('.help-line').textContent = (k && SETTINGS.help[k]) || '';
    },
    onBack() { app.back(); },
  };
  bindHints(settings.el);

  function renderSetting(rowEl, item) {
    const s = getSave().settings;
    const ctl = rowEl.querySelector('.set-ctl');
    const k = item.key;
    const commit = (v) => {
      if (s[k] === v) return;
      updateSave((x) => { x.settings[k] = v; });
      app.applySetting(k);
      renderSetting(rowEl, item);
      app.bus.emit('ui:hover', {});
    };
    if (item.type === 'slider') {
      const v = s[k];
      ctl.innerHTML = `<span class="slider"><span class="slider-track"><span class="slider-fill" style="width:${Math.round(v * 100)}%"></span></span><b class="slider-v num">${Math.round(v * 100)}</b></span>`;
      rowEl.__adjust = (d) => commit(Math.round(Math.max(0, Math.min(1, s[k] + d * 0.05)) * 100) / 100);
      rowEl.__activate = () => {};
      rowEl.dataset.silent = '1';
      const track = ctl.querySelector('.slider-track');
      track.onpointerdown = (e) => {
        const set = (ev) => { const r = track.getBoundingClientRect(); commit(Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * 20) / 20); };
        set(e);
        const move = (ev) => set(ev);
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };
    } else if (item.type === 'toggle') {
      const v = !!s[k];
      ctl.innerHTML = `<span class="seg two"><span class="seg-o ${!v ? 'on' : ''}" data-v="0">${esc(SETTINGS.values.off)}</span><span class="seg-o ${v ? 'on' : ''}" data-v="1">${icon('check', 'seg-check')}${esc(SETTINGS.values.on)}</span></span>`;
      const set = async (nv) => {
        if (k === 'fullscreen') {
          const actual = await app.setFullscreen(nv);
          updateSave((x) => { x.settings.fullscreen = actual; });
          renderSetting(rowEl, item);
          app.bus.emit('ui:hover', {});
          return;
        }
        commit(nv);
      };
      rowEl.__adjust = (d) => set(d > 0);
      rowEl.__activate = () => set(!getSave().settings[k]);
      for (const o of ctl.querySelectorAll('.seg-o')) o.onclick = (e) => { e.stopPropagation(); set(o.dataset.v === '1'); };
    } else if (item.type === 'choice') {
      const opts = SETTING_CHOICES[k];
      const labels = SETTINGS.values[k];
      ctl.innerHTML = `<span class="seg n${opts.length}">${opts.map((o) => `<span class="seg-o ${s[k] === o ? 'on' : ''}" data-v="${o}">${s[k] === o ? icon('check', 'seg-check') : ''}${esc(labels[o])}</span>`).join('')}</span>`;
      const idx = () => opts.indexOf(getSave().settings[k]);
      rowEl.__adjust = (d) => { const i = Math.max(0, Math.min(opts.length - 1, idx() + d)); commit(opts[i]); };
      rowEl.__activate = () => commit(opts[(idx() + 1) % opts.length]);
      for (const o of ctl.querySelectorAll('.seg-o')) o.onclick = (e) => { e.stopPropagation(); commit(o.dataset.v); };
    } else if (item.type === 'action') {
      ctl.innerHTML = `<span class="act-btn">${icon('warning')}${esc(SETTINGS.reset)}</span>`;
      rowEl.querySelector('.set-label').textContent = 'Progress';
      rowEl.__activate = async () => {
        if (await confirm({ text: SETTINGS.resetConfirm, yes: SETTINGS.resetYes, no: SETTINGS.resetNo, danger: true })) {
          app.resetProgress();
          app.toast({ title: SETTINGS.resetDone, kind: 'info' });
        }
      };
    }
    if (app.nav.focused === rowEl) settings.onFocus(rowEl);
  }

  // ---------------------------------------------------------------- records
  const records = {
    name: 'records', layout: 'sheet',
    el: add(h(`<section class="scr sheet records-scr" aria-label="${esc(RECORDS.heading)}">
      <div class="sheet-card">
        <header class="sheet-head">${logoMark('sm')}<h2>${esc(RECORDS.heading)}</h2><span class="sheet-kicker">${BRAND}</span></header>
        <div class="sheet-body cols">
          <div class="col"><h3>${esc(RECORDS.achievements)} <span class="count num"></span></h3><div class="ach-list scroll"></div></div>
          <div class="col narrow"><h3>${esc(RECORDS.lifetime)}</h3><dl class="life"></dl>
            <h3>${esc(OVERTIME.table)}</h3><ol class="ot-table"></ol></div>
        </div>
        <div class="sheet-foot">${hints([['back', MENU.back, 'back']])}</div>
      </div>
    </section>`)),
    refresh() {
      const save = getSave();
      const defs = app.achievements();
      const list = records.el.querySelector('.ach-list');
      const got = Object.keys(save.achievements);
      records.el.querySelector('.count').textContent = defs.length ? `${defs.filter((d) => save.achievements[d.id]).length} / ${defs.length}` : (got.length ? String(got.length) : '');
      const items = defs.length ? defs : got.map((id) => app.achievementDef(id));
      if (!items.length) list.innerHTML = `<p class="empty">${esc(RECORDS.none)}</p>`;
      else {
        list.innerHTML = items.map((d) => {
          const on = !!save.achievements[d.id];
          const secret = d.hidden && !on;
          return `<div class="ach ${on ? 'on' : ''}" data-focus tabindex="0">
            <span class="ach-ico">${icon('rosette')}</span>
            <span class="ach-main"><b>${esc(secret ? RECORDS.hidden : d.name)}</b><span>${esc(secret ? RECORDS.locked : (d.description || (on ? '' : RECORDS.locked)))}</span></span>
            <span class="ach-state">${on ? `${icon('check')}<span>${new Date(save.achievements[d.id]).toLocaleDateString()}</span>` : ''}</span>
          </div>`;
        }).join('');
      }
      const st = save.stats;
      records.el.querySelector('.life').innerHTML = Object.entries(RECORDS.stats).map(([k, label]) => `<div><dt>${esc(label)}</dt><dd class="num ${k === 'litersTotal' ? 'blood' : ''}">${k === 'litersTotal' ? `${fmtL(st[k])} L` : Math.round(st[k] || 0)}</dd></div>`).join('');
      records.el.querySelector('.ot-table').innerHTML = overtimeRows(save.overtime, null);
      // make lifetime column reachable by pad when the list is short: focus the first item
      records.focus = list.querySelector('[data-focus]');
      app.refreshGlyphs(records.el);
    },
    onBack() { app.back(); },
  };
  bindHints(records.el);

  // ---------------------------------------------------------------- credits
  const credits = {
    name: 'credits', layout: 'sheet',
    el: add(h(`<section class="scr sheet credits-scr" aria-label="${esc(CREDITS.heading)}">
      <div class="sheet-card">
        <header class="sheet-head">${logoMark('sm')}<h2>${esc(CREDITS.heading)}</h2><span class="sheet-kicker">${esc(GAME)}</span></header>
        <div class="sheet-body cols">
          <div class="col narrow credits-col">
            <dl class="credit-lines">${CREDITS.lines.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
            <p class="thanks">${esc(CREDITS.thanks)}</p>
            <p class="fine-print">${esc(CREDITS.disclaimer)}</p>
          </div>
          <div class="col">
            <h3>${esc(CREDITS.licences)}</h3>
            <div class="lic-wrap">
              <div class="lic-list">${LICENSES.map((l, i) => `<button type="button" class="lic" data-focus data-i="${i}"><b>${esc(l.name)}</b><span>${esc(l.version)} · ${esc(l.license)}${l.purpose ? ` · ${esc(l.purpose)}` : ''}</span></button>`).join('')}</div>
              <pre class="lic-text scroll" data-focus tabindex="0"></pre>
            </div>
          </div>
        </div>
        <div class="sheet-foot">${hints([['move', MENU.move], ['back', MENU.back, 'back']])}</div>
      </div>
    </section>`)),
    refresh() {
      credits.showLicence(0);
      credits.focus = credits.el.querySelector('.lic');
      app.refreshGlyphs(credits.el);
    },
    showLicence(i) {
      const l = LICENSES[i];
      const pre = credits.el.querySelector('.lic-text');
      pre.textContent = l ? (l.text || `${l.name} is licensed under ${l.license}.`) : '';
      pre.scrollTop = 0;
      credits.el.querySelectorAll('.lic').forEach((b) => b.classList.toggle('sel', Number(b.dataset.i) === i));
    },
    onFocus(el) { if (el.classList.contains('lic')) credits.showLicence(Number(el.dataset.i)); },
    onKey(action) {
      const f = app.nav.focused;
      if (f && f.classList.contains('lic-text') && (action === 'up' || action === 'down')) {
        const top = f.scrollTop;
        f.scrollTop += (action === 'down' ? 1 : -1) * f.clientHeight * 0.35;
        if (action === 'up' && top <= 0) return false; // let focus leave upward
        return true;
      }
      return false;
    },
    onBack() { app.back(); },
  };
  for (const b of credits.el.querySelectorAll('.lic')) onActivate(b, () => { credits.showLicence(Number(b.dataset.i)); app.nav.setFocus(credits.el.querySelector('.lic-text')); });
  onActivate(credits.el.querySelector('.lic-text'), () => {});
  bindHints(credits.el);

  // ---------------------------------------------------------------- confirm dialog
  const dialog = {
    name: 'confirm', layout: 'modal',
    el: add(h(`<section class="scr modal" role="dialog" aria-modal="true">
      <div class="modal-card">
        <span class="modal-ico">${icon('warning')}</span>
        <p class="modal-text"></p>
        <div class="modal-btns"><button type="button" class="btn no" data-focus></button><button type="button" class="btn yes" data-focus></button></div>
      </div>
    </section>`)),
    resolve: null,
    onBack() { finish(false); },
    onPause() { finish(false); },
  };
  function finish(v) {
    const r = dialog.resolve;
    dialog.resolve = null;
    if (app.nav.top === dialog) app.nav.pop();
    if (r) r(v);
  }
  function confirm({ text, yes, no, danger = false }) {
    return new Promise((resolve) => {
      if (dialog.resolve) dialog.resolve(false);
      dialog.resolve = resolve;
      dialog.el.querySelector('.modal-text').textContent = text;
      const y = dialog.el.querySelector('.yes'); const n = dialog.el.querySelector('.no');
      y.textContent = yes; n.textContent = no;
      y.classList.toggle('danger', !!danger);
      onActivate(y, () => finish(true));
      onActivate(n, () => finish(false));
      dialog.focus = n; // dangerous choices default to the safe answer
      app.nav.push(dialog, { keepBelow: true });
    });
  }

  return { boot, title, shifts, briefing, pause, settings, records, credits, dialog, confirm, quitConfirm: () => confirm({ text: QUIT.confirm, yes: QUIT.yes, no: QUIT.no }) };
}

export function overtimeRows(table, highlight) {
  if (!table || !table.length) return `<li class="empty">${esc(OVERTIME.empty)}</li>`;
  return table.map((e, i) => `<li class="${e === highlight ? 'me' : ''}"><span class="rk num">${pad2(i + 1)}</span><span class="ini">${esc(e.initials || 'OPR')}</span><span class="lt num">${fmtL(e.liters)} L</span><span class="tm num">${fmtClock(e.time)}</span></li>`).join('');
}

export { dropsHtml, rowHtml, hints, brandHtml, BRIEFINGS };
