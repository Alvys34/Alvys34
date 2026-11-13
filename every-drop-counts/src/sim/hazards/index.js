/**
 * Hazard plugin registry. See src/sim/README.md "Adding a hazard".
 *
 * HazardDef = {
 *   type: 'saw',
 *   create(ctx, spec, id) -> HazardInstance
 * }
 * HazardInstance = {
 *   id, type, spec,
 *   view: {...}                     // plain data the renderer draws (drum-local coords), updated in place
 *   load: 0..1                      // how busy it is (audio: sawLoad / grinderLoad)
 *   preStep?(ctx, dt)               // before physics (move kinematic bodies, push bodies via d.vx..)
 *   postStep?(ctx, dt)              // after physics: test ctx.parts, call damagePart(...)
 *   onContact?(ctx, part, dv, F)    // contact-force event between one of its colliders and a part
 *   onSlam?(ctx)                    // SLAM fired
 *   dispose?(ctx)
 * }
 * Register colliders you create with: ctx.owners.set(collider.handle, { kind: 'hazard', hazard: inst })
 * and attach them to ctx.drumBody (the static drum shell) so they rotate with the drum.
 */
import spikes from './spikes.js';
import saw from './saw.js';

export const HAZARD_TYPES = Object.create(null);

export function registerHazard(def) {
  if (!def || !def.type || typeof def.create !== 'function') throw new Error('registerHazard: need {type, create}');
  HAZARD_TYPES[def.type] = def;
  return def;
}

export function createHazard(ctx, spec, id) {
  const def = HAZARD_TYPES[spec.type];
  if (!def) throw new Error(`Unknown hazard type "${spec.type}"`);
  const inst = def.create(ctx, spec, id);
  inst.id = id;
  inst.type = spec.type;
  inst.spec = spec;
  if (inst.load == null) inst.load = 0;
  return inst;
}

registerHazard(spikes);
registerHazard(saw);
