/**
 * Input: keyboard + gamepad -> the game's tiny verb set (GDD §4 control table) + menu navigation.
 *
 *   const input = createInput(window);
 *   const s = input.poll(realDt);   // call once per render frame (also drives gamepad menu events)
 *   s.rotate   -1..1   (-1 = counter-clockwise / A / Left / LT,  +1 = clockwise / D / Right / RT)
 *   s.brake    bool    (S / Down / Shift, gamepad X)
 *   s.slam     bool    edge: true on the frame SLAM was pressed (Space, gamepad A)
 *   s.pause    bool    edge (Esc / P, gamepad Start)
 *   s.restart  bool    edge: fires once after R / Select held for restartHold seconds
 *   s.restartProgress 0..1
 *   s.any      bool    edge: any key / button / click this frame (press-any-key gate, audio unlock)
 *
 *   input.onPress(fn)          // fn(action, sourceEvent|null, { repeat, device }) for menus:
 *                              // 'up','down','left','right' (repeat while held: keys, d-pad, left stick),
 *                              // 'confirm','back','pause','slam','restart','prevTab','nextTab'
 *   input.onDevice(fn)         // fn('keyboard'|'gamepad') when the last-used device changes
 *   input.setOverride({rotate, brake, slam} | null)   // debug harness (window.__edc.setInput)
 *   input.lastDevice           // 'keyboard' | 'gamepad' (for button-glyph prompts)
 *   input.padConnected         // true while any gamepad is connected
 *
 * Browser-only (touches window/navigator) — never import from src/sim.
 */
const KEYMAP = {
  rotateLeft: ['KeyA', 'ArrowLeft'],
  rotateRight: ['KeyD', 'ArrowRight'],
  brake: ['KeyS', 'ArrowDown', 'ShiftLeft', 'ShiftRight'],
  slam: ['Space'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
};
const NAV = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right', Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', Escape: 'back',
  Backspace: 'back', KeyP: 'pause', KeyR: 'restart', KeyQ: 'prevTab', KeyE: 'nextTab',
};
const DIRS = new Set(['up', 'down', 'left', 'right']);
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const REPEAT_DELAY = 0.38; const REPEAT_EVERY = 0.085;

