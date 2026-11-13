/**
 * Shift 4 — "The Good Machine". The grinder: 100 % yield, but slow, and it JAMS if you feed it
 * more than one donor at a time. SLAM clears a jam.
 * Layout: the grinder sits on the RIGHT wall (tilt it down to feed it); a single saw on the left
 * wall and a short ceiling bed are there for impatience and for the late pool.
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
  hatch: { wall: 'back', x: -3, y: 1.0, offset: 1.2 },
  hazards: [
    { type: 'grinder', wall: 'right', at: -0.6, width: 2.6, z: [-2.2, 2.2] },
    { type: 'saw', wall: 'left', at: -2.0, z: [-2.5, 0.4], radius: 1.1, dir: 1 },
    { type: 'spikes', wall: 'ceiling', from: -2.5, to: 2.5, z: [-2.5, 2.5] },
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
    { at: 6, text: 'Tilt donors into the grinder. One at a time is plenty.', mood: 'calm' },
    { on: 'grinder:clog', text: 'The Good Machine is full. A firm SLAM will help it swallow.', mood: 'urgent' },
  ],
};
