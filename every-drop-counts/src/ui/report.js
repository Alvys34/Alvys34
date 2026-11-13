/**
 * End-of-run screens: the shift report (results), the Overtime report (+ initials for the local
 * top-10) and the shift-8 ending sting.
 *
 *   const reports = createReports(app);
 *   reports.results.show(r, opts)  // r = shift:end payload, opts = { level, prev, isBest, hasNext, isFinal, extras, unlockNote }
 *   reports.overtime.show(r, opts) // opts = { rank, entry, qualifies }
 *   reports.ending.play()          // -> Promise (resolves when the sting is over / skipped)
 */
import { icon, logoMark } from './icons.js';
import { esc, h, fmtL, fmtClock, pad2, onActivate } from './dom.js';
import { getSave, setOvertimeInitials } from '../core/save.js';
import { RESULTS, RESULT_HEADLINES, STAT_LINES, MENU, OVERTIME, ENDING } from './copy.js';
import { hints, overtimeRows } from './screens.js';

const ease = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DUP = /^(litres collected|litres delivered|sponsor contributions|fines|time on the clock)\b/i;
/** CONTENT's report lines (sim/modes/report.js) as { k, v }, minus what the breakdown already shows. */
function contentLines(r) {
  const lines = r && r.report && Array.isArray(r.report.lines) ? r.report.lines : null;
  if (!lines) return null;
  return lines.filter((t) => typeof t === 'string' && !DUP.test(t)).map((t) => {
    const i = t.indexOf(': ');
    return i > 0 ? { k: t.slice(0, i), v: t.slice(i + 2) } : { k: t, v: '' };
  });
}

export function chooseStatLines(r, x, max = 7) {
  const fromContent = contentLines(r);
  if (fromContent && fromContent.length) {
    const head = r.kills != null ? [{ k: 'Donors processed', v: `${r.kills}${r.donorsTotal ? ` / ${r.donorsTotal}` : ''}` }] : [];
    const body = fromContent.filter((l) => !/^donors processed/i.test(l.k));
    // keep the closing deadpan lines (last two) and trim from the middle if needed
    const room = Math.max(2, max - head.length);
    const out = body.length > room ? [...body.slice(0, room - 2), ...body.slice(-2)] : body;
    return [...head, ...out];
  }
  const all = STAT_LINES.map((f) => { try { return f(r, x || {}); } catch { return null; } }).filter(Boolean);
  const always = all.filter((l) => l.always && !l.tail);
  const tail = all.filter((l) => l.tail);
  const rest = all.filter((l) => !l.always).sort((a, b) => (b.w || 0) - (a.w || 0));
  const room = Math.max(0, max - always.length - tail.length);
  return [...always, ...rest.slice(0, room), ...tail];
}