export function createInput(target = window, { deadzone = 0.2, restartHold = 0.5 } = {}) {
  const down = new Set();
  let slamEdge = false; let pauseEdge = false; let anyEdge = false;
  let override = null;
  let restartHeldFor = 0; let restartFired = false;
  const pressListeners = new Set();
  const deviceListeners = new Set();
  const prevPad = new Map();
  const padNav = { dir: null, held: 0, next: 0 };
  const api = { lastDevice: 'keyboard', padConnected: false };

  const firePress = (action, ev = null, info = {}) => {
    for (const fn of [...pressListeners]) { try { fn(action, ev, info); } catch (e) { console.error(e); } }
  };
  const setDevice = (d) => {
    if (api.lastDevice === d) return;
    api.lastDevice = d;
    for (const fn of [...deviceListeners]) { try { fn(d); } catch (e) { console.error(e); } }
  };

  function onKeyDown(e) {
    setDevice('keyboard');
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    const nav = NAV[e.code];
    if (e.repeat) {
      // held arrows / WASD repeat for menus (sliders, long lists); nothing else repeats
      if (nav && DIRS.has(nav)) firePress(nav, e, { repeat: true, device: 'keyboard' });
      return;
    }
    down.add(e.code);
    anyEdge = true;
    if (KEYMAP.slam.includes(e.code)) slamEdge = true;
    if (KEYMAP.pause.includes(e.code)) pauseEdge = true;
    if (nav) firePress(nav, e, { repeat: false, device: 'keyboard' });
    if (KEYMAP.slam.includes(e.code)) firePress('slam', e, { device: 'keyboard' });
  }
  function onKeyUp(e) { down.delete(e.code); }
  function onBlur() { down.clear(); }
  function onPointer() { anyEdge = true; setDevice('keyboard'); }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  target.addEventListener('pointerdown', onPointer);

  const keyHeld = (codes) => codes.some((c) => down.has(c));

  function readPad(realDt) {
    const out = { rotate: 0, brake: false, slam: false, pause: false, restartHeld: false, any: false };
    let pads = [];
    try { pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : []; } catch { pads = []; }
    let navDir = null;
    let connected = false;
    const info = { repeat: false, device: 'gamepad' };
    for (const pad of pads || []) {
      if (!pad || !pad.connected) continue;
      connected = true;
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const pressed = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      let x = pad.axes[0] || 0;
      const y = pad.axes[1] || 0;
      if (Math.abs(x) < deadzone) x = 0; else x = Math.sign(x) * (Math.abs(x) - deadzone) / (1 - deadzone);
      const trig = b(PAD.RT) - b(PAD.LT);
      const r = Math.abs(trig) > Math.abs(x) ? trig : x;
      if (Math.abs(r) > Math.abs(out.rotate)) out.rotate = r;
      if (pressed(PAD.X)) out.brake = true;
      const prev = prevPad.get(pad.index) || [];
      const edge = (i) => pressed(i) && !prev[i];
      if (edge(PAD.A)) { out.slam = true; firePress('slam', null, info); firePress('confirm', null, info); }
      if (edge(PAD.B)) firePress('back', null, info);
      if (edge(PAD.START)) { out.pause = true; firePress('pause', null, info); }
      if (edge(PAD.LB)) firePress('prevTab', null, info);
      if (edge(PAD.RB)) firePress('nextTab', null, info);
      if (pressed(PAD.SELECT)) out.restartHeld = true;
      // menu direction: d-pad first, then the left stick (with a generous threshold)
      if (!navDir) {
        if (pressed(PAD.UP)) navDir = 'up';
        else if (pressed(PAD.DOWN)) navDir = 'down';
        else if (pressed(PAD.LEFT)) navDir = 'left';
        else if (pressed(PAD.RIGHT)) navDir = 'right';
        else if (Math.max(Math.abs(pad.axes[0] || 0), Math.abs(y)) > 0.55) {
          const ax = pad.axes[0] || 0;
          navDir = Math.abs(ax) > Math.abs(y) ? (ax > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
        }
      }
      const now = pad.buttons.map((bt) => bt.pressed);
      if (now.some((p, i) => p && !prev[i])) out.any = true;
      prevPad.set(pad.index, now);
      if (out.any || out.rotate !== 0 || navDir) setDevice('gamepad');
    }
    api.padConnected = connected;
    // direction presses with auto-repeat
    if (navDir !== padNav.dir) {
      padNav.dir = navDir; padNav.held = 0; padNav.next = REPEAT_DELAY;
      if (navDir) firePress(navDir, null, { repeat: false, device: 'gamepad' });
    } else if (navDir) {
      padNav.held += realDt;
      if (padNav.held >= padNav.next) { padNav.next += REPEAT_EVERY; firePress(navDir, null, { repeat: true, device: 'gamepad' }); }
    }
    return out;
  }

  const state = { rotate: 0, brake: false, slam: false, pause: false, restart: false, restartProgress: 0, any: false };

  api.poll = function poll(realDt = 0) {
    const pad = readPad(realDt);
    let rotate = 0;
    if (keyHeld(KEYMAP.rotateLeft)) rotate -= 1;
    if (keyHeld(KEYMAP.rotateRight)) rotate += 1;
    if (Math.abs(pad.rotate) > Math.abs(rotate)) rotate = pad.rotate;
    state.rotate = Math.max(-1, Math.min(1, rotate));
    state.brake = keyHeld(KEYMAP.brake) || pad.brake;
    state.slam = slamEdge || pad.slam;
    state.pause = pauseEdge || pad.pause;
    state.any = anyEdge || pad.any;

    const restartHeld = keyHeld(KEYMAP.restart) || pad.restartHeld;
    state.restart = false;
    if (restartHeld) {
      restartHeldFor += realDt;
      if (restartHeldFor >= restartHold && !restartFired) { state.restart = true; restartFired = true; }
    } else { restartHeldFor = 0; restartFired = false; }
    state.restartProgress = restartFired ? 0 : Math.min(1, restartHeldFor / restartHold);

    if (override) {
      state.rotate = override.rotate ?? 0;
      state.brake = !!override.brake;
      state.slam = state.slam || !!override.slam;
      override.slam = false; // slam override is a one-shot request
    }
    slamEdge = false; pauseEdge = false; anyEdge = false;
    return state;
  };

  /** Forget held keys / restart progress (e.g. when a menu closes so a held key doesn't leak into play). */
  api.reset = () => { down.clear(); restartHeldFor = 0; restartFired = true; slamEdge = false; pauseEdge = false; };
  api.setOverride = (o) => { override = o ? { ...o } : null; };
  api.onPress = (fn) => { pressListeners.add(fn); return () => pressListeners.delete(fn); };
  api.onDevice = (fn) => { deviceListeners.add(fn); return () => deviceListeners.delete(fn); };
  api.dispose = () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('pointerdown', onPointer);
    pressListeners.clear();
    deviceListeners.clear();
  };
  return api;
}
