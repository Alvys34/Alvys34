/**
 * Shift 5 — "Compliance". Inspectors in personal safety spheres. Teaches steering the crowd AWAY.
 * Orientation (shifts 2-8): the drum STARTS UPSIDE DOWN (startAngle = pi). Donors land on the bare
 * 'ceiling' face; the machinery sits overhead in the middle of the 'floor' face. Reaching it takes a
 * deliberate half-turn and controlled tilting (or a flip: let them fall 10 m onto it). Mindless
 * left-right mashing only ever slides the crowd along a side wall into a corner — never across the
 * middle of a face — so it stays out of the machinery (see the balance notes in src/sim/README.md).
 * Layout: a wide spike bed overhead and a saw low on one side wall. Spikes only hurt what FALLS on
 * them, so his rolling ball can cross the bed — and a SLAM barely lifts the heavy ball, so slam
 * re-drops are the safe tool. Flipping the drum drops HIM from height too, and tilting the saw wall
 * down rolls him straight into it. Inspector dead = −25 L fine; alive at the end = +20 L.
 */
export default {
  id: 'shift-5',
  number: 5,
  name: 'Compliance',
  subtitle: 'An Inspector will be observing.',
  lesson: 'Inspectors must survive. Keep the sphere away from the equipment.',
  duration: 130,
  capacity: 130,
  quota: [30, 62, 92],
  startAngle: Math.PI,
  hatch: { wall: 'back', x: 0, y: -1.0, offset: 1.2 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -3.0, to: 3.0, z: [-2.5, 2.5] },
    { type: 'saw', wall: 'right', at: -3.4, z: [-2.5, 2.5], radius: 1.1, dir: -1 },
  ],
  waves: [
    { at: 1.5, count: 5, types: { standard: 4, inspector: 1 } },
    { at: 32, count: 5 },
    { at: 62, count: 6, types: { standard: 5, inspector: 1 } },
    { at: 94, count: 5 },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Shift five. An Inspector will be observing today. He must not be processed.', mood: 'calm' },
    { at: 7, text: 'His sphere is rated for three impacts. Please do not test this.', mood: 'calm' },
    { on: 'sphere:crack', text: 'The Inspector\'s sphere has been compromised. Please be gentle.', mood: 'urgent' },
  ],
};
