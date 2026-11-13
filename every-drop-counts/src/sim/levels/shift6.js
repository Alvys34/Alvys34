/**
 * Shift 6 — "Breathe Easy". Oxygen tanks + Big Givers. Chain reactions.
 * A punctured tank rockets for ~2 s and explodes (severing limbs, puncturing other tanks).
 * Big Givers carry double blood, are hard to SLAM and squash whoever they land on.
 * Layout: donors and tanks land on the bare left end. A spike bed in the middle of the floor and a
 * saw right of it — tip a tank onto them while the crowd is clumped next to it. Ceiling bed for
 * flips and the late pool.
 */
export default {
  id: 'shift-6',
  number: 6,
  name: 'Breathe Easy',
  subtitle: 'Complimentary oxygen provided.',
  lesson: 'Puncture a tank next to the crowd. Big Givers are worth it.',
  duration: 130,
  capacity: 150,
  quota: [40, 82, 118],
  startAngle: 0,
  hatch: { wall: 'back', x: -5.0, y: 1.0, offset: 1.2 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -2.6, to: 0.8, z: [-2.5, 2.5] },
    { type: 'saw', wall: 'floor', at: 3.2, z: [-2.5, 2.5], radius: 1.15, dir: -1 },
    { type: 'spikes', wall: 'ceiling', from: -4, to: 4, z: [-2.5, 2.5] },
  ],
  waves: [
    { at: 1.5, count: 5, types: { standard: 4, bigGiver: 1 }, props: [{ type: 'oxygenTank', count: 2 }] },
    { at: 32, count: 5, types: { standard: 3, bigGiver: 2 }, props: [{ type: 'oxygenTank', count: 2 }] },
    { at: 64, count: 6, types: { standard: 4, bigGiver: 2 }, props: [{ type: 'oxygenTank', count: 3 }] },
    { at: 96, count: 5, types: { standard: 3, bigGiver: 2 }, props: [{ type: 'oxygenTank', count: 2 }] },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Shift six. Complimentary oxygen has been provided. Please do not puncture it near anyone you like.', mood: 'calm' },
    { on: 'prop:explode', text: 'Pressure event logged. Excellent coverage.', mood: 'calm' },
    { at: 34, text: 'Our Big Givers are giving big. Please make room.', mood: 'calm' },
  ],
};
