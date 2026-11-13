/**
 * Shift 4 — "The Good Machine". The grinder: 100 % yield, but slow, and it JAMS if you feed it
 * more than a donor at a time. SLAM clears a jam.
 * Orientation (shifts 2-8): the drum STARTS UPSIDE DOWN (startAngle = pi). Donors land on the bare
 * 'ceiling' face; the machinery sits overhead in the middle of the 'floor' face. Reaching it takes a
 * deliberate half-turn and controlled tilting (or a flip: let them fall 10 m onto it). Mindless
 * left-right mashing only ever slides the crowd along a side wall into a corner — never across the
 * middle of a face — so it stays out of the machinery (see the balance notes in src/sim/README.md).
 * Layout: the grinder is a pit in the middle of the far face, a spike bed either side of it. Bring the face down, then tilt the crowd across the pit a few at a time.
 */
export default {
  id: 'shift-4',
  number: 4,
  name: 'The Good Machine',
  subtitle: 'It is very hungry.',
  lesson: 'The grinder converts every drop. Feed it slowly; SLAM clears a jam.',
  duration: 135,
  capacity: 135,
  quota: [40, 92, 120],
  startAngle: Math.PI,
  hatch: { wall: 'back', x: 0, y: -1.0, offset: 1.2 },
  hazards: [
    { type: 'grinder', wall: 'floor', at: 0, width: 2.6, z: [-2.2, 2.2] },
    { type: 'spikes', wall: 'floor', from: 3.5, to: 6.5, z: [-2.5, 2.5] },
    { type: 'spikes', wall: 'floor', from: -6.5, to: -3.5, z: [-2.5, 2.5] },
  ],
  waves: [
    { at: 1.5, count: 5 },
    { at: 32, count: 6 },
    { at: 64, count: 6 },
    { at: 96, count: 6 },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Shift four. Meet The Good Machine. It converts every drop.', mood: 'calm' },
    { at: 6, text: 'Tilt donors into the grinder. One or two at a time is plenty.', mood: 'calm' },
    { on: 'grinder:clog', text: 'The Good Machine is full. A firm SLAM will help it swallow.', mood: 'urgent' },
  ],
};
