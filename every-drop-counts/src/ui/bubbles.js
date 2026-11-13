/**
 * Donor speech bubbles (donor:speak), anchored over the speaking donor's head by projecting the
 * drum-local head position through the drum group and the camera every frame.
 * Rate-limited: at most `max` visible, a minimum gap between new ones; extra lines are dropped
 * (donors repeat themselves anyway).
 *
 *   const bubbles = createBubbles({ root, view, canvas });
 *   bubbles.say(id, text); bubbles.update(simState, realDt); bubbles.clear(); bubbles.setLimits({max, gap})
 */
export function createBubbles({ root, view, canvas }) {
  const layer = document.createElement('div');
  layer.className = 'bubbles';
  layer.setAttribute('aria-hidden', 'true');
  root.appendChild(layer);
  const active = [];
  let gap = 0;
  let limits = { max: 3, gap: 0.9, life: 2.8 };
  let v3 = null;

  function say(id, text) {
    if (gap > 0 || !text) return;
    if (active.some((b) => b.id === id)) return;
    if (active.length >= limits.max) return;
    const el = document.createElement('div');
    el.className = 'bubble';
    el.textContent = text;
    layer.appendChild(el);
    active.push({ id, el, t: 0, life: limits.life + Math.min(1.5, text.length * 0.03), x: -9999, y: -9999 });
    gap = limits.gap;
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

  function update(state, dt) {
    gap = Math.max(0, gap - dt);
    if (!active.length) return;
    const rect = canvas.getBoundingClientRect();
    const vw = window.innerWidth; const vh = window.innerHeight;
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
      const w = b.el.offsetWidth || 120; const h = b.el.offsetHeight || 36;
      const lift = Math.max(28, vh * 0.045);
      const x = Math.max(8 + w / 2, Math.min(vw - 8 - w / 2, b.x));
      const y = Math.max(8 + h, Math.min(vh - 8, b.y - lift));
      const fadeIn = Math.min(1, b.t / 0.15); const fadeOut = Math.min(1, (b.life - b.t) / 0.35);
      b.el.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(y - h).toFixed(1)}px) scale(${(0.85 + 0.15 * fadeIn).toFixed(3)})`;
      b.el.style.opacity = String(Math.min(fadeIn, fadeOut));
    }
  }

  function clear() { for (const b of active) b.el.remove(); active.length = 0; gap = 0; }

  return {
    say, update, clear,
    setLimits(l) { limits = { ...limits, ...l }; },
    setVisible(v) { layer.hidden = !v; if (!v) clear(); },
    dispose() { clear(); layer.remove(); },
  };
}
