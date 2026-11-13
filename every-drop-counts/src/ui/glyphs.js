/**
 * Button glyphs that follow the last-used device. Put `<span data-glyph="slam"></span>` anywhere in
 * UI markup; refreshGlyphs(root, device) fills them. Keyboard = keycaps, gamepad = face-button
 * circles / trigger tabs (labels A/B/X/Y match Xbox-layout pads and Steam Deck).
 */
const KEY = (t, wide = false) => `<span class="glyph key${wide ? ' wide' : ''}">${t}</span>`;
const BTN = (t) => `<span class="glyph btn">${t}</span>`;
const TRIG = (t) => `<span class="glyph trig">${t}</span>`;
const STICK = (t) => `<span class="glyph stick">${t}</span>`;
const DPAD = '<span class="glyph dpad"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></span>';
const OR = '<span class="glyph-or">/</span>';

export const GLYPHS = {
  keyboard: {
    rotate: KEY('A') + KEY('D'),
    rotateArrows: KEY('←') + KEY('→'),
    brake: KEY('S'),
    slam: KEY('Space', true),
    pause: KEY('Esc', true),
    restart: KEY('R'),
    confirm: KEY('Enter', true),
    back: KEY('Esc', true),
    adjust: KEY('←') + KEY('→'),
    move: KEY('↑') + KEY('↓'),
    tabs: KEY('Q') + KEY('E'),
  },
  gamepad: {
    rotate: STICK('LS') + OR + TRIG('LT') + TRIG('RT'),
    rotateArrows: TRIG('LT') + TRIG('RT'),
    brake: BTN('X'),
    slam: BTN('A'),
    pause: KEY('Start', true),
    restart: KEY('Select', true),
    confirm: BTN('A'),
    back: BTN('B'),
    adjust: DPAD,
    move: DPAD,
    tabs: TRIG('LB') + TRIG('RB'),
  },
};

export function glyph(action, device = 'keyboard') {
  const set = GLYPHS[device] || GLYPHS.keyboard;
  return set[action] || '';
}

export function refreshGlyphs(root, device = 'keyboard') {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-glyph]')) {
    const html = glyph(el.dataset.glyph, device);
    if (el.__glyph !== html) { el.innerHTML = html; el.__glyph = html; }
  }
}
