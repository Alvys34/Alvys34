/** Tiny DOM helpers for the UI (no framework). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Element from an HTML string (single root). */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const fmtL = (v, d = 1) => (Number(v) || 0).toFixed(d);
export const fmtClock = (s) => { const t = Math.max(0, Math.round(Number(s) || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export const pad2 = (n) => String(n).padStart(2, '0');

/** Wire a [data-focus] element's activation. */
export function onActivate(el, fn) { el.__activate = fn; return el; }
