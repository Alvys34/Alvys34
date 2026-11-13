/**
 * Every player-facing string the UI owns (the written voice of DRAINWELL™).
 * Tone: short, deadpan, corporate, slightly too cheerful. Sentence case. No exclamation marks
 * except where a donor or the brand would genuinely use one.
 * Level names / PA lines / donor lines come from src/sim (CONTENT); these are fallbacks + UI text.
 */
export const BRAND = 'DRAINWELL™';
export const BRAND_SUB = 'Community Donation Centers';
export const GAME = 'Every Drop Counts';

/** Briefing card per shift number: one sentence + the new element's icon. level.briefing wins. */
export const BRIEFINGS = {
  1: { icon: 'rotateBoth', text: 'Turn the drum. Gravity handles the paperwork.' },
  2: { icon: 'piston', text: 'New: SLAM. Everyone goes up. Some come back down in pieces.' },
  3: { icon: 'tide', text: 'Small tank, big quota. Donors float. Floating donors drown.' },
  4: { icon: 'grinder', text: 'The grinder wastes nothing. Slam it when it clogs.' },
  5: { icon: 'hardhat', text: 'An Inspector is visiting. He must leave in one piece.' },
  6: { icon: 'tank', text: 'Oxygen tanks rupture on contact. Plan accordingly.' },
  7: { icon: 'crusher', text: 'Rail saws, crushers and Thin-Bloods. It is rush hour.' },
  8: { icon: 'badge', text: 'Staff Appreciation Day. Today, staff donate too.' },
  overtime: { icon: 'pump', text: 'The demand pump never stops. Keep the tank from running dry.' },
};
export const SHIFT_NAMES_FALLBACK = {
  1: 'Orientation', 2: 'Sharp Objects', 3: 'High Tide', 4: 'The Good Machine',
  5: 'Compliance', 6: 'Breathe Easy', 7: 'Rush Hour', 8: 'Staff Appreciation Day',
};
export const TOTAL_SHIFTS = 8;

export const MENU = {
  pressAny: 'Press any button to clock in',
  terminal: 'Operator terminal',
  clockIn: 'Clock in',
  shifts: 'Shift select',
  overtime: 'Overtime',
  overtimeLocked: (n) => `Clear shift ${n} to unlock`,
  records: 'Records',
  settings: 'Settings',
  credits: 'Credits',
  quit: 'Quit',
  resume: 'Resume',
  restart: 'Restart shift',
  restartOvertime: 'Restart Overtime',
  quitToMenu: 'Quit to menu',
  back: 'Back',
  select: 'Select',
  begin: 'Begin shift',
  beginOvertime: 'Start Overtime',
  next: 'Next shift',
  retry: 'Retry',
  menu: 'Shift select',
  title: 'Main menu',
  clockOut: 'Clock out',
  adjust: 'Adjust',
  move: 'Move',
};

export const SHIFT_SELECT = {
  heading: 'Shift select',
  sub: 'One drop unlocks the next shift.',
  locked: 'Locked',
  soon: 'Opening soon',
  noBest: 'Not yet worked',
  best: (l) => `Best ${l} L`,
};

export const PAUSE = {
  heading: 'Paused',
  sub: 'The donors will wait. They have no choice.',
  quitConfirm: 'Quit to menu? This shift will not count.',
  quitYes: 'Quit shift',
  quitNo: 'Keep working',
};

export const RESULT_HEADLINES = {
  3: 'Exceeds expectations.',
  2: 'Meets expectations.',
  1: 'Quota met.',
  timeout: 'Quota not met. The clock ran out.',
  failed: 'Quota not met. We ran out of donors.',
};

export const RESULTS = {
  heading: 'Shift report',
  total: 'Total donated',
  collected: 'Collected',
  bonus: 'Bonuses',
  fines: 'Fines',
  newBest: 'New personal best',
  firstReport: 'First report filed',
  unlocked: (n, name) => `Shift ${n} unlocked: ${name}`,
  overtimeUnlocked: 'Overtime unlocked',
  skip: 'Skip',
};

/**
 * Deadpan stat lines chosen from the real run. Each returns null when it doesn't apply.
 * r = shift:end payload, x = UI-tracked extras { severs, combos, slams, explosions, inspectorFines, inspectorBonus, impales }
 */
export const STAT_LINES = [
  (r, x) => ({ k: 'Donors processed', v: `${r.kills ?? 0}${r.donorsTotal ? ` / ${r.donorsTotal}` : ''}`, always: true }),
  (r, x) => (x.combos > 0
    ? { k: 'Sponsor Matches', v: `${x.combos} (best ×${r.bestCombo || 2})`, w: 3 }
    : { k: 'Sponsor Matches', v: '0. Sponsors have been notified.', w: 2 }),
  (r) => (r.drownings > 0 ? { k: 'Drownings', v: `${r.drownings} (product wasted)`, w: 4 } : { k: 'Drownings', v: '0. Exemplary.', w: 1 }),
  (r, x) => (x.severs > 0 ? { k: 'Limbs misplaced', v: String(x.severs), w: 3 } : null),
  (r, x) => (x.inspectorFines > 0 ? { k: 'Workplace incidents', v: `${x.inspectorFines} (under review)`, w: 5 } : null),
  (r, x) => (x.inspectorBonus > 0 ? { k: 'Inspections passed', v: String(x.inspectorBonus), w: 4 } : null),
  (r) => ((r.causes && r.causes.impale) ? { k: 'Donors pinned for follow-up', v: String(r.causes.impale), w: 2 } : null),
  (r) => ((r.causes && r.causes.grind) ? { k: 'Donors fully recycled', v: String(r.causes.grind), w: 3 } : null),
  (r, x) => (x.explosions > 0 ? { k: 'Oxygen tanks discharged', v: String(x.explosions), w: 3 } : null),
  (r, x) => (x.slams > 0 ? { k: 'Slams performed', v: String(x.slams), w: 1 } : null),
  () => ({ k: 'Complaints received', v: '0 (donors unavailable for comment)', always: true, tail: true }),
  () => ({ k: 'Cookies distributed', v: '0', always: true, tail: true }),
];

