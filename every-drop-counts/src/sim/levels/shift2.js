/**
 * Shift 2 — "Sharp Objects". Saws + a spike bed. Teaches SLAM.
 * Orientation (shifts 2-8): the drum STARTS UPSIDE DOWN (startAngle = pi). Donors land on the bare
 * 'ceiling' face; the machinery sits overhead in the middle of the 'floor' face. Reaching it takes a
 * deliberate half-turn and controlled tilting (or a flip: let them fall 10 m onto it). Mindless
 * left-right mashing only ever slides the crowd along a side wall into a corner — never across the
 * middle of a face — so it stays out of the machinery (see the balance notes in src/sim/README.md).
 * Layout: overhead, a spike bed between two saw gangs (each covering part of the depth). Once the
 * crowd is down on that face, a SLAM bounces them up and back down onto the bed / into the blades.
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
  startAngle: Math.PI,
  hatch: { wall: 'back', x: 0, y: -1.0, offset: 1.2 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -1.3, to: 1.3, z: [-2.5, 2.5] },
    { type: 'saw', wall: 'floor', at: -3.3, z: [-2.5, 0.4], radius: 1.05, dir: 1 },
    { type: 'saw', wall: 'floor', at: 3.3, z: [-0.4, 2.5], radius: 1.05, dir: -1 },
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
