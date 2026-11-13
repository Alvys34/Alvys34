/**
 * Deadpan shift report lines (GDD §11 "Writing"). Pure function of the shift's tallies.
 * shift:end payload.report = { title, lines: [string] } — UI shows them on the results screen.
 * Tone: short, clinical, corporate; no real brands / people / groups.
 */
const TITLES = [
  'Performance review scheduled.',
  'Meets expectations.',
  'Exceeds expectations.',
  'Operator of the Shift.',
];

export function shiftReport(ctx, level, r) {
  const ev = ctx.eventCounts || {};
  const lines = [];
  lines.push(`Litres collected: ${r.collected.toFixed(1)}`);
  if (r.bonus > 0) lines.push(`Sponsor contributions and bonuses: ${r.bonus.toFixed(1)} L`);
  if (r.fines > 0) lines.push(`Fines: ${r.fines.toFixed(1)} L (deducted at source)`);
  lines.push(r.drownings ? `Donors lost to swimming: ${r.drownings} (product not recoverable)` : 'Drownings: 0. Exemplary.');
  if (r.bestCombo >= 2) lines.push(`Peak Sponsor Match: ×${r.bestCombo}`);
  if (ev['limb:sever']) lines.push(`Partial donations: ${ev['limb:sever']}`);
  if ((r.causes || {}).grind) lines.push(`Donors fully processed by The Good Machine: ${r.causes.grind}`);
  if (ev['grinder:clog']) lines.push(`Grinder jams: ${ev['grinder:clog']} (maintenance has been notified)`);
  if (ev['prop:explode']) lines.push(`Oxygen tanks returned: 0 of ${ev['prop:explode']}`);
  if (r.inspectorsSaved) lines.push(`Inspections passed: ${r.inspectorsSaved}`);
  if (r.inspectorDeaths) lines.push(`Workplace incidents: ${r.inspectorDeaths} (under review)`);
  lines.push('Complaints received: 0 (donors unavailable for comment)');
  lines.push(ctx.rng.pick([
    'Cookies distributed: 0',
    'Stickers distributed: 0',
    'Donor satisfaction survey: pending',
    'Tiles requiring attention: all',
    'Exit interviews conducted: 0',
  ]));
  if (level.variant === 'staff') lines.push('Staff attendance: 100 %. Thank you, team.');
  return { title: TITLES[Math.max(0, Math.min(3, r.stars | 0))], lines };
}

/** Overtime report (same shape). */
export function overtimeReport(ctx, r) {
  const ev = ctx.eventCounts || {};
  const lines = [
    `Litres delivered: ${r.liters.toFixed(1)}`,
    `Time on the clock: ${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')}`,
    `Waves processed: ${r.waves}`,
    r.drownings ? `Donors lost to swimming: ${r.drownings}` : 'Drownings: 0. Exemplary.',
  ];
  if (r.bestCombo >= 2) lines.push(`Peak Sponsor Match: ×${r.bestCombo}`);
  if (ev['prop:explode']) lines.push(`Oxygen tanks returned: 0 of ${ev['prop:explode']}`);
  if (r.inspectorDeaths) lines.push(`Workplace incidents: ${r.inspectorDeaths}`);
  lines.push('Demand was not met. Demand is never met.');
  lines.push('Overtime will be paid in exposure.');
  return { title: 'The tank ran dry.', lines };
}
