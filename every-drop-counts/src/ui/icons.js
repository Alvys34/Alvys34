/**
 * Custom pictograms (24x24, 2px round stroke, currentColor) in the style of laminated hospital
 * wayfinding signage. icon(name, cls?) -> SVG markup string. No icon fonts, no emoji.
 */
const P = {
  // the blood drop (filled) — the game's unit and rating mark
  drop: '<path d="M12 2.6c-.3 0-.6.2-.8.5C9.3 6 5.5 10.9 5.5 14.6a6.5 6.5 0 0 0 13 0c0-3.7-3.8-8.6-5.7-11.5-.2-.3-.5-.5-.8-.5z" fill="currentColor" stroke="none"/>',
  dropOutline: '<path d="M12 3.3C10 6.3 6.3 11 6.3 14.6a5.7 5.7 0 0 0 11.4 0C17.7 11 14 6.3 12 3.3z"/>',
  clock: '<circle cx="12" cy="12.5" r="8.5"/><path d="M12 8v4.8l3 2"/><path d="M9.5 2.5h5"/>',
  donor: '<circle cx="12" cy="6.2" r="3.2"/><path d="M5.5 21v-3.4c0-3.2 2.9-5.6 6.5-5.6s6.5 2.4 6.5 5.6V21"/><path d="M9.6 14.5l2.4 2.4 2.4-2.4"/>',
  // SLAM: a piston slamming into a plate
  piston: '<rect x="8" y="2.5" width="8" height="6" rx="1.2"/><path d="M12 8.5v6.5"/><rect x="5.5" y="15" width="13" height="3" rx="1"/><path d="M3 21.5h18"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.8v4.4h-4.4"/>',
  rotateBoth: '<path d="M4.6 10.2a7.6 7.6 0 0 1 13.6-3.1"/><path d="M18.9 3.4v3.9H15"/><path d="M19.4 13.8a7.6 7.6 0 0 1-13.6 3.1"/><path d="M5.1 20.6v-3.9H9"/>',
  spikes: '<path d="M2.5 20.5h19"/><path d="M4 20.5l2.2-8 2.2 8M10 20.5l2-10 2 10M15.6 20.5l2.2-8 2.2 8"/>',
  saw: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5l2 3.2 3.6-1 .2 3.7 3.4 1.4-2 3.2 2 3.2-3.4 1.4-.2 3.7-3.6-1-2 3.2-2-3.2-3.6 1-.2-3.7L2.8 15.2l2-3.2-2-3.2 3.4-1.4.2-3.7 3.6 1z"/>',
  tide: '<path d="M3 9.5c2 0 2-1.6 4.5-1.6S9.5 9.5 12 9.5s2.5-1.6 4.5-1.6S19 9.5 21 9.5"/><path d="M3 14.5c2 0 2-1.6 4.5-1.6s2 1.6 4.5 1.6 2.5-1.6 4.5-1.6 2.5 1.6 4.5 1.6"/><path d="M3 19.5c2 0 2-1.6 4.5-1.6s2 1.6 4.5 1.6 2.5-1.6 4.5-1.6 2.5 1.6 4.5 1.6"/><path d="M12 2.5v4M10 4.6l2 2 2-2"/>',
  grinder: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8.3" cy="12" r="3.3"/><circle cx="15.7" cy="12" r="3.3"/><path d="M8.3 8.7v-1M8.3 16.3v-1M15.7 8.7v-1M15.7 16.3v-1"/>',
  hardhat: '<path d="M3.5 17.5h17"/><path d="M5 17.5v-2.3a7 7 0 0 1 14 0v2.3"/><path d="M10 8.6V6.4c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v2.2"/><path d="M12 20.5v-3"/>',
  tank: '<rect x="7" y="6" width="10" height="15.5" rx="4"/><path d="M10 6V3.5h4V6"/><path d="M7 11h10"/><path d="M15 3.5h3"/>',
  crusher: '<path d="M3 3h18"/><path d="M12 3v4"/><rect x="5" y="7" width="14" height="5" rx="1"/><path d="M7 15l-1 2M12 15v2.4M17 15l1 2"/><path d="M3 21h18"/>',
  badge: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9.5 4V2.5h5V4"/><circle cx="12" cy="10.5" r="2.6"/><path d="M8.5 17.2c.6-1.9 2-2.8 3.5-2.8s2.9.9 3.5 2.8"/>',
  pump: '<rect x="4.5" y="2.5" width="15" height="14" rx="3"/><path d="M4.5 11h15"/><path d="M12 16.5v1.8"/><path d="M12 19.4c.9 0 1.5.6 1.5 1.3 0 .8-.7 1.3-1.5 1.3s-1.5-.5-1.5-1.3c0-.7.6-1.3 1.5-1.3z" fill="currentColor"/><path d="M8 7.2h3"/>',
  speaker: '<path d="M4 9.5h3.5L12.5 5v14l-5-4.5H4z"/><path d="M15.8 9a4.2 4.2 0 0 1 0 6"/><path d="M18.6 6.4a8 8 0 0 1 0 11.2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10.5" rx="2.2"/><path d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9"/><path d="M12 14.6v2.4"/>',
  check: '<path d="M4.5 12.8l4.6 4.6 10.4-10.8"/>',
  arrow: '<path d="M4 12h15"/><path d="M13.5 6.2L19.5 12l-6 5.8"/>',
  arrowBack: '<path d="M20 12H5"/><path d="M10.5 6.2L4.5 12l6 5.8"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>',
  rosette: '<circle cx="12" cy="9" r="6"/><circle cx="12" cy="9" r="2.6"/><path d="M8.2 13.7L6.5 21.5l5.5-2.6 5.5 2.6-1.7-7.8"/>',
  clipboard: '<rect x="4.5" y="4" width="15" height="17.5" rx="2.2"/><path d="M9 4V2.5h6V4"/><path d="M8 10h8M8 14h8M8 18h5"/>',
  door: '<path d="M13.5 3.5h-8v17h8"/><path d="M10 12h11"/><path d="M17.5 8.5L21 12l-3.5 3.5"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.2 3.8v4.4h4.4"/>',
  hatch: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18"/><path d="M8.5 13.5L12 17l3.5-3.5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  minus: '<path d="M5 12h14"/>',
  cross: '<rect x="8.6" y="3" width="6.8" height="18" rx="1.6" fill="currentColor" stroke="none"/><rect x="3" y="8.6" width="18" height="6.8" rx="1.6" fill="currentColor" stroke="none"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r="1.2" fill="currentColor"/><circle cx="4.6" cy="12" r="1.2" fill="currentColor"/><circle cx="4.6" cy="17.5" r="1.2" fill="currentColor"/>',
  cookie: '<circle cx="12" cy="12" r="8.8"/><circle cx="9" cy="9.5" r=".9" fill="currentColor"/><circle cx="14.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="15" cy="14.5" r=".9" fill="currentColor"/><circle cx="9.5" cy="15" r=".9" fill="currentColor"/>',
  warning: '<path d="M12 3.2L21.5 20H2.5z"/><path d="M12 9.5v4.8"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
};

export function icon(name, cls = '') {
  const body = P[name] || P.dropOutline;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** DRAINWELL logo mark: a white drop in a mint rounded square with a small medical cross. */
export function logoMark(cls = '') {
  return `<svg class="logo-mark ${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="46" height="46" rx="13" fill="var(--mint)"/>
    <path d="M24 8.5c-.5 0-1 .3-1.3.8C19.6 14 13.5 21.8 13.5 27.7a10.5 10.5 0 0 0 21 0c0-5.9-6.1-13.7-9.2-18.4-.3-.5-.8-.8-1.3-.8z" fill="#fff"/>
    <rect x="21.8" y="23" width="4.4" height="12" rx="1.1" fill="var(--mint)"/><rect x="18" y="26.8" width="12" height="4.4" rx="1.1" fill="var(--mint)"/>
  </svg>`;
}

export const ICONS = Object.keys(P);
