/**
 * Shift 3 — "High Tide". Big quota, SMALL tank: the pool rises fast. Teaches floating / drowning.
 * Layout: a floor spike bed that is under the surface within a minute, and two saws high on the
 * side walls — useless at first, at the WATERLINE later. Floating donors drift; living donors whose
 * heads stay under for 6 s drown (no yield). Kill them before the tide does.
 */
export default {
  id: 'shift-3',
  number: 3,
  name: 'High Tide',
  subtitle: 'Please keep your head above water.',
  lesson: 'The pool lifts everything. Bottom hazards drown; use the waterline.',
  duration: 125,
  capacity: 80,
  quota: [34, 62, 86],
  startAngle: 0,
  hatch: { wall: 'back', x: 0, y: 1.5, offset: 1.2 },
  hazards: [
    { type: 'spikes', wall: 'floor', from: -4.5, to: 1.5, z: [-2.5, 2.5] },
    { type: 'saw', wall: 'left', at: 1.4, z: [-2.5, 2.5], radius: 1.2, dir: 1 },
    { type: 'saw', wall: 'right', at: 0.6, z: [-2.5, 2.5], radius: 1.2, dir: -1 },
  ],
  waves: [
    { at: 1.5, count: 6 },
    { at: 28, count: 6 },
    { at: 56, count: 7 },
    { at: 86, count: 7 },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Shift three. Due to budget constraints, today\'s tank is compact.', mood: 'calm' },
    { at: 40, text: 'Donors float. Donors also drown. Please choose the first one.', mood: 'calm' },
    { on: 'donor:death', where: { cause: 'drown' }, text: 'A donor has drowned. That product is now pool water.', mood: 'urgent' },
  ],
};
