/**
 * Shift 1 — "Orientation". Floor spikes only, 3 small waves. Teaches ROTATE (drop from height).
 *
 * LEVEL FORMAT (all levels follow this; coordinates are drum-local metres, drum = 16 x 10 x 5):
 * {
 *   id, number, name, subtitle,
 *   mode: 'shift',                 // optional; 'shift' default
 *   duration: s,                   // shift clock
 *   capacity: L,                   // litres that would fill the whole cross-section (pool speed)
 *   quota: [q1, q2, q3],           // litres for 1 / 2 / 3 drops
 *   startAngle: rad,               // initial drum angle
 *   hatch: { wall, at, offset? },  // intake hatch on a drum wall (tangent coord `at`)
 *   hazards: [ { type, wall, ... } ],   // see src/sim/hazards/*.js for each spec
 *   props: [ { type, at: s, pos: [x,y,z] } ],   // optional timed props
 *   waves: [ { at: s, count, types?: {standard: n, ...}, props?: [{type, count}] } ],
 *   advanceWhenClear: true,        // bring the next wave forward when nobody is alive
 *   pa: [ { at: s | on: 'event', text, mood } ],  // PA lines (on = bus event type, fires once)
 *   tunables: { ... }              // optional per-level overrides merged into TUNABLES
 * }
 */
export default {
  id: 'shift-1',
  number: 1,
  name: 'Orientation',
  subtitle: 'Welcome to the team.',
  duration: 110,
  capacity: 150,
  quota: [12, 28, 42],
  startAngle: 0,
  hatch: { wall: 'left', at: -2.6, offset: 1.0 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -3.0, to: 8.0, z: [-2.5, 2.5] },
  ],
  waves: [
    { at: 1.5, count: 4 },
    { at: 34, count: 5 },
    { at: 68, count: 6 },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Good morning, Operator. Donors are lightly sedated and very grateful.', mood: 'calm' },
    { at: 5, text: 'Hold A / D to rotate the drum. Gravity will handle the paperwork.', mood: 'calm' },
    { on: 'donor:death', text: 'Donation received. Thank you for your service.', mood: 'calm' },
    { at: 45, text: 'Reminder: donations from height are more generous.', mood: 'calm' },
    { on: 'donor:death', where: { cause: 'drown' }, text: 'Please do not let donors drown. It wastes product.', mood: 'urgent' },
  ],
};
