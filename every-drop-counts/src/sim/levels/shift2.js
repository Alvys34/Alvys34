/**
 * Shift 2 — "Sharp Objects". Wall saws (each covering part of the depth) + ceiling spikes.
 * Teaches SLAM (throw donors into the ceiling spikes, shake impaled donors loose).
 * Format: see shift1.js.
 */
export default {
  id: 'shift-2',
  number: 2,
  name: 'Sharp Objects',
  subtitle: 'Mind the edges.',
  duration: 130,
  capacity: 140,
  quota: [45, 85, 125],
  startAngle: 0,
  hatch: { wall: 'back', x: 0, y: 1.0, offset: 1.2 },
  hazards: [
    { type: 'saw', wall: 'left', at: -3.0, z: [-2.5, 0.4], radius: 1.15, dir: 1 },
    { type: 'saw', wall: 'right', at: -1.2, z: [-0.4, 2.5], radius: 1.15, dir: -1 },
    { type: 'spikes', wall: 'ceiling', from: -7.0, to: 2.6, z: [-2.5, 2.5] },
  ],
  waves: [
    { at: 1.5, count: 5 },
    { at: 30, count: 6 },
    { at: 62, count: 6 },
    { at: 94, count: 7 },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Shift two. New equipment has been installed for your convenience.', mood: 'calm' },
    { at: 4, text: 'Press SPACE to SLAM. Donors appreciate a firm hand.', mood: 'calm' },
    { on: 'limb:sever', text: 'Partial donations are still donations.', mood: 'calm' },
    { on: 'donor:death', where: { cause: 'drown' }, text: 'Drowned donors yield nothing. Please be mindful.', mood: 'urgent' },
    { at: 70, text: 'The tank is filling nicely. Headroom is a privilege.', mood: 'calm' },
  ],
};
