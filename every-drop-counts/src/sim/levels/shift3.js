/**
 * Shift 3 — "High Tide". Big quota, SMALL tank: the pool rises fast. Teaches floating / drowning.
 * Orientation (shifts 2-8): the drum STARTS UPSIDE DOWN (startAngle = pi). Donors land on the bare
 * 'ceiling' face; the machinery sits overhead in the middle of the 'floor' face. Reaching it takes a
 * deliberate half-turn and controlled tilting (or a flip: let them fall 10 m onto it). Mindless
 * left-right mashing only ever slides the crowd along a side wall into a corner — never across the
 * middle of a face — so it stays out of the machinery (see the balance notes in src/sim/README.md).
 * Layout: a wide spike bed overhead that will be under the surface within a minute once it is down,
 * and two saws on long arms on the landing face — above the crowd at first, at the WATERLINE once the
 * tank fills (flip the drum and they hang over the pool). Living donors whose heads stay under for
 * 6 s drown (no yield). Kill them before the tide does.
 */
export default {
  id: 'shift-3',
  number: 3,
  name: 'High Tide',
  subtitle: 'Please keep your head above water.',
  lesson: 'The pool lifts everything. Bottom hazards drown; use the waterline.',
  duration: 125,
  capacity: 80,
  quota: [34, 62, 86],
  startAngle: Math.PI,
  hatch: { wall: 'back', x: 0, y: -1.0, offset: 1.2 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -3.0, to: 3.0, z: [-2.5, 2.5] },
    { type: 'saw', wall: 'ceiling', at: -3.6, offset: 2.9, z: [-2.5, 2.5], radius: 1.15, dir: 1 },
    { type: 'saw', wall: 'ceiling', at: 3.6, offset: 2.9, z: [-2.5, 2.5], radius: 1.15, dir: -1 },
  ],
  waves: [
    { at: 1.5, count: 6 },
    { at: 28, count: 6 },
    { at: 56, count: 7 },
    { at: 86, count: 7 },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Shift three. Due to budget constraints, today\'s tank is compact.', mood: 'calm' },
    { at: 40, text: 'Donors float. Donors also drown. Please choose the first one.', mood: 'calm' },
    { on: 'donor:death', where: { cause: 'drown' }, text: 'A donor has drowned. That product is now pool water.', mood: 'urgent' },
  ],
};
