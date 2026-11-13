/**
 * Donor speech bubbles (donor:speak), anchored over the speaking donor's head by projecting the
 * drum-local head position through the drum group and the camera every frame.
 * Rate-limited: at most `max` visible (≤ 3), a minimum gap between new ones, never the same line
 * twice at once, and a new line whose speaker sits where an existing bubble is drawn is dropped
 * (donors repeat themselves anyway). Bubbles that drift into each other later are stacked upward.
 * Also draws short-lived world popups (e.g. "−2.4 L wasted" at a drowned donor).
 *
 *   const bubbles = createBubbles({ root, view, canvas });
 *   bubbles.say(id, text); bubbles.update(simState, realDt); bubbles.clear(); bubbles.setLimits({max, gap})
 *   bubbles.popup(key, [x, y, z] drum-local, text, cls)
 */
const MAX_BUBBLES = 3;

export function createBubbles({ root, view, canvas }) {
  const layer = document.createElement('div');
  layer.className = 'bubbles';
  layer.setAttribute('aria-hidden', 'true');
  root.appendChild(layer);
  const pops = document.createElement('div');
  pops.className = 'popups';
  pops.setAttribute('aria-hidden', 'true');
  root.appendChild(pops);
  const active = [];
  const popups = [];
  let gap = 0;
  let limits = { max: 3, gap: 0.9, life: 2.8 };
  let v3 = null;
  let lastState = null;

  const headOf = (state, id) => {
    if (!state || !state.donors) return null;
    for (const d of state.donors) if (d.id === id) { const h = d.parts && d.parts.head; return h && !h.removed ? h : null; }
    return null;
  };
  /** screen rect a bubble would occupy (estimate from text length before it is laid out) */
  const estRect = (x, y, text) => {
    const w = Math.min(13 * 16, 20 + String(text).length * 7.2); const h = String(text).length > 26 ? 50 : 32;
    const lift = Math.max(28, (window.innerHeight || 720) * 0.045);
    return { l: x - w / 2, r: x + w / 2, t: y - lift - h, b: y - lift };
  };
  const hit = (a, b, pad = 6) => a.l < b.r + pad && b.l < a.r + pad && a.t < b.b + pad && b.t < a.b + pad;

  function say(id, text) {
    if (gap > 0 || !text) return;
    if (active.some((b) => b.id === id || b.text === text)) return;
    if (active.length >= Math.min(MAX_BUBBLES, limits.max)) return;
    // skip a line whose speaker is where another bubble is drawn (crowds)
    const head = headOf(lastState, id);
    if (head && active.length) {
      const p = project(head.x, head.y, head.z, canvas.getBoundingClientRect());
      if (p) {
        const r = estRect(p[0], p[1], text);
        if (active.some((b) => b.rect && hit(r, b.rect))) return;
      }
    }
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text;
    layer.appendChild(el);
    active.push({ id, text, el, t: 0, life: limits.life + Math.min(1.5, text.length * 0.03), x: -9999, y: -9999, rect: null });
    gap = limits.gap;
  }

  /** Floating label at a drum-local point (rises and fades over ~1.8 s). Same key replaces. */
  function popup(key, pos, text, cls = '') {
    dropPopup(key);
    const el = document.createElement('div');
    el.className = `popup ${cls}`;
    el.textContent = text;
    pops.appendChild(el);
    popups.push({ key, el, pos: pos.slice(0, 3), t: 0, life: 1.9 });
    while (popups.length > 6) { const o = popups.shift(); o.el.remove(); }
  }
  function dropPopup(key) {
    for (let i = popups.length - 1; i >= 0; i--) if (popups[i].key === key) { popups[i].el.remove(); popups.splice(i, 1); }
  }

  function project(x, y, z, rect) {
    const ctx = view && view.ctx;
    if (!ctx || !ctx.THREE || !ctx.camera || !ctx.drumGroup) return null;
    if (!v3) v3 = new ctx.THREE.Vector3();
    v3.set(x, y, z);
    ctx.drumGroup.localToWorld(v3);
    v3.project(ctx.camera);
    if (v3.z > 1 || v3.z < -1) return null;
    return [rect.left + (v3.x + 1) * 0.5 * rect.width, rect.top + (1 - v3.y) * 0.5 * rect.height];
  }

  function updatePopups(dt, rect) {
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.t += dt;
      if (p.t >= p.life) { p.el.remove(); popups.splice(i, 1); continue; }
      const s = project(p.pos[0], p.pos[1], p.pos[2], rect);
      if (!s) { p.el.style.opacity = '0'; continue; }
      const w = p.el.offsetWidth || 90;
      const rise = 18 + p.t * 34;
      const a = Math.min(1, p.t / 0.15) * Math.min(1, (p.life - p.t) / 0.5);
      p.el.style.transform = `translate(${(s[0] - w / 2).toFixed(1)}px, ${(s[1] - rise).toFixed(1)}px)`;
      p.el.style.opacity = a.toFixed(3);
    }
  }

  function update(state, dt) {
    gap = Math.max(0, gap - dt);
    lastState = state;
    if (!active.length && !popups.length) return;
    const rect = canvas.getBoundingClientRect();
    if (popups.length) updatePopups(dt, rect);
    if (!active.length) return;
    const vw = window.innerWidth; const vh = window.innerHeight;
    const placed = [];
    for (let i = active.length - 1; i >= 0; i--) {
      const b = active[i];
      b.t += dt;
      let donor = null;
      if (state && state.donors) for (const d of state.donors) if (d.id === b.id) { donor = d; break; }
      const head = donor && donor.parts && donor.parts.head;
      const dead = !donor || !donor.alive || !head || head.removed;
      if (dead && b.t < b.life - 0.35) b.t = b.life - 0.35; // fade out early when the speaker is gone
      if (b.t >= b.life) { b.el.remove(); active.splice(i, 1); continue; }
      if (head && !head.removed) {
        const p = project(head.x, head.y, head.z, rect);
        if (p) { b.x = p[0]; b.y = p[1]; }
      }
    }
    // place oldest first; a bubble that would overlap an already placed one is stacked above it
    for (const b of active) {
      const w = b.el.offsetWidth || 120; const h = b.el.offsetHeight || 36;
      const lift = Math.max(28, vh * 0.045);
      const x = Math.max(8 + w / 2, Math.min(vw - 8 - w / 2, b.x));
      let y = Math.max(8 + h, Math.min(vh - 8, b.y - lift));
      let r = { l: x - w / 2, r: x + w / 2, t: y - h, b: y };
      for (let k = 0; k < placed.length; k++) {
        const o = placed[k];
        if (hit(r, o, 4)) { y = o.t - 6; r = { l: r.l, r: r.r, t: y - h, b: y }; k = -1; }
      }
      placed.push(r);
      b.rect = r;
      const fadeIn = Math.min(1, b.t / 0.15); const fadeOut = Math.min(1, (b.life - b.t) / 0.35);
      b.el.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(y - h).toFixed(1)}px) scale(${(0.85 + 0.15 * fadeIn).toFixed(3)})`;
      b.el.style.opacity = String(Math.min(fadeIn, fadeOut));
    }
  }

  function clear() {
    for (const b of active) b.el.remove(); active.length = 0; gap = 0;
    for (const p of popups) p.el.remove(); popups.length = 0;
  }

  return {
    say, update, clear, popup, dropPopup,
    setLimits(l) { limits = { ...limits, ...l }; },
    setVisible(v) { layer.hidden = !v; if (!v) { for (const b of active) b.el.remove(); active.length = 0; } },
    dispose() { clear(); layer.remove(); pops.remove(); },
  };
}
