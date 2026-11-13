/**
 * Shift 8 — "Staff Appreciation Day". Everything at once; donors wear STAFF UNIFORMS
 * (level.variant = 'staff' -> donor.look.outfit = 'staff'). Ending sting after the report:
 * shift:end payload `ending` = { pa, mood, next: 'credits' } when the shift is passed (>= 1 drop);
 * UI plays the PA line, drops the camera into the drum, then rolls credits.
 * Inspectors VISIT for 16 s (level.inspectorVisit) in their own small waves at fixed times: hold the
 * landing face down while he is aboard (it is bare), then get back to work. The press now sweeps
 * across the drum from the left wall along the far face (out of reach of the landing face).
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
  duration: 140,
  capacity: 150,
  quota: [55, 125, 150],
  startAngle: Math.PI,
  hatch: { wall: 'back', x: 0, y: -1.0, offset: 1.2 },
  // Inspectors only VISIT: keep the sphere intact for 16 s and he leaves with the +20 L bonus.
  // They arrive in their own small waves at fixed times (no early waves) — the timing window.
  inspectorVisit: 16,
  hazards: [
    { type: 'grinder', wall: 'floor', at: -1.2, width: 2.4, z: [-2.2, 2.2] },
    { type: 'spikes', wall: 'floor', from: 1.0, to: 3.4, z: [-2.5, 2.5] },
    { type: 'railSaw', wall: 'floor', from: 4.4, to: 6.6, z: [-2.5, 2.5], radius: 0.85, period: 4.5 },
    { type: 'crusher', wall: 'left', at: -3.9, width: 1.8, z: [-2.5, 2.5], period: 6.5 },
  ],
  waves: [
    { at: 1.5, count: 5, types: { standard: 3, thinBlood: 2 } },
    { at: 24, count: 3, types: { standard: 2, inspector: 1 }, fixed: true },
    { at: 46, count: 6, types: { standard: 3, thinBlood: 2, bigGiver: 1 }, props: [{ type: 'oxygenTank', count: 1 }] },
    { at: 72, count: 3, types: { standard: 2, inspector: 1 }, fixed: true },
    { at: 94, count: 6, types: { standard: 3, bigGiver: 1, thinBlood: 2 }, props: [{ type: 'oxygenTank', count: 1 }] },
  ],
  // fix round 2 (PLAYTEST-1 M6): regular waves come when the drum is clear OR `waveGap` s after the
  // previous regular wave, whichever is first; the Inspector visits (`fixed: true`) keep their `at`.
  advanceWhenClear: true,
  waveGap: 22,
  pa: [
    { at: 0.2, text: 'Happy Staff Appreciation Day. Today, the staff are giving back.', mood: 'calm' },
    { at: 22, text: 'An Inspector will visit shortly. Please keep him level until he leaves.', mood: 'calm' },
    { at: 50, text: 'Every colleague counts. Every drop counts.', mood: 'calm' },
    { at: 118, text: 'All departments are now donating. Thank you for your teamwork.', mood: 'glitch' },
  ],
};
