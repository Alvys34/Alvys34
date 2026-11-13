/**
 * Shift 2 — "Sharp Objects". Wall saws + ceiling spikes. Teaches SLAM.
 * Layout: donors land on the bare left end of the floor. A saw gang is bolted to the floor right of
 * centre (tilt the crowd over to it; a SLAM bounces them back down onto the blades) and a second,
 * smaller one sits further right. The ceiling spike bed is out of reach early; as the tank fills the
 * floating crowd rises toward it and slams start reaching it (second half) — or flip them onto it.
 * Design rule (all shifts): the money hazards sit on the floor / ceiling middles, which mindless
 * left-right mashing never brings down (it parks a SIDE wall at the bottom).
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
  hatch: { wall: 'back', x: -4.6, y: 1.0, offset: 1.2 },
  hazards: [
    { type: 'saw', wall: 'floor', at: 0.6, z: [-2.5, 2.5], radius: 1.15, dir: -1 },
    { type: 'saw', wall: 'floor', at: 4.4, z: [-2.5, 0.2], radius: 0.95, dir: 1 },
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
