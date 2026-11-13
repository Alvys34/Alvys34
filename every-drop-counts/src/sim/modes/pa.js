/**
 * PA announcement script runner. Entries: { at: seconds } or { on: 'bus:event', where?: {field: value} }
 * plus { text, mood: 'calm'|'urgent'|'glitch' }. Each entry fires once.
 */
export function createPaScript(ctx, entries) {
  const timed = entries.filter((e) => typeof e.at === 'number').sort((a, b) => a.at - b.at);
  const offs = [];
  for (const e of entries) {
    if (!e.on) continue;
    let fired = false;
    offs.push(ctx.bus.on(e.on, (payload) => {
      if (fired) return;
      if (e.where && !Object.entries(e.where).every(([k, v]) => payload && payload[k] === v)) return;
      fired = true;
      // defer to the next step so the PA never fires inside another emit
      ctx.deferred.push(() => ctx.emit('pa:announce', { text: e.text, mood: e.mood || 'calm' }));
    }));
  }
  ctx.disposers.push(() => offs.forEach((off) => off()));
  let i = 0;
  return {
    step(c, t) {
      while (i < timed.length && t >= timed[i].at) {
        const e = timed[i++];
        c.emit('pa:announce', { text: e.text, mood: e.mood || 'calm' });
      }
    },
  };
}
