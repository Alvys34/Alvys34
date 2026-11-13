/**
 * Shift 5 — "Compliance". Inspectors in personal safety spheres. Teaches steering the crowd AWAY.
 * Layout: a spike bed in the middle of the floor and a saw low on the right wall. Spikes only hurt
 * what FALLS on them, so his rolling ball is safe crossing the bed — and a SLAM barely lifts the heavy
 * ball, so slam re-drops are the safe tool. Flipping the drum drops HIM from height too, and tilting
 * the right wall down rolls him straight into the saw. Inspector dead = −25 L fine; alive = +20 L.
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
  startAngle: 0,
  hatch: { wall: 'back', x: -4.8, y: 1.0, offset: 1.2 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -2.4, to: 3.4, z: [-2.5, 2.5] },
    { type: 'saw', wall: 'right', at: -3.2, z: [-2.5, 2.5], radius: 1.1, dir: -1 },
    { type: 'spikes', wall: 'ceiling', from: -4, to: 4, z: [-2.5, 2.5] },
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
