/**
 * Shift 2 — "Sharp Objects". Wall saws + ceiling spikes. Teaches SLAM.
 * Layout: the saws hang on the side walls ~3 m above the floor corners — a crowd resting in a corner
 * sits just under a blade, a SLAM throws it through. The ceiling spike bed is out of reach early;
 * as the tank fills the floating crowd rises toward it and slams start reaching it (second half).
 * Format: see shift1.js.
 */
export default {
  id: 'shift-2',
  number: 2,
  name: 'Sharp Objects',
  subtitle: 'Mind the edges.',
  lesson: 'SLAM throws donors into whatever is above them.',
  duration: 125,
  capacity: 130,
  quota: [26, 55, 80],
  startAngle: 0,
  hatch: { wall: 'back', x: 0, y: 1.0, offset: 1.2 },
  hazards: [
    { type: 'saw', wall: 'left', at: -2.2, z: [-2.5, 0.6], radius: 1.15, dir: 1 },
    { type: 'saw', wall: 'right', at: -2.2, z: [-0.6, 2.5], radius: 1.15, dir: -1 },
    { type: 'spikes', wall: 'ceiling', from: -3.5, to: 3.5, z: [-2.5, 2.5] },
  ],
  waves: [
    { at: 1.5, count: 5 },
    { at: 30, count: 5 },
    { at: 60, count: 6 },
    { at: 90, count: 6 },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Shift two. New equipment has been installed for your convenience.', mood: 'calm' },
    { at: 5, text: 'Press SPACE to SLAM. Donors appreciate a firm hand.', mood: 'calm' },
    { on: 'limb:sever', text: 'Partial donations are still donations.', mood: 'calm' },
    { on: 'donor:death', where: { cause: 'drown' }, text: 'Drowned donors yield nothing. Please be mindful.', mood: 'urgent' },
    { at: 70, text: 'The tank is filling nicely. Headroom is a privilege.', mood: 'calm' },
  ],
};
