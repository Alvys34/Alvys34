/**
 * Single source of truth for the fictional in-game company name (headless: constants only).
 * PROVISIONAL: the owner has not confirmed the final name. To rename, edit BRAND below; the UI
 * (src/ui/copy.js), the signage atlas (src/render/environment/textures.js) and any level/PA text
 * derive from it. Keep it a short all-caps word (signage is laid out for ~9 letters) and do not
 * add a trademark sign. Docs, store text and desktop metadata carry the name as plain text and
 * must be updated by hand (grep for the old name).
 */
export const BRAND = 'SUNNYVEIN';
/** Sub-line under the logo mark. */
export const BRAND_SUB = 'Community Donation Centers';
/** Main lobby sign second line. */
export const BRAND_CENTER = 'Community Donation Center';
/** Long tagline (title / store copy). */
export const BRAND_TAGLINE = `A ${BRAND} Community Donation Center experience`;
/** Drum serial plate model line. */
export const BRAND_MODEL = `${BRAND}  DD-16`;
