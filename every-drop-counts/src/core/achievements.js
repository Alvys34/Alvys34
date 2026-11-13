/**
 * Achievements (owner: CONTENT). Definitions + a tracker that listens to the sim's bus events and
 * emits `achievement { id }` ONCE per unlock. Persistence, toasts and Steam are UI's job
 * (src/ui/systems.js listens for `achievement`, saves it and calls edcDesktop.unlockAchievement).
 *
 *   import { ACHIEVEMENTS, createAchievementTracker } from './core/achievements.js';
 *   const tracker = createAchievementTracker({ bus, unlocked: ['FIRST_SHIFT'], save });
 *   tracker.seed(ids)        // mark ids as already unlocked (never re-emitted)
 *   tracker.unlocked         // Set of ids
 *   tracker.dispose()
 *
 * `id` is the Steam API name (UPPER_SNAKE). Keep docs/STEAM_RELEASE.md §5.1 in sync.
 * Pure JS, no DOM: works in Node tests with the sim's bus.
 */
export const ACHIEVEMENTS = [
  // progression
  { id: 'FIRST_SHIFT', title: 'Orientation Complete', description: 'Pass Shift 1.' },
  { id: 'ALL_SHIFTS', title: 'Staff Appreciated', description: 'Pass Shift 8: Staff Appreciation Day.' },
  { id: 'PERFECT_RECORD', title: 'Operator of Every Month', description: 'Earn 3 drops on all 8 shifts.' },
  { id: 'OVERTIME_5_MIN', title: 'Voluntary Overtime', description: 'Keep the tank from running dry for 5 minutes in Overtime.' },
  // skill
  { id: 'SPONSOR_MATCH_8', title: 'Fully Matched', description: 'Reach a ×8 Sponsor Match.' },
  { id: 'HEAD_ABOVE_WATER', title: 'Head Above Water', description: 'Pass High Tide (Shift 3) without a single drowning.' },
  { id: 'FULLY_COMPLIANT', title: 'Fully Compliant', description: 'Earn 3 drops on a shift with every Inspector still alive.' },
  { id: 'SINGLE_STROKE', title: 'Single Stroke', description: 'Press 3 donors with one stroke of the crusher.' },
  // dark-comedy discoveries
  { id: 'PERCUSSIVE_MAINTENANCE', title: 'Percussive Maintenance', description: 'Jam The Good Machine, then SLAM it clear.' },
  { id: 'PRESSURE_EVENT', title: 'Pressure Event', description: 'Set off an oxygen tank with another oxygen tank.' },
  { id: 'SOME_ASSEMBLY_REQUIRED', title: 'Some Assembly Required', description: 'Collect 30 partial donations in one shift.' },
  { id: 'INCIDENT_REPORT', title: 'Incident Report', description: 'An Inspector met an oxygen tank.', hidden: true },
  { id: 'PRODUCT_NOT_RECOVERABLE', title: 'Product Not Recoverable', description: 'Let 5 donors drown in one shift.', hidden: true },
  { id: 'CONSCIENTIOUS_OBJECTOR', title: 'Conscientious Objector', description: 'Finish a shift without processing a single donor.', hidden: true },
];

const IDS = new Set(ACHIEVEMENTS.map((a) => a.id));
const SHIFT_COUNT = 8;

/**
 * @param {{ bus, unlocked?: string[], save?: { best?: Record<string,{stars:number}> } }} opts
 */
export function createAchievementTracker({ bus, unlocked = [], save = null } = {}) {
  if (!bus) throw new Error('createAchievementTracker: bus required');
  const got = new Set();
  const bestStars = {};
  if (save && save.best) for (const [id, b] of Object.entries(save.best)) bestStars[id] = Math.max(0, (b && b.stars) | 0);
  let shift = fresh('shift', null);
  let chainPending = 0;

  function fresh(mode, levelId) {
    return { mode, levelId, severs: 0, drownings: 0, kills: 0, clogged: false, overtimeT: 0 };
  }

  function unlock(id) {
    if (!IDS.has(id) || got.has(id)) return false;
    got.add(id);
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    bus.emit('achievement', { id, title: def.title });
    return true;
  }

  const offs = [];
  const on = (type, fn) => offs.push(bus.on(type, (p) => { try { fn(p || {}); } catch (e) { /* never break the bus */ } }));

  on('shift:start', (p) => { shift = fresh(p.mode || 'shift', p.levelId); chainPending = 0; });
  on('combo', (p) => { if ((p.multiplier | 0) >= 8) unlock('SPONSOR_MATCH_8'); });
  on('limb:sever', () => { if (++shift.severs >= 30) unlock('SOME_ASSEMBLY_REQUIRED'); });
  on('donor:death', (p) => {
    if (p.type === 'inspector') {
      if (p.cause === 'explode') unlock('INCIDENT_REPORT');
      return;
    }
    if (p.cause === 'drown') { if (++shift.drownings >= 5) unlock('PRODUCT_NOT_RECOVERABLE'); } else shift.kills++;
  });
  on('sphere:shatter', (p) => { if (p.cause === 'explosion') shift.sphereBlast = true; });
  on('grinder:clog', () => { shift.clogged = true; });
  on('grinder:clear', (p) => { if (shift.clogged && p.bySlam) unlock('PERCUSSIVE_MAINTENANCE'); });
  on('prop:puncture', (p) => { if (p.cause === 'explosion') chainPending++; });
  on('prop:explode', () => { if (chainPending > 0) { chainPending--; unlock('PRESSURE_EVENT'); } });
  on('hazard:contact', (p) => { if (p.hazard === 'crusher' && (p.pressed | 0) >= 3) unlock('SINGLE_STROKE'); });
  on('wave:incoming', (p) => { if (shift.mode === 'overtime' && p.t >= 300) unlock('OVERTIME_5_MIN'); });
  on('shift:end', (p) => {
    if (p.mode === 'overtime' || shift.mode === 'overtime') {
      if ((p.time || 0) >= 300) unlock('OVERTIME_5_MIN');
      return;
    }
    const levelId = p.levelId || shift.levelId;
    const n = p.levelNumber | 0;
    const stars = p.stars | 0;
    if (stars >= 1 && n === 1) unlock('FIRST_SHIFT');
    if (stars >= 1 && n === SHIFT_COUNT) unlock('ALL_SHIFTS');
    if (stars >= 1 && n === 3 && (p.drownings | 0) === 0) unlock('HEAD_ABOVE_WATER');
    if (stars >= 3 && (p.inspectorsSaved | 0) > 0 && (p.inspectorDeaths | 0) === 0) unlock('FULLY_COMPLIANT');
    if ((p.kills | 0) === 0 && shift.kills === 0) unlock('CONSCIENTIOUS_OBJECTOR');
    if (levelId) bestStars[levelId] = Math.max(bestStars[levelId] || 0, stars);
    let perfect = 0;
    for (let i = 1; i <= SHIFT_COUNT; i++) if ((bestStars[`shift-${i}`] || 0) >= 3) perfect++;
    if (perfect >= SHIFT_COUNT) unlock('PERFECT_RECORD');
  });

  const api = {
    get unlocked() { return got; },
    definitions: ACHIEVEMENTS,
    seed(ids = []) { for (const id of ids) if (IDS.has(id)) got.add(id); },
    isUnlocked(id) { return got.has(id); },
    dispose() { offs.forEach((off) => off()); offs.length = 0; },
  };
  api.seed(unlocked);
  return api;
}

export default createAchievementTracker;