export function createReports(app) {
  const add = (el) => { el.setAttribute('inert', ''); app.layer.appendChild(el); return el; };
  const bindHints = (el) => el.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.hint-btn');
    if (b && el.contains(b) && b.dataset.act === 'back') { app.bus.emit('ui:back', {}); app.back(); }
  });

  // ================================================================ shift report
  const results = {
    name: 'results', layout: 'sheet report-layout',
    el: add(h(`<section class="scr sheet results-scr" aria-label="${esc(RESULTS.heading)}">
      <div class="sheet-card report">
        <header class="sheet-head">${logoMark('sm')}<h2>${esc(RESULTS.heading)}</h2><span class="sheet-kicker r-kicker"></span></header>
        <div class="sheet-body cols">
          <div class="col report-main">
            <p class="headline"></p>
            <div class="total"><span class="total-l">${esc(RESULTS.total)}</span><span class="total-row"><b class="total-n num blood">0.0</b><span class="total-u">L</span></span></div>
            <div class="r-gauge"><div class="r-marks"></div><div class="r-track"><div class="r-fill"></div></div></div>
            <dl class="breakdown"></dl>
            <div class="stamps"></div>
          </div>
          <div class="col">
            <dl class="stat-lines"></dl>
          </div>
        </div>
        <div class="sheet-foot"><div class="btn-row"></div>${hints([['confirm', MENU.select]])}</div>
      </div>
    </section>`)),
    anim: null,
    show(r, o) {
      const e = results.el;
      const lv = o.level;
      e.querySelector('.r-kicker').textContent = lv ? `Shift ${pad2(lv.number)} · ${lv.name}` : '';
      const head = r.result === 'complete'
        ? ((r.report && r.report.title) || RESULT_HEADLINES[Math.max(1, r.stars)])
        : (RESULT_HEADLINES[r.result] || RESULT_HEADLINES.timeout);
      e.querySelector('.headline').textContent = head;
      e.querySelector('.headline').dataset.state = r.stars > 0 ? 'ok' : 'miss';
      const quota = (lv && lv.quota) || [1, 2, 3];
      const max = Math.max(quota[2] * 1.12, r.liters * 1.02, 1);
      e.querySelector('.r-marks').innerHTML = quota.map((q, i) => `<div class="r-mark" data-i="${i}" style="left:${(q / max) * 100}%">
        <span class="r-drop">${icon('drop', 'm-full')}${icon('dropOutline', 'm-empty')}</span><span class="num">${Math.round(q)} L</span></div>`).join('');
      e.querySelector('.breakdown').innerHTML = `
        <div><dt>${esc(RESULTS.collected)}</dt><dd class="num">${fmtL(r.collected ?? r.liters)} L</dd></div>
        <div><dt>${esc(RESULTS.bonus)}</dt><dd class="num">+${fmtL(r.bonus || 0)} L</dd></div>
        <div><dt>${esc(RESULTS.fines)}</dt><dd class="num">${r.fines ? '−' : ''}${fmtL(r.fines || 0)} L</dd></div>`;
      const lines = chooseStatLines(r, o.extras || {});
      e.querySelector('.stat-lines').innerHTML = lines.map((l) => `<div class="sl"><dt>${esc(l.k)}</dt><dd>${esc(l.v)}</dd></div>`).join('');
      const stamps = e.querySelector('.stamps');
      stamps.innerHTML = '';
      const stampList = [];
      if (o.isBest) stampList.push(o.prev ? RESULTS.newBest : RESULTS.firstReport);
      if (o.unlockNote) stampList.push(o.unlockNote);
      for (const s of o.extraNotes || []) stampList.push(s);
      stamps.innerHTML = stampList.map((s, i) => `<span class="stamp ${i === 0 && o.isBest ? 'best' : ''}">${i === 0 && o.isBest ? icon('rosette') : icon('check')}${esc(s)}</span>`).join('');
      // buttons
      const row = e.querySelector('.btn-row');
      const btns = [];
      if (o.isFinal && r.stars > 0) btns.push(['clockOut', MENU.clockOut, 'door']);
      else if (o.hasNext) btns.push(['next', MENU.next, 'arrow']);
      btns.push(['retry', MENU.retry, 'restart']);
      btns.push(['menu', MENU.menu, 'list']);
      row.innerHTML = btns.map(([k, t, ic], i) => `<button type="button" class="btn ${i === 0 ? 'primary' : ''}" data-focus data-k="${k}">${icon(ic)}<span>${esc(t)}</span></button>`).join('');
      for (const b of row.children) {
        onActivate(b, () => {
          results.finishAnim();
          const k = b.dataset.k;
          if (k === 'next') app.nextShift();
          else if (k === 'retry') app.retry();
          else if (k === 'menu') app.toShiftSelect();
          else if (k === 'clockOut') app.playEnding();
        });
      }
      results.focus = row.children[0];
      app.refreshGlyphs(e);
      results.startAnim(r, quota, max);
    },
    startAnim(r, quota, max) {
      const e = results.el;
      const totalN = e.querySelector('.total-n');
      const fill = e.querySelector('.r-fill');
      const marks = [...e.querySelectorAll('.r-mark')];
      const stamps = e.querySelector('.stamps');
      stamps.classList.remove('in');
      marks.forEach((m) => m.classList.remove('got', 'pop'));
      const target = r.liters;
      const dur = 700 + Math.min(1300, target * 12);
      let lit = 0;
      const t0 = performance.now() + 250;
      const st = { done: false };
      const step = (now) => {
        if (st.done) return;
        const k = ease((now - t0) / dur);
        const v = target * k;
        totalN.textContent = fmtL(v);
        fill.style.width = `${Math.min(100, (v / max) * 100)}%`;
        while (lit < 3 && r.stars > lit && v >= quota[lit] - 1e-6) {
          marks[lit].classList.add('got', 'pop');
          lit++;
          app.bus.emit('ui:star', { n: lit });
        }
        if (k >= 1) { st.done = true; stamps.classList.add('in'); return; }
        requestAnimationFrame(step);
      };
      st.finish = () => {
        if (st.done) return;
        st.done = true;
        totalN.textContent = fmtL(target);
        fill.style.width = `${Math.min(100, (target / max) * 100)}%`;
        for (let i = 0; i < 3; i++) if (r.stars > i) marks[i].classList.add('got');
        if (r.stars > lit) app.bus.emit('ui:star', { n: r.stars });
        stamps.classList.add('in');
      };
      results.anim = st;
      requestAnimationFrame(step);
    },
    finishAnim() { if (results.anim) results.anim.finish(); },
    onConfirm() {
      // first press completes the count-up instead of picking a button
      if (results.anim && !results.anim.done) { results.anim.finish(); return true; }
      return false;
    },
    onBack() { results.finishAnim(); app.toShiftSelect(); },
  };

  // ================================================================ overtime report
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const ot = {
    name: 'overtime-report', layout: 'sheet report-layout',
    el: add(h(`<section class="scr sheet ot-scr" aria-label="${esc(OVERTIME.heading)}">
      <div class="sheet-card report">
        <header class="sheet-head">${logoMark('sm')}<h2>${esc(OVERTIME.heading)}</h2><span class="sheet-kicker">${esc(OVERTIME.dry)}</span></header>
        <div class="sheet-body cols">
          <div class="col report-main">
            <div class="total"><span class="total-l">${esc(OVERTIME.delivered)}</span><span class="total-row"><b class="total-n num blood">0.0</b><span class="total-u">L</span></span></div>
            <dl class="breakdown ot-break"></dl>
            <dl class="stat-lines ot-lines"></dl>
            <div class="initials-box" hidden>
              <p class="ini-label">${esc(OVERTIME.enterHint)}</p>
              <div class="ini-row">
                <div class="initials" data-focus tabindex="0" data-silent="1"><span class="slot"></span><span class="slot"></span><span class="slot"></span></div>
                <button type="button" class="btn sign" data-focus>${icon('check')}<span>${esc(OVERTIME.confirm)}</span></button>
              </div>
              <p class="ini-hint"><span data-glyph="move"></span>Letter <span data-glyph="adjust"></span>Slot</p>
            </div>
            <p class="rank-line"></p>
          </div>
          <div class="col narrow">
            <h3>${esc(OVERTIME.table)}</h3>
            <ol class="ot-table"></ol>
            <p class="fine-print">${esc(OVERTIME.local)}</p>
          </div>
        </div>
        <div class="sheet-foot"><div class="btn-row"></div>${hints([['confirm', MENU.select]])}</div>
      </div>
    </section>`)),
    state: null,
    show(r, o) {
      const e = ot.el;
      e.querySelector('.total-n').textContent = fmtL(r.liters);
      const otLines = contentLines(r);
      e.querySelector('.ot-lines').innerHTML = (otLines || []).slice(0, 5).map((l) => `<div class="sl"><dt>${esc(l.k)}</dt><dd>${esc(l.v)}</dd></div>`).join('');
      e.querySelector('.ot-break').innerHTML = `
        <div><dt>${esc(OVERTIME.survived)}</dt><dd class="num">${fmtClock(r.time)}</dd></div>
        <div><dt>Donors processed</dt><dd class="num">${r.kills ?? 0}</dd></div>
        <div><dt>Waves</dt><dd class="num">${r.waves ?? '—'}</dd></div>`;
      const save = getSave();
      ot.state = { entry: o.entry, letters: (o.entry ? o.entry.initials : save.initials).split(''), slot: 0, signed: !o.qualifies };
      const box = e.querySelector('.initials-box');
      box.hidden = !o.qualifies;
      e.querySelector('.rank-line').textContent = o.rank >= 0 ? OVERTIME.rank(o.rank + 1) : OVERTIME.noRank;
      e.querySelector('.ot-table').innerHTML = overtimeRows(getSave().overtime, o.entry);
      const row = e.querySelector('.btn-row');
      row.innerHTML = [['retry', MENU.retry, 'restart'], ['menu', MENU.title, 'arrowBack']].map(([k, t, ic], i) => `<button type="button" class="btn ${i === 0 ? 'primary' : ''}" data-focus data-k="${k}">${icon(ic)}<span>${esc(t)}</span></button>`).join('');
      for (const b of row.children) onActivate(b, () => { ot.sign(); if (b.dataset.k === 'retry') app.retry(); else app.toTitle(); });
      const ini = e.querySelector('.initials');
      ini.__adjust = (d) => { ot.state.slot = (ot.state.slot + d + 3) % 3; ot.renderInitials(); app.bus.emit('ui:hover', {}); };
      ini.__activate = () => { ot.sign(); app.nav.setFocus(row.children[0]); };
      onActivate(e.querySelector('.sign'), () => { ot.sign(); app.nav.setFocus(row.children[0]); });
      ot.renderInitials();
      ot.focus = o.qualifies ? ini : row.children[0];
      app.refreshGlyphs(e);
    },
    renderInitials() {
      const slots = ot.el.querySelectorAll('.initials .slot');
      slots.forEach((s, i) => { s.textContent = ot.state.letters[i]; s.classList.toggle('cur', i === ot.state.slot && !ot.state.signed); });
      ot.el.querySelector('.initials-box').classList.toggle('signed', ot.state.signed);
    },
    cycle(d) {
      const st = ot.state;
      const i = ALPHA.indexOf(st.letters[st.slot]);
      st.letters[st.slot] = ALPHA[(i + d + ALPHA.length) % ALPHA.length];
      ot.renderInitials();
      app.bus.emit('ui:hover', {});
    },
    sign() {
      const st = ot.state;
      if (!st || st.signed) return;
      st.signed = true;
      if (st.entry) setOvertimeInitials(st.entry, st.letters.join(''));
      ot.el.querySelector('.ot-table').innerHTML = overtimeRows(getSave().overtime, getSave().overtime.find((x) => x.date === st.entry.date) || null);
      ot.renderInitials();
    },
    onKey(action, info, ev) {
      const f = app.nav.focused;
      if (!f || !f.classList.contains('initials') || ot.state.signed) return false;
      if (ev && ev.code && /^(Key[A-Z]|Digit[0-9])$/.test(ev.code) && !['confirm', 'back'].includes(action)) {
        const ch = ev.code.slice(-1);
        ot.state.letters[ot.state.slot] = ch;
        ot.state.slot = Math.min(2, ot.state.slot + 1);
        ot.renderInitials();
        app.bus.emit('ui:hover', {});
        return true;
      }
      if (action === 'up') { ot.cycle(-1); return true; }
      if (action === 'down') { ot.cycle(1); return true; }
      return false;
    },
    onBack() { ot.sign(); app.toTitle(); },
  };
  // typed letters that are not nav keys (e.g. 'B', 'Z') never reach input.onPress: listen directly
  window.addEventListener('keydown', (ev) => {
    if (app.nav.top !== ot || ev.repeat) return;
    if (!/^(Key[A-Z]|Digit[0-9])$/.test(ev.code)) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyP', 'KeyR', 'KeyQ', 'KeyE'].includes(ev.code)) return; // routed via onKey
    const f = app.nav.focused;
    if (f && f.classList.contains('initials') && !ot.state.signed) ot.onKey('type', {}, ev);
  });

  // ================================================================ ending sting (shift 8)
  const ending = {
    name: 'ending', layout: 'ending',
    el: add(h(`<section class="scr ending" aria-label="Ending">
      <div class="end-pa"><span class="pa-ico">${icon('speaker')}</span><p class="end-line"></p></div>
      <div class="end-skip"><span data-glyph="confirm"></span>${esc(ENDING.skip)}</div>
    </section>`)),
    token: null,
    async play() {
      const tok = { skip: false };
      ending.token = tok;
      const line = ending.el.querySelector('.end-line');
      const wait = async (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (tok.skip) return false; await sleep(50); } return true; };
      app.refreshGlyphs(ending.el);
      ending.el.classList.remove('dropping', 'dark');
      line.textContent = '';
      if (!(await wait(1400))) return;
      for (const text of ENDING.lines) {
        app.bus.emit('pa:announce', { text, mood: 'calm' });
        line.classList.remove('in');
        line.textContent = '';
        await sleep(30);
        line.classList.add('in');
        for (let i = 1; i <= text.length; i++) { if (tok.skip) return; line.textContent = text.slice(0, i); await sleep(42); }
        if (!(await wait(1700))) return;
      }
      if (!(await wait(600))) return;
      line.classList.remove('in');
      ending.el.classList.add('dropping');
      app.dropCamera();
      if (!(await wait(3600))) return;
      ending.el.classList.add('dark');
      await wait(1400);
    },
    skip() { if (ending.token) ending.token.skip = true; },
    onConfirm() { ending.skip(); return true; },
    onBack() { ending.skip(); },
    onPause() { ending.skip(); },
  };

  bindHints(results.el);
  bindHints(ot.el);
  return { results, overtime: ot, ending };
}
