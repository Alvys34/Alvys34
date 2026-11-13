/**
 * Shift 6 — "Breathe Easy". Oxygen tanks + Big Givers. Chain reactions.
 * A punctured tank rockets for ~2 s and explodes (severing limbs, puncturing other tanks).
 * Big Givers carry double blood, are hard to SLAM and squash whoever they land on from height.
 * Orientation (shifts 2-8): the drum STARTS UPSIDE DOWN (startAngle = pi). Donors land on the bare
 * 'ceiling' face; the machinery sits overhead in the middle of the 'floor' face. Reaching it takes a
 * deliberate half-turn and controlled tilting (or a flip: let them fall 10 m onto it). Mindless
 * left-right mashing only ever slides the crowd along a side wall into a corner — never across the
 * middle of a face — so it stays out of the machinery (see the balance notes in src/sim/README.md).
 * Layout: overhead, a spike bed and a saw side by side. Tip a tank onto them while the crowd is
 * clumped next to it; drop the Big Givers from height (they are too heavy to slam).
 */
export default {
  id: 'shift-6',
  number: 6,
  name: 'Breathe Easy',
  subtitle: 'Complimentary oxygen provided.',
  lesson: 'Puncture a tank next to the crowd. Big Givers are worth it.',
  duration: 130,
  capacity: 150,
  quota: [45, 120, 145],
  startAngle: Math.PI,
  hatch: { wall: 'back', x: 0, y: -1.0, offset: 1.2 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -3.0, to: 0.6, z: [-2.5, 2.5] },
    { type: 'saw', wall: 'floor', at: 3.0, z: [-2.5, 2.5], radius: 1.1, dir: -1 },
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
