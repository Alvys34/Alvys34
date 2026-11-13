/**
 * In-play HUD. Corners only (the drum owns the centre of the screen):
 *   top-left     tank plate: litres counter, tank gauge with the three drop thresholds, next-drop line
 *                + bonus / fine callouts underneath
 *   top-right    clock plate: shift name, shift clock (urgent in the last 10 s), donors left, next intake
 *   right        Sponsor Match stamp with multiplier + decay bar
 *   bottom-right SLAM dial (big filled disc when ready: readable in peripheral vision)
 *   bottom-left  PA ticker (calm / urgent / glitch; glitches more as the tank fills)
 *   bottom-centre one-line teaching prompt / hold-to-restart ring
 * Overtime swaps the tank plate to tank volume + demand (drain) and the clock to time survived.
 *
 *   const hud = createHud({ root, bus, getSettings });
 *   hud.reset(level, mode); hud.update(snapshot, live, realDt); hud.setVisible(bool)
 */
import { icon } from './icons.js';
import { HUD, reasonLabel } from './copy.js';

const fmtTime = (s) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const fmtUp = (s) => { const t = Math.max(0, Math.floor(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
/** meter-style litres: always 3 integer digits, leading zeros dimmed (no layout shift as it grows) */
const odometer = (v) => { const t = Math.max(0, v).toFixed(1); const p = t.padStart(5, '0'); const lead = p.length - t.length; return lead > 0 ? `<span class="lz">${p.slice(0, lead)}</span>${t}` : t; };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createHud({ root, bus, getSettings }) {
  const el = document.createElement('div');
  el.className = 'hud';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <section class="plate tank-plate">
      <div class="plate-label"><span class="tank-label">${HUD.liters}</span><span class="tank-sub"></span></div>
      <div class="liters"><span class="liters-n num"><span class="lz">00</span>0.0</span><span class="liters-u">L</span></div>
      <div class="gauge">
        <div class="gauge-marks"></div>
        <div class="gauge-track"><div class="gauge-fill"></div><div class="gauge-low"></div></div>
      </div>
      <div class="gauge-next"></div>
    </section>
    <div class="feed"></div>
    <section class="plate clock-plate">
      <div class="plate-label shift-name"></div>
      <div class="clock num">0:00</div>
      <div class="clock-meta">
        <span class="meta donors-meta">${icon('donor')}<b class="donors-n num">0</b><span class="meta-l">${HUD.donorsLeft}</span></span>
        <span class="meta intake-meta">${icon('hatch')}<span class="intake-t num"></span></span>
      </div>
      <div class="clock-extra"></div>
    </section>
    <div class="combo" hidden>
      <div class="combo-label">${HUD.combo}</div>
      <div class="combo-x num">×2</div>
      <div class="combo-bar"><i></i></div>
    </div>
    <div class="slam-dial">
      <svg class="slam-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-bg" cx="50" cy="50" r="44"/><circle class="ring-fg" cx="50" cy="50" r="44" pathLength="100"/></svg>
      <div class="slam-core">${icon('piston')}</div>
      <div class="slam-cap"><span class="slam-word">${HUD.slam}</span><span data-glyph="slam"></span></div>
    </div>
    <div class="pa" hidden>
      <span class="pa-ico">${icon('speaker')}</span>
      <span class="pa-text"></span>
    </div>
    <div class="prompt" hidden><span class="prompt-glyph"></span><span class="prompt-text"></span></div>
    <div class="restart-ring" hidden>
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-bg" cx="50" cy="50" r="40"/><circle class="ring-fg" cx="50" cy="50" r="40" pathLength="100"/></svg>
      <span>${HUD.restarting}</span>
    </div>`;
  root.appendChild(el);

  const q = (s) => el.querySelector(s);
  const tankPlate = q('.tank-plate'); const tankLabel = q('.tank-label'); const tankSub = q('.tank-sub');
  const litersN = q('.liters-n'); const litersBox = q('.liters');
  const marks = q('.gauge-marks'); const fill = q('.gauge-fill'); const lowMark = q('.gauge-low'); const nextLine = q('.gauge-next');
  const feed = q('.feed');
  const clockPlate = q('.clock-plate'); const shiftName = q('.shift-name'); const clock = q('.clock');
  const donorsN = q('.donors-n'); const intakeMeta = q('.intake-meta'); const intakeT = q('.intake-t'); const clockExtra = q('.clock-extra');
  const combo = q('.combo'); const comboX = q('.combo-x'); const comboBar = q('.combo-bar > i');
  const dial = q('.slam-dial'); const dialRing = q('.slam-ring .ring-fg');
  const pa = q('.pa'); const paText = q('.pa-text');
  const prompt = q('.prompt'); const promptGlyph = q('.prompt-glyph'); const promptText = q('.prompt-text');
  const restart = q('.restart-ring'); const restartRing = q('.restart-ring .ring-fg');

  const cache = {};
  const set = (key, node, value, prop = 'textContent') => { if (cache[key] !== value) { cache[key] = value; node[prop] = value; } };
  const cls = (key, node, name, on) => { const k = `${key}:${name}`; if (cache[k] !== on) { cache[k] = on; node.classList.toggle(name, on); } };
  const bump = (node, name = 'bump') => { node.classList.remove(name); void node.offsetWidth; node.classList.add(name); };

  let level = null; let mode = 'shift';
  let shownLiters = 0; let lastLiters = 0;
  let gaugeMax = 1; let quotaKey = '';
  let starsLit = 0;
  let paTimer = 0; let paFull = ''; let paShown = 0; let paMood = 'calm'; let paGlitchT = 0;
  let incomingT = 0; let incomingN = 0;
  let comboT = 0; let comboShownMult = 0;
  let lastClockSec = -1;
  let fillLevel = 0;
  let overtimeStart = 25;

  function reset(lv, m) {
    level = lv; mode = m || 'shift';
    shownLiters = 0; lastLiters = 0; starsLit = 0; quotaKey = '';
    paTimer = 0; pa.hidden = true; incomingT = 0; comboT = 0; combo.hidden = true; comboShownMult = 0;
    lastClockSec = -1; fillLevel = 0;
    feed.textContent = '';
    for (const k of Object.keys(cache)) delete cache[k];
    el.dataset.mode = mode;
    el.classList.remove('urgent');
    clockPlate.classList.remove('urgent', 'warn');
    if (mode === 'overtime') {
      tankLabel.textContent = HUD.tank;
      shiftName.textContent = HUD.overtime;
      overtimeStart = (lv && lv.overtime && lv.overtime.startVolume) || 25;
      marks.textContent = '';
    } else {
      tankLabel.textContent = HUD.liters;
      shiftName.textContent = lv ? `Shift ${lv.number} · ${lv.name}` : '';
    }
    tankSub.textContent = '';
    lowMark.hidden = mode !== 'overtime';
    setPrompt(null);
    setRestart(0);
  }

  function buildMarks(quota) {
    gaugeMax = Math.max(1, (quota[2] || 1) * 1.12);
    marks.innerHTML = quota.map((v, i) => `<div class="mark" data-i="${i}" style="left:${(v / gaugeMax) * 100}%">
      <span class="mark-drop">${icon('drop', 'm-full')}${icon('dropOutline', 'm-empty')}</span><span class="mark-v num">${Math.round(v)}</span></div>`).join('');
  }

  // ---------------- bus-driven widgets ----------------
  function pushFeed(text, amount, kind) {
    const row = document.createElement('div');
    row.className = `feed-row ${kind}`;
    row.innerHTML = `<span class="feed-amt num">${amount}</span><span class="feed-why"></span>`;
    row.querySelector('.feed-why').textContent = text;
    feed.prepend(row);
    while (feed.children.length > 4) feed.lastChild.remove();
    setTimeout(() => row.classList.add('out'), 2600);
    setTimeout(() => row.remove(), 3200);
  }

  function showPa(text, mood) {
    paFull = String(text || '');
    paMood = mood || 'calm';
    paShown = 0;
    paTimer = Math.max(4.5, paFull.length * 0.075 + 2.5);
    pa.hidden = false;
    pa.dataset.mood = paMood;
    bump(pa, 'enter');
  }

  const offs = [
    bus.on('bonus', (p) => {
      if (p.reason === 'sponsor-match') return; // shown on the combo stamp instead
      pushFeed(reasonLabel(p.reason), `+${(+p.liters).toFixed(1)} L`, 'bonus');
    }),
    bus.on('fine', (p) => { pushFeed(reasonLabel(p.reason), `−${(+p.liters).toFixed(1)} L`, 'fine'); bump(tankPlate, 'shake'); }),
    bus.on('combo', (p) => {
      combo.hidden = false;
      comboT = 1;
      comboX.textContent = `×${p.multiplier}`;
      combo.dataset.tier = p.multiplier >= 6 ? '3' : p.multiplier >= 4 ? '2' : '1';
      bump(combo, 'pop');
      comboShownMult = p.multiplier;
    }),
    bus.on('pa:announce', (p) => showPa(p.text, p.mood)),
    bus.on('wave:incoming', (p) => { incomingT = 2.6; incomingN = p.count || 0; }),
    bus.on('slam', () => bump(dial, 'punch')),
    bus.on('slam:ready', () => { if (!(getSettings().reduceFlashing)) bump(dial, 'ready-pop'); }),
    bus.on('timer:warning', (p) => { if (p.secondsLeft === 30) bump(clockPlate, 'warn'); }),
  ];

  // ---------------- per-frame ----------------
  function glitchText(s, g, t) {
    if (g <= 0.01) return s;
    const blocks = '▒░▓_#';
    let out = '';
    let seed = Math.floor(t * 9) * 7919;
    for (let i = 0; i < s.length; i++) {
      seed = (seed * 1103515245 + 12345 + i * 31) & 0x7fffffff;
      const r = (seed % 1000) / 1000;
      const ch = s[i];
      if (ch !== ' ' && r < g * 0.22) out += blocks[seed % blocks.length];
      else if (ch !== ' ' && r < g * 0.3) out += ch + ch;
      else out += ch;
    }
    return out;
  }

  function update(s, live, dt) {
    if (!s) return;
    const settings = getSettings();
    const reduce = !!settings.reduceFlashing;
    fillLevel = s.fill || 0;

    // ---- litres / tank ----
    if (mode === 'overtime') {
      const vol = Math.max(0, s.poolVolume || 0);
      const cap = (live && live.pool ? live.pool.capacity : 140) * ((live && live.T && live.T.pool.maxFill) || 0.82);
      shownLiters += (vol - shownLiters) * Math.min(1, dt * 10);
      set('ln', litersN, odometer(shownLiters), 'innerHTML');
      const pct = Math.min(100, (vol / Math.max(1, cap)) * 100);
      set('fill', fill.style, `${pct}%`, 'width');
      const lowAt = Math.max(5, overtimeStart * 0.35);
      set('low', lowMark.style, `${(lowAt / Math.max(1, cap)) * 100}%`, 'left');
      const low = vol < lowAt && s.clock && s.clock.t > 3;
      cls('tank', tankPlate, 'low', low);
      const drain = live && live.mode ? live.mode.drainRate || 0 : 0;
      set('next', nextLine, drain > 0 ? `${HUD.dryWarning && low ? HUD.dryWarning + ' · ' : ''}Demand −${drain.toFixed(2)} L/s` : 'Demand pump warming up', 'textContent');
      set('extra', clockExtra, `${HUD.delivered} ${s.liters.toFixed(1)} L`);
    } else {
      const L = s.liters || 0;
      const diff = L - shownLiters;
      shownLiters += diff * Math.min(1, dt * (Math.abs(diff) > 10 ? 14 : 8));
      if (Math.abs(L - shownLiters) < 0.05) shownLiters = L;
      set('ln', litersN, odometer(shownLiters), 'innerHTML');
      if (L - lastLiters >= 0.6) bump(litersBox, 'tick');
      const qk = (s.quota || []).join(',');
      if (qk !== quotaKey) { quotaKey = qk; buildMarks(s.quota || [1, 2, 3]); starsLit = 0; }
      set('fill', fill.style, `${Math.min(100, (shownLiters / gaugeMax) * 100)}%`, 'width');
      let lit = 0;
      for (const v of s.quota) if (L >= v) lit++;
      if (lit !== starsLit) {
        marks.querySelectorAll('.mark').forEach((m, i) => {
          m.classList.toggle('got', i < lit);
          m.classList.toggle('next', i === lit);
          if (i < lit && i >= starsLit) bump(m, 'pop');
        });
        starsLit = lit;
      }
      if (lit >= 3) set('next', nextLine, HUD.allDrops);
      else set('next', nextLine, HUD.nextDrop(Math.max(0.1, s.quota[lit] - L).toFixed(1)));
      set('extra', clockExtra, '');
    }
    lastLiters = s.liters || 0;

    // ---- clock ----
    if (mode === 'overtime') {
      set('clock', clock, fmtUp(s.clock.t));
    } else if (s.clock.left != null) {
      const left = s.clock.left;
      set('clock', clock, fmtTime(left));
      const urgent = left <= 10 && left > 0 && s.status === 'running';
      cls('clock', clockPlate, 'urgent', urgent);
      const sec = Math.ceil(left);
      if (urgent && sec !== lastClockSec && !reduce) bump(clock, 'beat');
      lastClockSec = sec;
    }

    // ---- donors / intake ----
    set('donors', donorsN, String(s.donorsLeft ?? 0));
    if (incomingT > 0) {
      incomingT -= dt;
      set('intake', intakeT, HUD.incoming(incomingN));
      cls('intake', intakeMeta, 'hot', true);
      intakeMeta.hidden = false;
    } else {
      cls('intake', intakeMeta, 'hot', false);
      let txt = '';
      if (mode === 'overtime') {
        const n = live && live.mode && live.mode.waves ? live.mode.waves.opened : 0;
        txt = n > 0 ? HUD.wave(n) : '';
      } else if (level && live && live.mode && live.mode.waves) {
        const opened = live.mode.waves.opened || 0;
        const w = level.waves && level.waves[opened];
        if (w && s.clock) txt = `${HUD.intake} ${fmtTime(Math.max(0, w.at - s.clock.t))}`;
      }
      set('intake', intakeT, txt);
      intakeMeta.hidden = !txt;
    }

    // ---- combo ----
    if (!combo.hidden) {
      const timer = live && live.scoring ? live.scoring.combo.timer : 0;
      const win = live && live.T ? live.T.scoring.comboWindow : 3;
      const k = Math.max(0, Math.min(1, timer / win));
      set('cbar', comboBar.style, `scaleX(${k.toFixed(3)})`, 'transform');
      if (k <= 0 || (live && live.scoring && live.scoring.combo.multiplier < 2)) {
        comboT -= dt * 4;
        if (comboT <= 0) combo.hidden = true;
      }
    }

    // ---- slam ----
    const total = (live && live.T ? live.T.slam.cooldown : 2.5) || 2.5;
    const cd = s.slam ? s.slam.cooldown : 0;
    const ready = !s.slam || s.slam.ready || cd <= 0;
    const prog = ready ? 100 : Math.max(0, Math.min(100, (1 - cd / total) * 100));
    set('slamp', dialRing.style, `${(100 - prog).toFixed(1)}`, 'strokeDashoffset');
    cls('slam', dial, 'ready', ready);

    // ---- PA ----
    if (paTimer > 0) {
      paTimer -= dt;
      paShown = Math.min(paFull.length, paShown + dt * 48);
      const g = paMood === 'glitch' ? Math.max(0.55, fillLevel) : smooth(0.55, 0.98, fillLevel) * 0.8;
      cls('pa', pa, 'glitchy', g > 0.15);
      paGlitchT += dt;
      const t = reduce ? 0 : paGlitchT;
      set('pa', paText, glitchText(paFull.slice(0, Math.floor(paShown)), g, t));
      if (paTimer <= 0) pa.hidden = true;
    }
  }

  function setPrompt(p, device) {
    if (!p) { if (!prompt.hidden) { prompt.hidden = true; cache.prompt = null; } return; }
    const key = `${p.glyph}|${p.text}|${device}`;
    if (cache.prompt === key) return;
    cache.prompt = key;
    promptGlyph.dataset.glyph = p.glyph;
    promptGlyph.__glyph = null;
    promptText.textContent = p.text;
    prompt.hidden = false;
    bump(prompt, 'enter');
  }
  function setRestart(k) {
    const on = k > 0.02;
    if (restart.hidden === on) restart.hidden = !on;
    if (on) restartRing.style.strokeDashoffset = `${(100 - k * 100).toFixed(1)}`;
  }

  return {
    el,
    reset, update, setPrompt, setRestart,
    setVisible(v) { el.classList.toggle('on', !!v); },
    dispose() { offs.forEach((o) => o()); el.remove(); },
  };
}
