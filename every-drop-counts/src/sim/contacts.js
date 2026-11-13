/**
 * Contact force events -> impact damage, crush damage and `impact` sound events.
 *
 * Rapier reports a collider pair when its total contact force exceeds the per-collider threshold
 * (set on donor parts). We do NOT derive damage from the force (joint-coupled limbs would get the
 * whole body's momentum); instead the IMPACT SPEED is the pre-step relative velocity of the pair
 * along the contact normal (maxForceDirection). Resting contacts have ~0 approach speed.
 * Sustained huge forces (piles, Big Giver landing) deal crush damage.
 * Hazards can claim contacts with their own colliders through `hazard.onContact`.
 */
import { damagePart } from './donor.js';

const MAX_IMPACT_EVENTS_PER_STEP = 3;
const dirTmp = { x: 0, y: 0, z: 0 };

export function processContacts(ctx, dt) {
  const { eventQueue, owners, T } = ctx;
  const D = T.damage;
  const impacts = ctx._impacts || (ctx._impacts = []);
  impacts.length = 0;

  eventQueue.drainContactForceEvents((ev) => {
    const o1 = owners.get(ev.collider1());
    const o2 = owners.get(ev.collider2());
    if (!o1 || !o2) return;
    const F = ev.totalForceMagnitude();
    const n = ev.maxForceDirection(dirTmp);
    const v1 = velOf(o1); const v2 = velOf(o2);
    const approach = Math.abs((v1[0] - v2[0]) * n.x + (v1[1] - v2[1]) * n.y + (v1[2] - v2[2]) * n.z);
    if (o1.kind === 'prop' && o1.prop.onContact && !o1.prop.removed) o1.prop.onContact(ctx, o2, approach, F, o1.dyn);
    if (o2.kind === 'prop' && o2.prop.onContact && !o2.prop.removed) o2.prop.onContact(ctx, o1, approach, F, o2.dyn);
    handleSide(ctx, o1, o2, F, approach, dt, impacts, D);
    handleSide(ctx, o2, o1, F, approach, dt, impacts, D);
  });
  eventQueue.drainCollisionEvents(() => {});

  if (impacts.length) {
    impacts.sort((a, b) => b.speed - a.speed);
    const n = Math.min(MAX_IMPACT_EVENTS_PER_STEP, impacts.length);
    for (let i = 0; i < n; i++) {
      const im = impacts[i];
      ctx.emit('impact', { kind: im.kind, speed: +im.speed.toFixed(2), mass: +im.mass.toFixed(1) }, im.pos);
    }
  }
}

const ZERO = [0, 0, 0];
function velOf(o) {
  if (o.kind === 'part') { const p = o.part; return [p.pvx, p.pvy, p.pvz]; }
  if (o.kind === 'prop' && o.dyn) { const d = o.dyn; return [d.pvx, d.pvy, d.pvz]; }
  return ZERO;
}

function handleSide(ctx, self, other, F, speed, dt, impacts, D) {
  if (self.kind !== 'part') return;
  const part = self.part;
  if (part.removed) return;
  if (other.kind === 'hazard' && other.hazard.onContact) other.hazard.onContact(ctx, part, speed, F);
  let kind = 'flesh';
  if (other.kind === 'wall') kind = other.material === 'glass' ? 'glass' : 'metal';
  else if (other.kind === 'hazard') kind = 'metal';
  else if (other.kind === 'prop') kind = 'prop';
  if (other.kind === 'part' && other.part.donor === part.donor) return; // own limbs: posture noise

  if (speed >= D.impactEventMinDv && (other.kind !== 'part' || self.part.uid < other.part.uid)) {
    impacts.push({ kind, speed, mass: part.mass, pos: [part.x, part.y, part.z] });
  }
  // Big Givers landing on someone press them (an open, bleeding injury — they are a weapon)
  const crushBonus = other.kind === 'part' ? other.part.donor.def.crushBonus : 0;
  if (crushBonus && speed > 8 && !part.donor.def.crushBonus) {
    damagePart(ctx, part, (speed - 8) * 6 * crushBonus, 'press', 'crush');
  }
  if (speed > D.impactMinDv) {
    let dmg = (speed - D.impactMinDv) * D.impactScale;
    if (other.kind === 'part') dmg *= Math.min(2.5, Math.sqrt(other.part.mass / D.impactMassRef));
    else if (other.kind === 'prop' && other.dyn) dmg *= Math.min(2.5, Math.sqrt(other.dyn.mass / D.impactMassRef));
    if (part.role === 'head') dmg *= 1.3;
    damagePart(ctx, part, dmg, 'blunt', 'impact');
  } else if (F > D.crushForce) {
    damagePart(ctx, part, D.crushDps * dt * (F / D.crushForce), 'crush', 'crush');
  }
}
