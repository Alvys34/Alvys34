/**
 * Shift 8 — "Staff Appreciation Day". Everything at once; donors wear STAFF UNIFORMS
 * (level.variant = 'staff' -> donor.look.outfit = 'staff'). Ending sting after the report:
 * shift:end payload `ending` = { pa, mood, next: 'credits' } when the shift is passed (>= 1 drop);
 * UI plays the PA line, drops the camera into the drum, then rolls credits.
 * Orientation (shifts 2-8): the drum STARTS UPSIDE DOWN (startAngle = pi). Donors land on the bare
 * 'ceiling' face; the machinery sits overhead in the middle of the 'floor' face. Reaching it takes a
 * deliberate half-turn and controlled tilting (or a flip: let them fall 10 m onto it). Mindless
 * left-right mashing only ever slides the crowd along a side wall into a corner — never across the
 * middle of a face — so it stays out of the machinery (see the balance notes in src/sim/README.md).
 */
export default {
  id: 'shift-8',
  number: 8,
  name: 'Staff Appreciation Day',
  subtitle: 'Thank you for everything you do.',
  lesson: 'Everything you have learned. All hands.',
  variant: 'staff',
  donorLook: { outfit: 'staff', gown: [0x7fc8b8, 0x6fbaa9, 0x8fd3c3] },
  ending: { pa: 'Operator, please proceed to the intake chute. Thank you for donating.', mood: 'calm', next: 'credits' },
  duration: 150,
  capacity: 160,
  quota: [60, 142, 165],
  startAngle: Math.PI,
  hatch: { wall: 'back', x: 0, y: -1.0, offset: 1.2 },
  hazards: [
    { type: 'grinder', wall: 'floor', at: -1.4, width: 2.4, z: [-2.2, 2.2] },
    { type: 'spikes', wall: 'floor', from: 0.6, to: 3.2, z: [-2.5, 2.5] },
    { type: 'crusher', wall: 'floor', at: -5.4, width: 2.6, z: [-2.5, 2.5], period: 6.0 },
    { type: 'railSaw', wall: 'floor', from: 4.0, to: 6.4, z: [-2.5, 2.5], radius: 0.9, period: 4.5 },
  ],
  waves: [
    { at: 1.5, count: 6, types: { standard: 4, thinBlood: 2 }, props: [{ type: 'oxygenTank', count: 1 }] },
    { at: 26, count: 6, types: { standard: 3, bigGiver: 1, thinBlood: 1, inspector: 1 } },
    { at: 52, count: 7, types: { standard: 4, thinBlood: 2, bigGiver: 1 }, props: [{ type: 'oxygenTank', count: 2 }] },
    { at: 80, count: 7, types: { standard: 4, thinBlood: 2, inspector: 1 } },
    { at: 110, count: 7, types: { standard: 4, bigGiver: 2, thinBlood: 1 }, props: [{ type: 'oxygenTank', count: 2 }] },
  ],
  advanceWhenClear: true,
  pa: [
    { at: 0.2, text: 'Happy Staff Appreciation Day. Today, the staff are giving back.', mood: 'calm' },
    { at: 30, text: 'Every colleague counts. Every drop counts.', mood: 'calm' },
    { at: 118, text: 'All departments are now donating. Thank you for your teamwork.', mood: 'glitch' },
  ],
};
