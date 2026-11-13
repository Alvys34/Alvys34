/**
 * Shift 7 — "Rush Hour". Rail saws + a crusher + Thin-Bloods, dense waves.
 * The rail saw sweeps the left wall; the press slams down onto the right end of the floor on a
 * fixed beat (light + hiss first). Thin-Bloods drain completely from any wound — quantity over care.
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
  startAngle: 0,
  hatch: { wall: 'back', x: -1.5, y: 1.0, offset: 1.2 },
  hazards: [
    { type: 'railSaw', wall: 'left', from: -3.2, to: 3.2, z: [-2.5, 2.5], radius: 1.0, period: 5.5 },
    { type: 'crusher', wall: 'ceiling', at: 5.2, width: 2.8, z: [-2.5, 2.5], period: 5.0 },
    { type: 'spikes', wall: 'ceiling', from: -5, to: 0.5, z: [-2.5, 2.5] },
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
