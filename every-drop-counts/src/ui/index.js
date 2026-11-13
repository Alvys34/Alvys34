/**
 * EVERY DROP COUNTS — player-facing shell (UI owner). Plain DOM overlay, no framework.
 *
 * Flow:  boot splash (audio-unlock gesture) → title → shift select → briefing card → play
 *        → pause (settings) → results → next (briefing) / retry / shift select
 *        title → Overtime (unlocks after shift 3) → Overtime report (+ initials, local top-10)
 *        shift 8 cleared → "Clock out" → ending sting → credits → title
 * Menus run the real sim in attract mode behind them (see attract.js; sim events are gated).
 *
 *   const ui = createUI({ root, bus, simBus, sim, view, loop, input, audio, canvas, params, debug });
 *   loop onFrameStart: ui.frame(realDt)      render: view.update(...); ui.update(realDt)
 *   ui.screen            'boot'|'menu'|'briefing'|'playing'|'paused'|'results'|'ending'
 *   ui.audioScreen       'menu'|'playing'|'paused'|'results' (audio contract)
 *   ui.audioState(a)     sim.audioState() adjusted for menus (calm attract)
 *   ui.startRun(ref) / ui.setPaused(bool) / ui.boot({ autostart })   (main + debug harness)
 */
import '@fontsource-variable/nunito';
import './ui.css';
import { version as PKG_VERSION } from '../../package.json';
import { getSave, updateSave, recordShiftResult, recordOvertime, overtimeQualifies, addStats, resetSave, saveInfo } from '../core/save.js';
import { listLevels, getLevel, nextLevel } from '../sim/levels/index.js';
import { OVERTIME_LEVEL } from '../sim/modes/overtime.js';
import { createNav } from './nav.js';
import { createHud } from './hud.js';
import { createBubbles } from './bubbles.js';
import { createScreens } from './screens.js';
import { createReports } from './report.js';
import { createSystems, desktop } from './systems.js';
import { ATTRACT_LEVEL, createAttract } from './attract.js';
import { refreshGlyphs } from './glyphs.js';
import { icon } from './icons.js';
import { esc } from './dom.js';
import { BRIEFINGS, SHIFT_NAMES_FALLBACK, TOTAL_SHIFTS, PROMPTS, RESULTS, RECORDS, MENU } from './copy.js';

const RESULTS_DELAY = 1.8; // s after shift:end before the report (let the last splashes land)