export const OVERTIME = {
  heading: 'Overtime report',
  dry: 'The tank ran dry.',
  delivered: 'Litres delivered',
  survived: 'Time on shift',
  table: 'Overtime leaderboard',
  local: 'This terminal only.',
  enter: 'Sign the report',
  enterHint: 'Initials for the leaderboard',
  confirm: 'Sign',
  rank: (n) => `Rank ${n} of 10`,
  noRank: 'Not on the leaderboard this time.',
  empty: 'No entries yet.',
  demand: 'Demand',
  tank: 'Tank',
};

export const HUD = {
  liters: 'Collected',
  tank: 'Tank',
  delivered: 'Delivered',
  nextDrop: (left) => `${left} L to next drop`,
  allDrops: 'All three drops. Keep going.',
  intake: 'Next intake',
  incoming: (n) => `Intake: ${n} donor${n === 1 ? '' : 's'}`,
  donorsLeft: 'left',
  slam: 'Slam',
  ready: 'Ready',
  combo: 'Sponsor Match',
  restarting: 'Restarting',
  dryWarning: 'Tank low',
  wave: (n) => `Wave ${n}`,
  overtime: 'Overtime',
};

export const REASONS = {
  'sponsor-match': 'Sponsor Match',
  'early-finish': 'Early finish',
  'workplace-incident': 'Workplace incident',
  'inspector-survived': 'Inspection passed',
  compliance: 'Compliance bonus',
};
export const reasonLabel = (r) => REASONS[r] || String(r || '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Contextual teaching prompts (one line each). */
export const PROMPTS = {
  rotate: 'Rotate the drum',
  slam: 'Slam',
  brake: 'Hold to brake',
};

export const SETTINGS = {
  heading: 'Settings',
  sections: { audio: 'Sound', display: 'Display', comfort: 'Comfort', data: 'Data' },
  master: 'Master volume', music: 'Music', sfx: 'Effects',
  fullscreen: 'Fullscreen', quality: 'Graphics quality', screenShake: 'Screen shake',
  bloodColor: 'Blood colour', reduceFlashing: 'Reduce flashing', speechBubbles: 'Donor speech bubbles',
  reset: 'Reset progress',
  help: {
    master: 'Overall loudness.',
    music: 'Elevator music. It does not get better.',
    sfx: 'Everything that squelches.',
    fullscreen: 'Fill the screen.',
    quality: 'Auto lowers detail if the frame rate drops.',
    screenShake: 'Camera shake on slams and impacts.',
    bloodColor: 'Green is streamer-safe. Litres are still litres.',
    reduceFlashing: 'Softens flashes, pulses and PA glitches.',
    speechBubbles: 'What the donors are saying.',
    reset: 'Erases shifts, records and Overtime scores. Settings stay.',
  },
  values: {
    quality: { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' },
    screenShake: { off: 'Off', reduced: 'Reduced', full: 'Full' },
    bloodColor: { red: 'Red', green: 'Green' },
    on: 'On', off: 'Off',
  },
  resetConfirm: 'Erase all progress? This cannot be undone.',
  resetYes: 'Erase progress',
  resetNo: 'Cancel',
  resetDone: 'Progress erased. Fresh start.',
};

export const RECORDS = {
  heading: 'Records',
  achievements: 'Commendations',
  lifetime: 'Lifetime service',
  none: 'Commendations are being printed. Check back later.',
  locked: 'Not yet awarded',
  hidden: 'Classified',
  stats: {
    litersTotal: 'Litres donated', donorsProcessed: 'Donors processed', shiftsCompleted: 'Shifts completed',
    limbsSevered: 'Limbs misplaced', drownings: 'Drownings', slams: 'Slams', overtimeRuns: 'Overtime runs',
  },
  toast: 'Commendation',
};

export const CREDITS = {
  heading: 'Credits',
  lines: [
    ['A', `${BRAND} production`],
    ['Made with', 'three.js, Rapier, Electron, steamworks.js'],
    ['Typeface', 'Nunito'],
    ['Donors', 'Fictional, adult, and very grateful'],
    ['Cookies', 'Pending budget approval'],
  ],
  thanks: 'Thank you for your service.',
  licences: 'Third-party licences',
  disclaimer: 'All people, companies and events are fictional. No donors were harmed. They were processed.',
};

export const ENDING = {
  lines: [
    'Attention, Operator.',
    'Please proceed to the intake chute.',
    'Thank you for donating.',
  ],
  skip: 'Skip',
};

export const QUIT = { confirm: 'Clock out and quit?', yes: 'Quit', no: 'Stay' };
