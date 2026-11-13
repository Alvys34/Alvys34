/**
 * BASELINE UI (temporary — the UI agent replaces this). Plain DOM overlay, no framework.
 *
 *   const ui = createUI({ root, bus });
 *   ui.showGate(onStart)            // "press any key" (needed for audio unlock)
 *   ui.update(snapshot)             // every frame (or a few times per second) with sim.snapshot()
 *   ui.showResults(result, { onRetry, onNext, hasNext }) / ui.hideResults()
 *   ui.setPaused(bool, { onResume, onRestart })
 *   ui.dispose()
 * Listens on the bus for: combo, bonus, fine, pa:announce, slam:ready, timer:warning, shift:start.
 */
import './ui.css';

export function createUI({ root, bus }) {
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const wrap = el('div', 'edc-ui');
  root.appendChild(wrap);

  // ---- HUD ----
  const hud = el('div', 'edc-hud');
  hud.innerHTML = `
    <div class="edc-hud-left">
      <div class="edc-liters"><span class="edc-liters-n">0.0</span><span class="edc-liters-u"> L</span></div>
      <div class="edc-gauge"><div class="edc-gauge-fill"></div><div class="edc-gauge-marks"></div></div>
      <div class="edc-quota"></div>
    </div>
    <div class="edc-hud-mid"><div class="edc-level"></div><div class="edc-pa"></div></div>
    <div class="edc-hud-right">
      <div class="edc-clock">0:00</div>
      <div class="edc-donors">Donors: 0</div>
      <div class="edc-slam"><span>SLAM</span><div class="edc-slam-bar"><div></div></div></div>
    </div>
    <div class="edc-combo"></div>`;
  wrap.appendChild(hud);
  const q = (s) => hud.querySelector(s);
  const litersN = q('.edc-liters-n'); const gaugeFill = q('.edc-gauge-fill'); const marks = q('.edc-gauge-marks');
  const quotaEl = q('.edc-quota'); const clock = q('.edc-clock'); const donors = q('.edc-donors');
  const slamBar = q('.edc-slam-bar > div'); const slamEl = q('.edc-slam'); const comboEl = q('.edc-combo');
  const paEl = q('.edc-pa'); const levelEl = q('.edc-level');
  let quotaKey = '';
  let gaugeMax = 1;

  // ---- overlays ----
  const gate = el('div', 'edc-overlay edc-gate', `
    <div class="edc-card"><div class="edc-title">EVERY DROP COUNTS</div>
    <div class="edc-sub">DRAINWELL™ Community Donation Center</div>
    <div class="edc-press">Press any key to begin your shift</div>
    <div class="edc-help">A / D or ← / → rotate · S / Shift brake · SPACE slam · Esc pause · hold R restart</div></div>`);
  const results = el('div', 'edc-overlay edc-results');
  const pause = el('div', 'edc-overlay edc-pause', `<div class="edc-card"><div class="edc-title">PAUSED</div>
    <div class="edc-buttons"><button data-a="resume">Resume</button><button data-a="restart">Restart shift</button></div></div>`);
  for (const o of [gate, results, pause]) { o.hidden = true; wrap.appendChild(o); }

  let paTimer = 0; let comboTimer = 0;
  const offs = [
    bus.on('pa:announce', (p) => { paEl.textContent = `PA: ${p.text}`; paEl.dataset.mood = p.mood; paTimer = 6; }),
    bus.on('combo', (p) => { comboEl.textContent = `SPONSOR MATCH ×${p.multiplier}`; comboEl.classList.remove('pop'); void comboEl.offsetWidth; comboEl.classList.add('pop'); comboTimer = 1.6; }),
    bus.on('fine', (p) => { comboEl.textContent = `FINE −${p.liters} L`; comboTimer = 2; }),
    bus.on('timer:warning', (p) => { clock.classList.toggle('warn', p.secondsLeft <= 10); }),
    bus.on('shift:start', (p) => { levelEl.textContent = p.mode === 'overtime' ? 'OVERTIME' : `Shift ${p.number}: ${p.name}`; clock.classList.remove('warn'); }),
  ];

  let gateHandler = null;
  const api = {
    showGate(onStart) {
      gate.hidden = false;
      gateHandler = () => {
        if (gate.hidden) return;
        gate.hidden = true;
        window.removeEventListener('keydown', gateHandler, true);
        window.removeEventListener('pointerdown', gateHandler, true);
        onStart();
      };
      window.addEventListener('keydown', gateHandler, true);
      window.addEventListener('pointerdown', gateHandler, true);
    },
    get gateVisible() { return !gate.hidden; },
    update(s, realDt = 0.016) {
      if (!s) return;
      litersN.textContent = s.liters.toFixed(1);
      const qk = JSON.stringify(s.quota);
      if (qk !== quotaKey) {
        quotaKey = qk;
        gaugeMax = Math.max(1, (s.quota[2] || 1) * 1.15);
        marks.innerHTML = s.quota.map((v, i) => `<i style="left:${(v / gaugeMax) * 100}%" title="${i + 1}"></i>`).join('');
        quotaEl.innerHTML = s.quota.map((v, i) => `<span data-i="${i}"><i class="edc-drop"></i>${v}</span>`).join('');
      }
      gaugeFill.style.width = `${Math.min(100, (s.liters / gaugeMax) * 100)}%`;
      quotaEl.querySelectorAll('span').forEach((sp, i) => sp.classList.toggle('got', s.liters >= s.quota[i]));
      if (s.clock.left != null) {
        const t = Math.max(0, Math.ceil(s.clock.left));
        clock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      } else {
        clock.textContent = `${Math.floor(s.clock.t / 60)}:${String(Math.floor(s.clock.t % 60)).padStart(2, '0')}`;
      }
      donors.textContent = `Donors: ${s.donorsLeft}`;
      const cd = s.slam.cooldown;
      slamBar.style.width = `${cd <= 0 ? 100 : (1 - cd / 2.5) * 100}%`;
      slamEl.classList.toggle('ready', cd <= 0);
      paTimer -= realDt; comboTimer -= realDt;
      if (paTimer <= 0) paEl.textContent = '';
      if (comboTimer <= 0) comboEl.textContent = '';
    },
    showResults(r, { onRetry, onNext, hasNext }) {
      const stars = '<i class="edc-drop big"></i>'.repeat(r.stars) + '<i class="edc-drop big dim"></i>'.repeat(3 - r.stars);
      const title = r.result === 'complete' ? 'SHIFT REPORT' : r.result === 'timeout' ? 'SHIFT REPORT — QUOTA MISSED' : 'SHIFT REPORT — INCOMPLETE';
      results.innerHTML = `<div class="edc-card"><div class="edc-title">${title}</div>
        <div class="edc-stars">${stars}</div>
        <table class="edc-report">
          ${r.collected != null ? `<tr><td>Litres collected</td><td>${r.collected.toFixed(1)} L</td></tr>` : ''}
          ${r.bonus != null ? `<tr><td>Sponsor Match &amp; bonuses</td><td>+${r.bonus.toFixed(1)} L</td></tr>` : ''}
          ${r.fines ? `<tr><td>Fines</td><td>−${r.fines.toFixed(1)} L</td></tr>` : ''}
          <tr class="edc-total"><td>Total donated</td><td>${r.liters.toFixed(1)} L</td></tr>
          <tr><td>Donors processed</td><td>${r.kills ?? 0}${r.donorsTotal ? ' / ' + r.donorsTotal : ''}</td></tr>
          <tr><td>Drownings (waste)</td><td>${r.drownings ?? 0}</td></tr>
          <tr><td>Complaints received</td><td>0 (donors unavailable for comment)</td></tr>
          <tr><td>Cookies distributed</td><td>0</td></tr>
        </table>
        <div class="edc-buttons"><button data-a="retry">Retry</button>${hasNext ? '<button data-a="next">Next shift</button>' : ''}</div></div>`;
      results.hidden = false;
      results.querySelector('[data-a="retry"]').onclick = () => onRetry && onRetry();
      const nb = results.querySelector('[data-a="next"]');
      if (nb) nb.onclick = () => onNext && onNext();
      (nb || results.querySelector('[data-a="retry"]')).focus();
    },
    hideResults() { results.hidden = true; },
    get resultsVisible() { return !results.hidden; },
    setPaused(p, { onResume, onRestart } = {}) {
      pause.hidden = !p;
      if (p) {
        pause.querySelector('[data-a="resume"]').onclick = () => onResume && onResume();
        pause.querySelector('[data-a="restart"]').onclick = () => onRestart && onRestart();
      }
    },
    dispose() {
      offs.forEach((o) => o());
      if (gateHandler) { window.removeEventListener('keydown', gateHandler, true); window.removeEventListener('pointerdown', gateHandler, true); }
      wrap.remove();
    },
  };
  return api;
}
