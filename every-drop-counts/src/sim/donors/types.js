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
import { removePart } from '../donor.js';

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
  // level.inspectorVisit (s): he only observes this long. If his sphere is still intact when the
  // visit is over he leaves through the hatch: +20 L compliance bonus right away, event
  // `inspector:exit { id }`. (Shift 5 has no visit limit: there he stays all shift.)
  preStep(ctx, donor, dt) {
    if (!donor.alive || donor.visitLeft == null) return;
    donor.visitLeft -= dt;
    if (donor.visitLeft > 0 || !donor.encased || !donor.sphere) return;
    const pel = donor.parts.pelvis;
    const pos = [pel.x, pel.y, pel.z];
    donor.alive = false; donor.left = true; donor.speech = null;
    donor.sphere.leave(ctx);
    for (const p of donor.partList) if (!p.removed) removePart(ctx, p, { release: false });
    const held = ctx.scoring.compliance.held.length;
    ctx.scoring.earnCompliance(ctx, IN.bonus, { donorId: donor.id, inspector: donor.inspectorNo });
    const pending = ctx.scoring.compliance.held.length > held;
    ctx.scoring.inspectorsSaved = (ctx.scoring.inspectorsSaved || 0) + 1;
    ctx.emit('inspector:exit', { id: donor.id, inspector: donor.inspectorNo, bonusPending: pending }, pos);
    ctx.emit('pa:announce', { text: `${inspectorName(ctx, donor)} has concluded his visit. ${pending ? 'Compliance bonus pending your quota.' : 'Compliance noted.'}`, mood: 'calm' });
  },
  onSpawn(ctx, donor) {
    // numbered per shift so messages can say WHICH Inspector (shift 8 has two visits)
    ctx.inspectorCount = (ctx.inspectorCount || 0) + 1;
    donor.inspectorNo = ctx.inspectorCount;
    if (ctx.level && ctx.level.inspectorVisit) donor.visitLeft = ctx.level.inspectorVisit;
    const pel = donor.parts.pelvis;
    const sphere = createProp(ctx, { type: 'safetySphere', donor, pos: [pel.x, pel.y, pel.z], vel: [pel.body.linvel().x, pel.body.linvel().y, 0] }, ctx.nextPropId++);
    ctx.props.push(sphere);
  },
  onDeath(ctx, donor, cause) {
    ctx.scoring.addFine(IN.fine, 'workplace-incident', { donorId: donor.id, inspector: donor.inspectorNo });
    ctx.scoring.inspectorDeaths = (ctx.scoring.inspectorDeaths || 0) + 1;
    const who = multipleInspectors(ctx) ? ` (${inspectorName(ctx, donor)})` : '';
    ctx.emit('pa:announce', { text: cause === 'drown' ? `${multipleInspectors(ctx) ? inspectorName(ctx, donor) : 'An Inspector'} has drowned. A fine has been deducted. Swimming was not in his remit.` : `Workplace incident logged${who}. A fine has been deducted from your tank.`, mood: 'urgent' });
  },
  onShiftEnd(ctx, donor) {
    if (donor.alive) {
      // paid only if the donors alone met the 1-drop quota (scoring.earnCompliance)
      ctx.scoring.earnCompliance(ctx, IN.bonus, { donorId: donor.id, inspector: donor.inspectorNo });
      ctx.scoring.inspectorsSaved = (ctx.scoring.inspectorsSaved || 0) + 1;
    }
  },
};

/** does this shift have (or has it had) more than one Inspector? then messages name which one */
function multipleInspectors(ctx) {
  if ((ctx.inspectorCount || 0) > 1) return true;
  const waves = (ctx.level && ctx.level.waves) || [];
  let n = 0;
  for (const w of waves) {
    if (Array.isArray(w.types)) n += w.types.filter((t) => t === 'inspector').length;
    else if (w.types) n += w.types.inspector || 0;
  }
  return n > 1 || ctx.levelId === 'overtime';
}
function inspectorName(ctx, donor) {
  return multipleInspectors(ctx) && donor.inspectorNo ? `Inspector #${donor.inspectorNo}` : 'The Inspector';
}
