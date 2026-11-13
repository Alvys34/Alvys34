/**
 * Input: keyboard + gamepad -> the game's tiny verb set (GDD §4 control table).
 *
 *   const input = createInput(window);
 *   const s = input.poll(realDt);   // call once per render frame
 *   s.rotate   -1..1   (-1 = counter-clockwise / A / Left / LT,  +1 = clockwise / D / Right / RT)
 *   s.brake    bool    (S / Down / Shift, gamepad X)
 *   s.slam     bool    edge: true on the frame SLAM was pressed (Space, gamepad A)
 *   s.pause    bool    edge (Esc / P, gamepad Start)
 *   s.restart  bool    edge: fires once after R / Select held for restartHold seconds
 *   s.restartProgress 0..1
 *   s.any      bool    edge: any key / button / click this frame (press-any-key gate, audio unlock)
 *
 *   input.onPress(fn)          // fn(action, sourceEvent) for menu nav: 'up','down','left','right',
 *                              // 'confirm','back','pause','slam','restart'
 *   input.setOverride({rotate, brake, slam} | null)   // debug harness (window.__edc.setInput)
 *   input.lastDevice           // 'keyboard' | 'gamepad' (for button-glyph prompts)
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
  ArrowRight: 'right', KeyD: 'right', Enter: 'confirm', Space: 'confirm', Escape: 'back',
  Backspace: 'back', KeyP: 'pause', KeyR: 'restart',
};
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export function createInput(target = window, { deadzone = 0.2, restartHold = 0.5 } = {}) {
  const down = new Set();
  let slamEdge = false; let pauseEdge = false; let anyEdge = false;
  let override = null;
  let restartHeldFor = 0; let restartFired = false;
  const pressListeners = new Set();
  const prevPad = new Map();
  const api = { lastDevice: 'keyboard' };

  const firePress = (action, ev) => { for (const fn of [...pressListeners]) { try { fn(action, ev); } catch (e) { console.error(e); } } };

  function onKeyDown(e) {
    api.lastDevice = 'keyboard';
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    down.add(e.code);
    anyEdge = true;
    if (KEYMAP.slam.includes(e.code)) slamEdge = true;
    if (KEYMAP.pause.includes(e.code)) pauseEdge = true;
    if (NAV[e.code]) firePress(NAV[e.code], e);
    if (KEYMAP.slam.includes(e.code)) firePress('slam', e);
  }
  function onKeyUp(e) { down.delete(e.code); }
  function onBlur() { down.clear(); }
  function onPointer() { anyEdge = true; }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  target.addEventListener('pointerdown', onPointer);

  const keyHeld = (codes) => codes.some((c) => down.has(c));

  function readPad() {
    const out = { rotate: 0, brake: false, slam: false, pause: false, restartHeld: false, any: false };
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    for (const pad of pads || []) {
      if (!pad || !pad.connected) continue;
      const b = (i) => pad.buttons[i] ? pad.buttons[i].value : 0;
      const pressed = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      let x = pad.axes[0] || 0;
      if (Math.abs(x) < deadzone) x = 0; else x = Math.sign(x) * (Math.abs(x) - deadzone) / (1 - deadzone);
      const trig = b(PAD.RT) - b(PAD.LT);
      const r = Math.abs(trig) > Math.abs(x) ? trig : x;
      if (Math.abs(r) > Math.abs(out.rotate)) out.rotate = r;
      if (pressed(PAD.X)) out.brake = true;
      const prev = prevPad.get(pad.index) || [];
      const edge = (i) => pressed(i) && !prev[i];
      if (edge(PAD.A)) { out.slam = true; firePress('slam'); firePress('confirm'); }
      if (edge(PAD.B)) firePress('back');
      if (edge(PAD.START)) { out.pause = true; firePress('pause'); }
      if (edge(PAD.UP)) firePress('up');
      if (edge(PAD.DOWN)) firePress('down');
      if (edge(PAD.LEFT)) firePress('left');
      if (edge(PAD.RIGHT)) firePress('right');
      if (pressed(PAD.SELECT)) out.restartHeld = true;
      const now = pad.buttons.map((bt) => bt.pressed);
      if (now.some((p, i) => p && !prev[i])) out.any = true;
      prevPad.set(pad.index, now);
      if (out.any || out.rotate !== 0) api.lastDevice = 'gamepad';
    }
    return out;
  }

  const state = { rotate: 0, brake: false, slam: false, pause: false, restart: false, restartProgress: 0, any: false };

  api.poll = function poll(realDt = 0) {
    const pad = readPad();
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
    state.restartProgress = Math.min(1, restartHeldFor / restartHold);

    if (override) {
      state.rotate = override.rotate ?? 0;
      state.brake = !!override.brake;
      state.slam = state.slam || !!override.slam;
      override.slam = false; // slam override is a one-shot request
    }
    slamEdge = false; pauseEdge = false; anyEdge = false;
    return state;
  };

  api.setOverride = (o) => { override = o ? { ...o } : null; };
  api.onPress = (fn) => { pressListeners.add(fn); return () => pressListeners.delete(fn); };
  api.dispose = () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
    target.removeEventListener('pointerdown', onPointer);
    pressListeners.clear();
  };
  return api;
}
