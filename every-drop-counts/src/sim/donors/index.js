/**
 * Donor type registry. A donor type is pure data + optional hooks; the ragdoll/damage/blood
 * machinery is shared (src/sim/donor.js). See src/sim/README.md "Adding a donor type".
 *
 * DonorTypeDef = {
 *   type: 'standard',            // unique id (used in level wave specs and bus events)
 *   plan: HUMANOID,              // body plan (src/sim/donors/humanoid.js); scalePlan() for size
 *   massScale: 1,                // multiplies TUNABLES.donor.parts[*].mass
 *   bloodScale: 1,               // multiplies TUNABLES.donor.blood
 *   hpScale: 1,                  // multiplies part hp
 *   bleedScale: 1,               // multiplies every wound rate (Thin-Blood: big)
 *   slamScale: 1,                // multiplies slam delta-v (Big Giver: "hard to slam")
 *   behaviour: { upright: 1, flail: 1, legs: 1 },   // multipliers on alive behaviour
 *   look: { gown: [0xRRGGBB...], skin: [...], accessory?: 'hardhat'|'wristband'|... }  // render hints
 *   lines: ['Happy to help!', ...],                  // speech bubbles (donor:speak)
 *   // optional hooks (all receive the sim ctx):
 *   onSpawn(ctx, donor), preStep(ctx, donor, dt), postStep(ctx, donor, dt),
 *   onDeath(ctx, donor, cause), onShiftEnd(ctx, donor)
 * }
 */
import { HUMANOID } from './humanoid.js';

export const DONOR_TYPES = Object.create(null);

export function registerDonorType(def) {
  if (!def || !def.type) throw new Error('registerDonorType: missing type');
  DONOR_TYPES[def.type] = {
    plan: HUMANOID, massScale: 1, bloodScale: 1, hpScale: 1, bleedScale: 1, slamScale: 1,
    behaviour: { upright: 1, flail: 1, legs: 1 },
    look: { gown: [0xa8e6cf], skin: [0xf1c27d] },
    lines: [],
    ...def,
  };
  return DONOR_TYPES[def.type];
}

export function getDonorType(type) {
  const def = DONOR_TYPES[type];
  if (!def) throw new Error(`Unknown donor type "${type}"`);
  return def;
}

registerDonorType({
  type: 'standard',
  look: {
    gown: [0xa8e6cf, 0xbfd7ff, 0xffd3b6, 0xe2c6ff, 0xfff1a8, 0xc9f0e8],
    skin: [0xf6d2b8, 0xe8b893, 0xc68e64, 0x9a6a46, 0xffe0c7],
  },
  lines: [
    'Happy to help!', 'Is this normal?', "I was told there'd be cookies.", 'Every drop counts!',
    'Do I get a sticker?', 'Wheee?', 'My form said ten minutes.', 'Should it be spinning?',
    'I feel lighter already!', 'Is that a saw?', 'Lovely tiles.', 'I donate every year!',
  ],
});
