/**
 * Shift 7 — "Rush Hour". Rail saws + a crusher + Thin-Bloods, dense waves.
 * Orientation (shifts 2-8): the drum STARTS UPSIDE DOWN (startAngle = pi). Donors land on the bare
 * 'ceiling' face; the machinery sits overhead in the middle of the 'floor' face. Reaching it takes a
 * deliberate half-turn and controlled tilting (or a flip: let them fall 10 m onto it). Mindless
 * left-right mashing only ever slides the crowd along a side wall into a corner — never across the
 * middle of a face — so it stays out of the machinery (see the balance notes in src/sim/README.md).
 * Layout: overhead, a rail saw sweeps the middle of the far face. A press hangs from the far face at
 * the left end and slams down onto the landing face on a fixed beat (light + hiss first): line the
 * crowd up under it in time — or bring them up to the rail saw. Thin-Bloods drain completely from
 * any wound: quantity over care.
 */
export default {
  id: 'shift-7',
  number: 7,
  name: 'Rush Hour',
  subtitle: 'Please keep the line moving.',
  lesson: 'Rhythm: line the crowd up under the press, time the rail saw.',
  duration: 140,
  capacity: 165,
  quota: [52, 100, 140],
  startAngle: Math.PI,
  hatch: { wall: 'back', x: 0, y: -1.0, offset: 1.2 },
  hazards: [
    { type: 'railSaw', wall: 'floor', from: -2.4, to: 2.4, z: [-2.5, 2.5], radius: 1.0, period: 5.5 },
    { type: 'crusher', wall: 'floor', at: -5.2, width: 2.8, z: [-2.5, 2.5], period: 5.0 },
  ],
  waves: [
    { at: 1.5, count: 7, types: { standard: 4, thinBlood: 3 } },
    { at: 26, count: 7, types: { standard: 4, thinBlood: 3 } },
    { at: 52, count: 8, types: { standard: 4, thinBlood: 4 } },
    { at: 80, count: 8, types: { standard: 5, thinBlood: 3 } },
    { at: 108, count: 6, types: { standard: 3, thinBlood: 3 } },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Rush hour. Donors with red wristbands are Thin-Bloods. Handle with enthusiasm.', mood: 'calm' },
    { on: 'hazard:telegraph', text: 'When the light comes on, the press comes down. That is the whole system.', mood: 'calm' },
  ],
};
