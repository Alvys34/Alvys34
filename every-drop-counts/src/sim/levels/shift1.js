/**
 * Shift 1 — "Orientation". Floor spikes only, 3 small waves. Teaches ROTATE (drop from height).
 * Layout: one spike bed in the MIDDLE of the floor; donors arrive over the bare left end. Sliding
 * across the bed barely scratches them (spikes need ~10 m/s); lift the crowd (rotate it up a wall /
 * over the top) and let it fall onto the bed. The first drop is deliberately generous (tutorial:
 * any active play — rocking, tumbling, flipping, slamming — clears it); 2–3 drops need aimed drops.
 * Teaching hints (level.hints): pinned at max speed / no blood after 15 s.
 *
 * LEVEL FORMAT (all levels follow this; coordinates are drum-local metres, drum = 16 x 10 x 5):
 * {
 *   id, number, name, subtitle,
 *   mode: 'shift',                 // optional; 'shift' default
 *   duration: s,                   // shift clock
 *   capacity: L,                   // litres that would fill the whole cross-section (Overtime and
 *                                  //   fillCurve: false only; shift mode uses the quota fill curve)
 *   fillCurve: { atQ1, fullAt } | false,  // optional: pool fill vs litres (src/sim/pool.js)
 *   quota: [20, 42, 54],           // litres for 1 / 2 / 3 drops
 *   startAngle: rad,               // initial drum angle
 *   hatch: { wall, at, offset? },  // intake hatch on a drum wall (tangent coord `at`), or
 *          { wall: 'back', x, y } // a chute in the back wall: donors drop from mid-drum
 *   hazards: [ { type, wall, ... } ],   // see src/sim/hazards/*.js for each spec
 *   props: [ { type, at: s, pos: [x,y,z] } ],   // optional timed props
 *   waves: [ { at: s, count, types?: {standard: n, ...}, props?: [{type, count}] } ],
 *   advanceWhenClear: true,        // bring the next wave forward when nobody is alive
 *   waveGap: s,                    // optional: a regular wave opens at most this long after the
 *                                  //   previous one (per-wave `gap` overrides); `at` then only
 *                                  //   places the first wave. Waves with `fixed: true` (Inspector
 *                                  //   visits) keep their own `at` (see src/sim/modes/shift.js)
 *   pa: [ { at: s | on: 'event', text, mood } ],  // PA lines (on = bus event type, fires once)
 *   tunables: { ... }              // optional per-level overrides merged into TUNABLES
 * }
 */
export default {
  id: 'shift-1',
  number: 1,
  name: 'Orientation',
  subtitle: 'Welcome to the team.',
  lesson: 'Rotate the drum. Donations from height are more generous.',
  duration: 105,
  capacity: 150,
  fillCurve: false, // tutorial: legacy linear pool (litres / capacity), the floor bed stays dry
  quota: [6, 35, 48],
  startAngle: 0,
  hatch: { wall: 'back', x: -4.6, y: 0.5, offset: 1.2 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -2.6, to: 3.4, z: [-2.5, 2.5] },
  ],
  hints: {
    pinned: { text: 'Operator reminder: donors pinned to the wall are not donating. Ease off the throttle.' },
    noBlood: { after: 15, text: 'Operator reminder: drop them from height onto the spikes.' },
  },
  waves: [
    { at: 1.5, count: 4 },
    { at: 32, count: 5 },
    { at: 64, count: 6 },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Good morning, Operator. Donors are lightly sedated and very grateful.', mood: 'calm' },
    { at: 4, text: 'Hold A / D to rotate the drum. Gravity will handle the paperwork.', mood: 'calm' },
    { on: 'donor:death', text: 'Donation received. Thank you for your service.', mood: 'calm' },
    { at: 26, text: 'Reminder: donations from height are more generous.', mood: 'calm' },
    { on: 'donor:death', where: { cause: 'impact' }, text: 'Bruising is not a donation. Please use the equipment.', mood: 'calm' },
    { on: 'donor:death', where: { cause: 'drown' }, text: 'Please do not let donors drown. It wastes product.', mood: 'urgent' },
  ],
};