export function createUI({ root, bus, simBus, sim, view, loop, input, audio, canvas, params, debug = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'edc-ui';
  root.appendChild(wrap);
  const veil = document.createElement('div'); veil.className = 'veil'; wrap.appendChild(veil);
  const hud = createHud({ root: wrap, bus, getSettings: () => getSave().settings });
  const bubbles = createBubbles({ root: wrap, view, canvas });
  const layer = document.createElement('div'); layer.className = 'screens'; wrap.appendChild(layer);
  const toasts = document.createElement('div'); toasts.className = 'toasts'; toasts.setAttribute('role', 'status'); wrap.appendChild(toasts);
  const nav = createNav({ bus, root: layer });
  const safeAudio = typeof audio === 'function' ? audio : () => {};
  const systems = createSystems({ bus, view, audio: safeAudio, loop, root: document.documentElement, debug, lockQuality: !!(params && params.get('quality')) });
  const attract = createAttract();
  const d = desktop();
  const autopause = !debug || (params && params.get('autopause') === '1');

  /** 'boot'|'menu'|'briefing'|'playing'|'paused'|'results'|'ending' */
  let mode = 'boot';
  let run = null;          // current run (see newRun)
  let pending = null;      // briefing target { ref, level, overtime }
  let audioUnlocked = false;
  let lastShiftNum = 1;
  let layoutKey = '';
  let freshRun = false;   // set by startRun/resume: swallow the confirming press's slam edge

  // ------------------------------------------------------------------ app facade for screens
  const app = {
    layer, nav, bus,
    version: (d && d.version) || PKG_VERSION || '0.0.0',
    isDesktop: !!(d && typeof d.quit === 'function'),
    get run() { return run; },
    refreshGlyphs: (el) => refreshGlyphs(el || wrap, input.lastDevice),
    levels: () => listLevels(),
    fallbackName: (n) => SHIFT_NAMES_FALLBACK[n] || `Shift ${n}`,
    lastShiftNumber: () => lastShiftNum,
    snapshot: () => sim.snapshot(),
    achievements: () => systems.achievements,
    achievementDef: (id) => systems.defFor(id),
    clockInTarget() {
      const lv = listLevels();
      if (!lv.length) return null;
      const unlocked = getSave().progress.unlocked;
      const avail = lv.filter((l) => l.number <= unlocked);
      return avail.length ? avail[avail.length - 1] : lv[0];
    },
    overtimeRequirement() { const lv = listLevels(); return Math.min(3, lv.length ? lv[lv.length - 1].number : 3); },
    overtimeUnlocked() { return getSave().progress.unlocked > app.overtimeRequirement(); },
    recordsSub() {
      const defs = systems.achievements; const got = Object.keys(getSave().achievements).length;
      return defs.length ? `${defs.filter((x) => getSave().achievements[x.id]).length} of ${defs.length} commendations` : `${got} commendation${got === 1 ? '' : 's'}`;
    },
    // navigation actions
    leaveBoot,
    clockIn() { const t = app.clockInTarget(); if (t) prepare(t.number); },
    openShifts() { screens.shifts.refresh(); nav.push(screens.shifts); },
    openOvertime() { if (app.overtimeUnlocked()) prepare('overtime'); },
    openRecords() { screens.records.refresh(); nav.push(screens.records); },
    openSettings() { screens.settings.refresh(); nav.push(screens.settings); },
    openCredits() { screens.credits.refresh(); nav.push(screens.credits); },
    async quitGame() {
      if (!app.isDesktop) return;
      if (await screens.quitConfirm()) { try { d.quit(); } catch (e) { console.warn(e); } }
    },
    back,
    selectShift(n) { lastShiftNum = n; prepare(n); },
    beginShift() { if (pending) startRun(pending.ref); },
    resume: () => setPaused(false),
    restart: () => { if (run) startRun(run.ref); },
    quitToMenu() { commitStats(); run = null; toTitle(); },
    applySetting: (k) => { systems.apply(k); if (k === 'speechBubbles') bubbles.setVisible(getSave().settings.speechBubbles); },
    setFullscreen: (v) => systems.setFullscreen(v),
    resetProgress() { resetSave({ keepSettings: true }); },
    toast,
    nextShift() { const nx = run && !run.overtime ? nextLevel(run.level.id) : null; if (nx) { lastShiftNum = nx.number; prepare(nx.number); } else toShiftSelect(); },
    retry() { if (run) startRun(run.ref); },
    toShiftSelect,
    toTitle,
    playEnding,
    dropCamera,
  };

  const screens = createScreens(app);
  const reports = createReports(app);

  // ------------------------------------------------------------------ attract / modes
  function enterAttract() {
    if (simBus) simBus.setOpen(false);
    try { sim.loadLevel(ATTRACT_LEVEL); } catch (e) { console.warn('[edc] attract level failed', e); }
    attract.reset();
    loop.setPaused(false);
    loop.setTimeScale(1);
    loop.resetAccumulator();
    bubbles.clear();
    bubbles.setLimits({ max: 2, gap: 3.2, life: 3.2 });
    hud.setVisible(false);
  }

  function toTitle() {
    mode = 'menu';
    enterAttract();
    nav.clear();
    screens.title.refresh();
    nav.push(screens.title);
  }
  function toShiftSelect() {
    commitStats();
    mode = 'menu';
    enterAttract();
    nav.clear();
    screens.title.refresh();
    nav.push(screens.title);
    screens.shifts.refresh();
    nav.push(screens.shifts);
  }

  function leaveBoot() {
    if (mode !== 'boot') return;
    unlockAudio();
    systems.onFirstGesture();
    mode = 'menu';
    screens.title.refresh();
    nav.replace(screens.title);
  }

  function back() {
    const top = nav.top;
    if (!top) return;
    if (top.name === 'briefing') {
      pending = null;
      if (nav.depth > 1) { mode = 'menu'; enterAttract(); nav.pop(); } else toShiftSelect();
      return;
    }
    if (nav.depth > 1) nav.pop();
  }

  /** Load the level silently behind the briefing card (the player sees the real hazards). */
  function prepare(ref) {
    const overtime = ref === 'overtime';
    let level;
    try { level = overtime ? OVERTIME_LEVEL : getLevel(ref); } catch (e) { console.warn(e); return; }
    pending = { ref: overtime ? 'overtime' : level.number, level, overtime };
    if (simBus) simBus.setOpen(false);
    try { if (overtime) sim.startOvertime(); else sim.loadLevel(level.id); } catch (e) { console.error(e); return; }
    loop.setPaused(true);
    bubbles.clear();
    mode = 'briefing';
    const b = overtime ? BRIEFINGS.overtime : (level.briefing ? { icon: level.briefingIcon || (BRIEFINGS[level.number] || {}).icon, text: level.briefing } : BRIEFINGS[level.number]) || { icon: 'drop', text: level.subtitle || '' };
    screens.briefing.show({
      kicker: overtime ? 'Endless shift' : `Shift ${String(level.number).padStart(2, '0')} of ${String(Math.max(TOTAL_SHIFTS, listLevels().length)).padStart(2, '0')}`,
      name: overtime ? MENU.overtime : level.name,
      text: b.text,
      icon: b.icon,
      quota: overtime ? null : level.quota,
      duration: level.duration,
      best: overtime ? null : (getSave().best[level.id] && getSave().best[level.id].stars > 0 ? getSave().best[level.id] : null),
      overtime,
      metaHtml: overtime && getSave().overtime[0] ? `<span class="meta-time">${icon('rosette')}<b class="num">Best ${getSave().overtime[0].liters.toFixed(1)} L</b></span>` : '',
    });
    nav.push(screens.briefing);
  }

  function newRun(ref) {
    const overtime = ref === 'overtime';
    const level = overtime ? OVERTIME_LEVEL : getLevel(ref);
    return {
      ref: overtime ? 'overtime' : level.number, overtime, level,
      extras: { severs: 0, combos: 0, explosions: 0, inspectorFines: 0, inspectorBonus: 0, slams: 0 },
      ended: false, result: null, resultsTimer: 0, committed: false,
      teach: { t: 0, rotHeld: 0, idle: 0, nudge: false, brakeUsed: false, fast: 0 },
    };
  }

  function startRun(ref) {
    if (run && !run.ended) commitStats();
    let r;
    try { r = newRun(ref); } catch (e) { console.error(e); return null; }
    run = r;
    pending = null;
    if (!r.overtime) lastShiftNum = r.level.number;
    if (simBus) simBus.setOpen(true);
    nav.clear();
    hud.reset(r.level, r.overtime ? 'overtime' : 'shift');
    if (r.overtime) sim.startOvertime(); else sim.loadLevel(r.level.id);
    mode = 'playing';
    freshRun = true;
    input.reset();
    loop.setTimeScale(1);
    loop.setPaused(false);
    loop.resetAccumulator();
    bubbles.clear();
    bubbles.setLimits({ max: 3, gap: 0.9, life: 2.8 });
    hud.setVisible(true);
    unlockAudio();
    return sim.snapshot();
  }

  function setPaused(p) {
    if (p && mode === 'playing') {
      if (run && run.ended) return; // report is about to show
      mode = 'paused';
      loop.setPaused(true);
      hud.setVisible(false);
      screens.pause.refresh();
      nav.clear();
      nav.push(screens.pause);
      bus.emit('game:pause', { paused: true });
    } else if (!p && mode === 'paused') {
      mode = 'playing';
      freshRun = true;
      nav.clear();
      hud.setVisible(true);
      input.reset();
      loop.setPaused(false);
      loop.resetAccumulator();
      bus.emit('game:pause', { paused: false });
    }
  }

  function commitStats() {
    if (!run || run.committed) return;
    run.committed = true;
    const s = sim.snapshot();
    if (!s || s.levelId === 'attract') return;
    addStats({
      donorsProcessed: s.kills || 0, drownings: s.drownings || 0, limbsSevered: run.extras.severs,
      slams: (s.slam && s.slam.count) || 0, secondsOnShift: (s.clock && s.clock.t) || 0,
    });
  }

  // ------------------------------------------------------------------ run events (real bus only)
  const offs = [
    bus.on('limb:sever', () => { if (run) run.extras.severs++; }),
    bus.on('combo', () => { if (run) run.extras.combos++; }),
    bus.on('prop:explode', () => { if (run) run.extras.explosions++; }),
    bus.on('fine', (p) => { if (run && /incident|inspector/.test(p.reason || '')) run.extras.inspectorFines++; }),
    bus.on('bonus', (p) => { if (run && /inspector|compliance|inspection/.test(p.reason || '')) run.extras.inspectorBonus++; }),
    bus.on('shift:end', (r) => {
      if (!run || run.ended || mode === 'menu' || mode === 'briefing') return;
      run.ended = true;
      run.result = r;
      run.resultsTimer = RESULTS_DELAY;
      const snap = sim.snapshot();
      run.extras.slams = (snap && snap.slam && snap.slam.count) || 0;
      commitStats();
      if (run.overtime) {
        const qualifies = overtimeQualifies(r.liters);
        // only runs that make the local top-10 are entered (a 0 L run never takes a slot)
        const rec = qualifies ? recordOvertime(r.liters, { time: r.time || (snap && snap.clock.t) || 0 }) : { rank: -1, entry: null };
        if (!qualifies) addStats({ overtimeRuns: 1, litersTotal: Math.max(0, r.liters || 0) });
        run.record = { ...rec, qualifies: qualifies && rec.rank >= 0 };
      } else {
        const otBefore = app.overtimeUnlocked();
        const info = recordShiftResult(r.levelId || run.level.id, { liters: r.liters, stars: r.stars, levelNumber: r.levelNumber ?? run.level.number });
        const notes = [];
        const nx = nextLevel(run.level.id);
        if (info.unlockedNext && nx) notes.push(RESULTS.unlocked(nx.number, nx.name));
        if (!otBefore && app.overtimeUnlocked()) notes.push(RESULTS.overtimeUnlocked);
        run.record = { ...info, notes };
      }
    }),
  ];
  // speech bubbles: tap the sim bus so attract-mode donors talk too (gated bus otherwise mutes them)
  const speakSrc = simBus && simBus.tap ? (fn) => simBus.tap('donor:speak', fn) : (fn) => bus.on('donor:speak', fn);
  offs.push(speakSrc((p) => {
    if (!getSave().settings.speechBubbles) return;
    if (mode === 'playing' || mode === 'menu' || mode === 'boot') bubbles.say(p.id, p.text);
  }));
  offs.push(systems.onAchievement((def) => toast({ title: RECORDS.toast, name: def.name, kind: 'ach' })));

  function showResults() {
    const r = run.result;
    mode = 'results';
    nav.clear();
    hud.setVisible(false);
    bubbles.clear();
    if (run.overtime) {
      reports.overtime.show(r, { rank: run.record ? run.record.rank : -1, entry: run.record ? run.record.entry : null, qualifies: !!(run.record && run.record.qualifies) });
      nav.push(reports.overtime);
      return;
    }
    const nx = nextLevel(run.level.id);
    const unlocked = getSave().progress.unlocked;
    reports.results.show(r, {
      level: run.level,
      prev: run.record ? run.record.prev : null,
      isBest: !!(run.record && run.record.isBest),
      hasNext: !!nx && nx.number <= unlocked,
      isFinal: !nx && run.level.number >= TOTAL_SHIFTS,
      extras: run.extras,
      extraNotes: run.record ? run.record.notes : [],
    });
    nav.push(reports.results);
  }

  // ------------------------------------------------------------------ ending (shift 8)
  async function playEnding() {
    mode = 'ending';
    nav.clear();
    hud.setVisible(false);
    bubbles.clear();
    updateSave((s) => { s.progress.endingSeen = true; });
    nav.push(reports.ending);
    await reports.ending.play();
    const c = canvas;
    c.classList.remove('drop-cam');
    c.style.removeProperty('--drop-t');
    run = null;
    toTitle();
    screens.credits.refresh();
    nav.push(screens.credits);
  }
  /** Hand off to the camera if VFX provides a hook; otherwise a CSS push-in on the canvas. */
  function dropCamera() {
    bus.emit('ending:start', {});
    const rig = view && view.ctx && view.ctx.cameraRig;
    const hook = (view && view.playEnding) || (rig && (rig.playEnding || rig.ending));
    if (typeof hook === 'function') { try { hook.call(view.playEnding ? view : rig); return; } catch (e) { console.warn(e); } }
    canvas.classList.add('drop-cam');
  }

  // ------------------------------------------------------------------ toasts
  function toast({ title, name = '', kind = 'info', ms = 3800 }) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = `<span class="toast-ico">${icon(kind === 'ach' ? 'rosette' : 'check')}</span><span class="toast-main"><span class="toast-t">${esc(title)}</span>${name ? `<b>${esc(name)}</b>` : ''}</span>`;
    toasts.appendChild(t);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => t.classList.remove('in'), ms);
    setTimeout(() => t.remove(), ms + 500);
  }

  // ------------------------------------------------------------------ input routing
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    safeAudio((a) => a.unlock());
  }
  input.onPress((action, ev, info = {}) => {
    if (mode === 'playing') {
      if ((action === 'pause' || action === 'back') && !info.repeat) setPaused(true);
      return;
    }
    nav.handle(action, ev, info);
  });
  input.onDevice((dev) => { refreshGlyphs(wrap, dev); wrap.dataset.device = dev; });
  wrap.dataset.device = input.lastDevice;

  // ------------------------------------------------------------------ focus loss
  const onBlur = () => { if (autopause && mode === 'playing') setPaused(true); };
  const onVis = () => {
    if (document.hidden) { if (autopause && mode === 'playing') setPaused(true); safeAudio((a) => a.suspend()); } else safeAudio((a) => a.resume());
  };
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('resize', () => { nav.refocus(); });

  // ------------------------------------------------------------------ per-frame
  function frame(dt) {
    const before = mode;
    const s = input.poll(dt);  // may switch modes (gamepad presses are dispatched from here)
    if (s.any) unlockAudio();
    if (mode === 'playing') {
      // the A / Space press that began or resumed the shift must not also SLAM
      const fresh = before !== 'playing' || freshRun;
      freshRun = false;
      sim.setInput({ rotate: s.rotate, brake: s.brake, slam: s.slam && !fresh });
      if (s.restart) { startRun(run.ref); return; }
      hud.setRestart(s.restartProgress);
      teach(s, dt);
      systems.tickQuality(dt, true);
    } else if (mode === 'paused') {
      sim.setInput({ rotate: 0, brake: false });
      if (s.restart) { startRun(run.ref); return; }
    } else if (mode === 'menu' || mode === 'boot') {
      attract.update(sim, dt);
    } else {
      sim.setInput({ rotate: 0, brake: false });
    }
    if (run && run.ended && run.resultsTimer > 0 && mode === 'playing') {
      run.resultsTimer -= dt;
      if (run.resultsTimer <= 0) showResults();
    }
    // layout state for CSS (canvas shift, veil)
    const top = nav.top;
    const lk = `${mode}|${top ? top.layout : 'hud'}`;
    if (lk !== layoutKey) {
      layoutKey = lk;
      const parts = (top ? top.layout : 'hud').split(' ');
      document.body.dataset.layout = parts[0];
      document.body.dataset.wide = parts.includes('wide') ? '1' : '0';
      document.body.dataset.mode = mode;
    }
  }

  function teach(s, dt) {
    if (!run || run.overtime || run.ended) { hud.setPrompt(null); return; }
    const T = run.teach;
    const snap = sim.snapshot();
    if (!snap) return;
    T.t += dt;
    if (Math.abs(s.rotate) > 0.3) { T.rotHeld += dt; T.idle = 0; if (T.rotHeld > 0.35) T.nudge = false; } else T.idle += dt;
    if (s.brake) T.brakeUsed = true;
    T.fast = Math.abs(snap.drum.omega) > 1.9 ? T.fast + dt : 0;
    if (T.idle > 12 && snap.alive > 0) T.nudge = true;
    const n = run.level.number;
    const lessons = Array.isArray(run.level.teach) ? run.level.teach : n === 1 ? ['rotate', 'brake'] : n === 2 ? ['slam'] : [];
    const slamUsed = snap.slam && snap.slam.count > 0;
    let p = null;
    if (s.restartProgress > 0.02) p = null;
    else if (lessons.includes('slam') && !slamUsed && T.t > 3 && snap.slam.ready && snap.alive > 0) p = { glyph: 'slam', text: PROMPTS.slam };
    else if ((lessons.includes('rotate') && T.rotHeld < 0.6 && T.t > 1.2) || T.nudge) p = { glyph: 'rotate', text: PROMPTS.rotate };
    else if (lessons.includes('brake') && !T.brakeUsed && T.fast > 2.5) p = { glyph: 'brake', text: PROMPTS.brake };
    hud.setPrompt(p, input.lastDevice);
    if (p) refreshGlyphs(hud.el.querySelector('.prompt'), input.lastDevice);
  }

  function update(realDt) {
    if (mode === 'playing' || mode === 'paused' || (run && mode === 'results')) {
      if (mode === 'playing') hud.update(sim.snapshot(), sim.state, realDt);
    }
    bubbles.update(sim.state, mode === 'paused' || mode === 'briefing' ? 0 : realDt);
  }

  // ------------------------------------------------------------------ boot
  function boot({ autostart = null } = {}) {
    systems.applyAll();
    systems.loadAchievements().then(() => systems.syncSteam());
    bubbles.setVisible(getSave().settings.speechBubbles);
    refreshGlyphs(wrap, input.lastDevice);
    if (saveInfo.status === 'corrupt') setTimeout(() => toast({ title: 'Save file unreadable', name: 'A fresh record was started.', kind: 'info' }), 600);
    if (autostart != null) { startRun(autostart); return; }
    mode = 'boot';
    enterAttract();
    nav.push(screens.boot);
  }

  return {
    boot, frame, update, startRun, setPaused,
    get screen() { return mode; },
    get audioScreen() { return mode === 'playing' ? 'playing' : mode === 'paused' || mode === 'ending' ? 'paused' : mode === 'results' ? 'results' : 'menu'; },
    audioState(a) {
      if (mode === 'playing' || mode === 'results') return a;
      return { ...a, drumOmega: 0, intensity: 0, sawLoad: 0, grinderLoad: 0, aliveCount: 0, fill: 0 };
    },
    get nav() { return nav; },
    get run() { return run; },
    hud, bubbles, systems, screens, reports,
    /** debug helpers for tools/ui-shots.mjs */
    debug: {
      toTitle, toShiftSelect, playEnding, toast,
      showResults(r, extras = {}) { run = run || newRun(r.levelNumber || 1); run.result = r; run.ended = true; run.record = { prev: null, isBest: true, notes: [] }; Object.assign(run.extras, extras); showResults(); },
      showOvertime(r, rec) { run = newRun('overtime'); run.result = r; run.ended = true; run.record = rec; showResults(); },
      brief: (n) => prepare(n),
      open(name) { const m = { settings: app.openSettings, records: app.openRecords, credits: app.openCredits, shifts: app.openShifts }; if (m[name]) m[name](); },
    },
    dispose() {
      offs.forEach((o) => o());
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      hud.dispose(); bubbles.dispose(); nav.dispose(); systems.dispose();
      wrap.remove();
    },
  };
}
