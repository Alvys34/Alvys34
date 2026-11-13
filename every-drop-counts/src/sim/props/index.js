/**
 * Prop plugin registry (oxygen tanks, Inspector spheres, ... — CONTENT agent).
 * See src/sim/README.md "Adding a prop".
 *
 * PropDef = {
 *   type: 'oxygen-tank',
 *   create(ctx, spec, id) -> PropInstance     // build bodies/colliders, register dyns
 * }
 * PropInstance = {
 *   id, type, spec, dyns: [Dyn],              // dynamic bodies (makeDyn('prop', ...)), pushed to ctx.dyns
 *   view: {...}                               // plain render data
 *   removed: false,
 *   preStep?(ctx, dt), postStep?(ctx, dt), onContact?(ctx, otherOwner, dv, F), onSlam?(ctx), dispose?(ctx)
 * }
 * Spawn from level data: level.props = [{ type, at: seconds, wall?, pos?: [x,y,z] }] or from a wave:
 * waves: [{ at, count, props: [{ type: 'oxygen-tank', count: 1 }] }]
 */
export const PROP_TYPES = Object.create(null);

export function registerProp(def) {
  if (!def || !def.type || typeof def.create !== 'function') throw new Error('registerProp: need {type, create}');
  PROP_TYPES[def.type] = def;
  return def;
}

export function createProp(ctx, spec, id) {
  const def = PROP_TYPES[spec.type];
  if (!def) throw new Error(`Unknown prop type "${spec.type}"`);
  const inst = def.create(ctx, spec, id);
  inst.id = id; inst.type = spec.type; inst.spec = spec;
  if (!inst.dyns) inst.dyns = [];
  inst.removed = false;
  return inst;
}

import oxygenTank from './oxygenTank.js';
import safetySphere from './safetySphere.js';

registerProp(oxygenTank);
registerProp(safetySphere);
