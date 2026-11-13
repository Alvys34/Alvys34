/**
 * Screen stack + focus navigation for keyboard, gamepad and mouse.
 *
 *   const nav = createNav({ bus, root });   nav.handle(action, ev, info)  (the app routes input.onPress here)
 *   nav.push(screen) / nav.replace(screen) / nav.pop() / nav.clear() / nav.top
 *   screen = {
 *     name, el,                      // root element (gets .on / inert)
 *     focus?: Element,               // initial focus (else first [data-focus])
 *     wrap?: bool,                   // up/down wrap around
 *     onBack?(), onPause?(), onConfirm?() -> true if handled, onTab?(dir),
 *     onEnter?(), onLeave?(), onKey?(action, info, ev) -> true if handled (raw access)
 *   }
 * Focusable elements: [data-focus]. Activation: el.__activate (else el.click()).
 * Left/right on an element with el.__adjust(dir) adjusts it (sliders, choices) instead of moving.
 * Emits ui:hover (focus moved), ui:click (activated), ui:back (back) on the bus for audio.
 */
export function createNav({ bus, root }) {
  const stack = [];
  let focused = null;
  let enabled = true;

  const visibleFocusables = (scr) => [...scr.el.querySelectorAll('[data-focus]')].filter((e) => !e.closest('[hidden]') && e.offsetParent !== null);

  function setFocus(el, { sound = true } = {}) {
    if (!el) return;
    if (focused === el) return;
    if (focused) focused.classList.remove('is-focus');
    focused = el;
    el.classList.add('is-focus');
    try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
    const top = stack[stack.length - 1];
    if (top) { top.lastFocus = el; if (top.onFocus) top.onFocus(el); }
    if (sound) bus.emit('ui:hover', {});
  }

  function activate(el) {
    if (!el) return;
    if (el.getAttribute('aria-disabled') === 'true') { bus.emit('ui:back', {}); el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); return; }
    if (!el.dataset.silent) bus.emit('ui:click', {});
    if (typeof el.__activate === 'function') el.__activate();
    else el.click();
  }

  function rect(e) { return e.getBoundingClientRect(); }

  function move(dir) {
    const top = stack[stack.length - 1];
    if (!top) return;
    const list = visibleFocusables(top);
    if (!list.length) return;
    if (!focused || !list.includes(focused)) { setFocus(list[0]); return; }
    const r0 = rect(focused);
    const c0x = (r0.left + r0.right) / 2; const c0y = (r0.top + r0.bottom) / 2;
    const vertical = dir === 'up' || dir === 'down';
    let best = null; let bestScore = Infinity;
    for (const el of list) {
      if (el === focused) continue;
      const r = rect(el);
      const cx = (r.left + r.right) / 2; const cy = (r.top + r.bottom) / 2;
      const dx = cx - c0x; const dy = cy - c0y;
      const primary = dir === 'down' ? dy : dir === 'up' ? -dy : dir === 'right' ? dx : -dx;
      if (primary <= 2) continue;
      const overlap = vertical ? Math.min(r.right, r0.right) - Math.max(r.left, r0.left) : Math.min(r.bottom, r0.bottom) - Math.max(r.top, r0.top);
      const secondary = Math.abs(vertical ? dx : dy);
      const score = primary + secondary * (overlap > 0 ? 0.25 : 2.5);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best && top.wrap && vertical) best = dir === 'down' ? list[0] : list[list.length - 1];
    if (best) setFocus(best);
  }

  function onPress(action, ev, info = {}) {
    if (!enabled) return;
    const top = stack[stack.length - 1];
    if (!top) return;
    if (ev && (action === 'confirm' || action === 'back') && ev.preventDefault) ev.preventDefault();
    if (top.onKey && top.onKey(action, info, ev)) return;
    switch (action) {
      case 'up': case 'down': case 'left': case 'right': {
        if ((action === 'left' || action === 'right') && focused && typeof focused.__adjust === 'function' && stack[stack.length - 1].el.contains(focused)) {
          focused.__adjust(action === 'left' ? -1 : 1, info);
          return;
        }
        move(action);
        return;
      }
      case 'confirm':
        if (info.repeat) return;
        if (top.onConfirm && top.onConfirm()) return;
        if (focused && top.el.contains(focused)) activate(focused);
        else { const l = visibleFocusables(top); if (l[0]) setFocus(l[0]); }
        return;
      case 'back':
        if (top.onBack) { bus.emit('ui:back', {}); top.onBack(); }
        return;
      case 'pause':
        if (top.onPause) top.onPause();
        return;
      case 'prevTab': case 'nextTab':
        if (top.onTab) top.onTab(action === 'prevTab' ? -1 : 1);
        return;
      default:
    }
  }

  // mouse: hover focuses, click activates; Tab focus sync
  function focusTarget(t) {
    const top = stack[stack.length - 1];
    if (!top || !t || !t.closest) return null;
    const el = t.closest('[data-focus]');
    return el && top.el.contains(el) ? el : null;
  }
  const onOver = (e) => { const el = focusTarget(e.target); if (el && el !== focused) setFocus(el); };
  const onClick = (e) => {
    const el = focusTarget(e.target);
    if (!el) return;
    e.preventDefault();
    if (e.detail === 0) return; // keyboard-synthesised click: handled via onPress
    setFocus(el, { sound: false });
    activate(el);
  };
  const onFocusIn = (e) => { const el = focusTarget(e.target); if (el && el !== focused) setFocus(el); };
  root.addEventListener('pointerover', onOver);
  root.addEventListener('click', onClick);
  root.addEventListener('focusin', onFocusIn);

  function show(scr, on) {
    scr.el.classList.toggle('on', on);
    if (on) { scr.el.removeAttribute('inert'); scr.el.hidden = false; } else scr.el.setAttribute('inert', '');
  }

  function enter(scr, restore) {
    show(scr, true);
    if (scr.onEnter) scr.onEnter();
    const list = visibleFocusables(scr);
    const target = (restore && scr.lastFocus && list.includes(scr.lastFocus)) ? scr.lastFocus : (scr.focus && list.includes(scr.focus) ? scr.focus : list[0]);
    focused = null;
    for (const e of scr.el.querySelectorAll('.is-focus')) e.classList.remove('is-focus');
    if (target) setFocus(target, { sound: false });
  }
  function leave(scr, keepVisible = false) {
    if (scr.onLeave) scr.onLeave();
    if (!keepVisible) show(scr, false); else scr.el.setAttribute('inert', '');
  }

  const api = {
    get top() { return stack[stack.length - 1] || null; },
    get depth() { return stack.length; },
    get focused() { return focused; },
    has(name) { return stack.some((s) => s.name === name); },
    push(scr, { keepBelow = false } = {}) {
      const prev = stack[stack.length - 1];
      if (prev) leave(prev, keepBelow);
      stack.push(scr);
      enter(scr, false);
      return scr;
    },
    replace(scr) {
      const prev = stack.pop();
      if (prev) leave(prev);
      stack.push(scr);
      enter(scr, false);
      return scr;
    },
    pop() {
      const prev = stack.pop();
      if (prev) leave(prev);
      const top = stack[stack.length - 1];
      if (top) enter(top, true);
      return top || null;
    },
    /** Pop until the screen named `name` is on top (inclusive=false) */
    popTo(name) {
      while (stack.length && stack[stack.length - 1].name !== name) { const s = stack.pop(); leave(s); }
      const top = stack[stack.length - 1];
      if (top) enter(top, true);
      return top;
    },
    clear() { while (stack.length) leave(stack.pop()); focused = null; },
    setFocus,
    handle: onPress,
    refocus() { const top = stack[stack.length - 1]; if (top) { const l = visibleFocusables(top); if (!l.includes(focused) && l[0]) setFocus(l[0], { sound: false }); } },
    setEnabled(v) { enabled = !!v; },
    dispose() {
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('click', onClick);
      root.removeEventListener('focusin', onFocusIn);
    },
  };
  return api;
}
