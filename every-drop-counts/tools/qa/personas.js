// Scripted "humans" for the QA playtest (browser-side, loaded through the Vite dev server).
// Each persona: (s = sim.state, t = sim time, mem) -> { rotate, brake, slam }. Human-ish: they
// only use the verbs, react with latency, and do not read hidden state beyond what is on screen.
import { POLICIES } from '/tools/policies.mjs';

const ready = (s) => s.drum && s.drum.slamCooldown <= 0;

export const PERSONAS = {
  /** reads the PA for 6 s, then short taps (0.25 s) with 2 s pauses, 3 taps per direction,
   *  tries SLAM once every ~15 s once it has "noticed" the button (after 20 s) */
  cautious(s, t, m) {
    if (t < 6) return { rotate: 0 };
    const k = Math.floor((t - 6) / 2.25);
    const inTap = (t - 6) % 2.25 < 0.25;
    const dir = Math.floor(k / 3) % 2 ? -1 : 1;
    const slam = t > 20 && Math.floor(t / 15) !== m.lastSlamBlock && ready(s);
    if (slam) m.lastSlamBlock = Math.floor(t / 15);
    return { rotate: inTap ? dir : 0, brake: false, slam };
  },
  /** holds a direction 3 s, flips, holds 3 s ... and hammers SLAM whenever it can */
  masher(s, t, m) {
    const dir = Math.floor(t / 3) % 2 ? -1 : 1;
    return { rotate: dir, brake: false, slam: ready(s) };
  },
  /** holds one direction forever (the "is it a washing machine?" player) */
  holder(s, t, m) { return { rotate: 1, brake: false, slam: false }; },
  /** the thinker = the smart bot with human latency: decides every 0.3 s, holds the decision,
   *  takes 3 s to read the room first */
  thinker(s, t, m) {
    if (t < 3) return { rotate: 0 };
    if (m.next == null || t >= m.next) {
      m.next = t + 0.3;
      m.memInner = m.memInner || {};
      m.cur = POLICIES.smart(s, t, m.memInner) || { rotate: 0 };
    }
    const out = { ...m.cur };
    if (out.slam) m.cur = { ...m.cur, slam: false }; // one press per decision
    return out;
  },
};
for (const k of Object.keys(POLICIES)) if (!PERSONAS[k]) PERSONAS[k] = POLICIES[k];
