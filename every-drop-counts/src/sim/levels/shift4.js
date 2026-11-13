/**
 * Shift 4 — "The Good Machine". The grinder: 100 % yield, but slow, and it JAMS if you feed it
 * more than one donor at a time. SLAM clears a jam.
 * Layout: the grinder is a pit in the middle of the floor; donors land on the bare left end —
 * tilt them across to it a few at a time. A short ceiling bed is there for the late pool / flips,
 * and a small saw on the right end of the floor punishes over-tilting.
 */
export default {
  id: 'shift-4',
  number: 4,
  name: 'The Good Machine',
  subtitle: 'It is very hungry.',
  lesson: 'The grinder converts every drop. Feed it slowly; SLAM clears a jam.',
  duration: 135,
  capacity: 135,
  quota: [36, 70, 100],
  startAngle: 0,
  hatch: { wall: 'back', x: -5.0, y: 1.0, offset: 1.2 },
  hazards: [
    { type: 'grinder', wall: 'floor', at: 0.6, width: 2.6, z: [-2.2, 2.2] },
    { type: 'saw', wall: 'floor', at: 5.6, z: [-2.5, 2.5], radius: 0.95, dir: 1 },
    { type: 'spikes', wall: 'ceiling', from: -3, to: 3, z: [-2.5, 2.5] },
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
