/**
 * CONTENT donor types (registered by donors/index.js — this file must not import it).
 *
 *  bigGiver  — large and heavy: ~2x blood, ~2.5x mass, 1.3x size; hard to slam; when it lands
 *              on another donor it presses them ('press' damage scaled by crushBonus).
 *  thinBlood — pale, red wristband: wounds bleed 3x faster and never clot (drain completely).
 *  inspector — suit + orange hard hat, spawns inside a rolling personal safety sphere
 *              (src/sim/props/safetySphere.js). MUST SURVIVE: death = −25 L fine
 *              ('workplace-incident'), alive at shift end = +20 L ('compliance' bonus).
 *              Never counts toward kills/combos; does not block "all donors processed".
 *
 * Render hints on donor.look: { gown, skin, accessory: null|'wristband'|'hardhat',
 *   outfit: 'gown'|'suit'|'staff', scale }  — see src/sim/README.md.
 */
import { HUMANOID, scalePlan } from './humanoid.js';
import { TUNABLES } from '../../core/tunables.js';
import { createProp } from '../props/index.js';

const BG = TUNABLES.donorTypes.bigGiver;
const TB = TUNABLES.donorTypes.thinBlood;
const IN = TUNABLES.donorTypes.inspector;

export const BIG_GIVER = {
  type: 'bigGiver',
  plan: scalePlan(HUMANOID, BG.scale),
  scale: BG.scale,
  massScale: BG.massScale, bloodScale: BG.bloodScale, hpScale: BG.hpScale, slamScale: BG.slamScale,
  crushBonus: BG.crushBonus,
  behaviour: { upright: BG.upright, flail: 2.0, legs: 1 },
  look: {
    gown: [0xffc2c2, 0xc2e0ff, 0xd8f5c4, 0xffe4b5],
    skin: [0xf6d2b8, 0xe8b893, 0xc68e64, 0x9a6a46, 0xffe0c7],
  },
  lines: [
    'I brought extra!', 'Double portion, please.', 'Is there a weight limit?', 'I always give generously.',
    'Mind your toes!', 'They said I was a universal donor.', 'Coming through!',
  ],
};

export const THIN_BLOOD = {
  type: 'thinBlood',
  bloodScale: TB.bloodScale, hpScale: TB.hpScale, bleedScale: TB.bleedScale, clotScale: TB.clotScale,
  behaviour: { upright: 0.8, flail: 1.3, legs: 0.8 },
  look: {
    gown: [0xeef3f6, 0xe6eef0],
    skin: [0xf3e6dc, 0xeadbd0, 0xf8ece4],
    accessory: 'wristband',
  },
  lines: [
    'I bruise easily.', 'Careful, I\'m a bleeder.', 'My doctor said to avoid... this.', 'Is that my blood or yours?',
    'I feel faint.', 'I was told this was low impact.',
  ],
};

export const INSPECTOR = {
  type: 'inspector',
  mustSurvive: true,
  noCombo: true,
  keepLook: true, // shift 8 staff outfits do not apply: he brought his own suit
  hpScale: IN.hpScale,
  behaviour: { upright: 1.2, flail: 0.6, legs: 1 },
  look: {
    gown: [0x3c4652, 0x2f3a46, 0x4a4f5a],
    skin: [0xf6d2b8, 0xe8b893, 0xc68e64, 0x9a6a46, 0xffe0c7],
    accessory: 'hardhat',
    outfit: 'suit',
  },
  lines: [
    'Just observing.', 'Is this compliant?', 'I\'ll need to see your paperwork.', 'Noted.',
    'Where is the emergency stop?', 'This will be in my report.', 'Please keep me level.',
    'Who signed off on the saws?', 'My sphere is rated for three impacts.',
  ],
  shatterLines: ['Oh dear.', 'That was my sphere.', 'This is highly irregular.', 'Write that down. No, wait.'],
  onSpawn(ctx, donor) {
    const pel = donor.parts.pelvis;
    const sphere = createProp(ctx, { type: 'safetySphere', donor, pos: [pel.x, pel.y, pel.z], vel: [pel.body.linvel().x, pel.body.linvel().y, 0] }, ctx.nextPropId++);
    ctx.props.push(sphere);
  },
  onDeath(ctx, donor, cause) {
    ctx.scoring.addFine(IN.fine, 'workplace-incident');
    ctx.scoring.inspectorDeaths = (ctx.scoring.inspectorDeaths || 0) + 1;
    ctx.emit('pa:announce', { text: cause === 'drown' ? 'An Inspector has drowned. A fine has been deducted. Swimming was not in his remit.' : 'Workplace incident logged. A fine has been deducted from your tank.', mood: 'urgent' });
  },
  onShiftEnd(ctx, donor) {
    if (donor.alive) {
      ctx.scoring.addBonus(IN.bonus, 'compliance');
      ctx.scoring.inspectorsSaved = (ctx.scoring.inspectorsSaved || 0) + 1;
    }
  },
};
