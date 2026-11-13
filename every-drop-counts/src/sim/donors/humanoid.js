/**
 * Standard humanoid body plan (donor-local frame: feet at y=0, +y up, +z = facing the camera).
 * GDD §6 lists: head, chest, pelvis, 2x upper arm, 2x forearm, 2x thigh, 2x shin = 11 bodies.
 *
 * Shapes are Rapier primitives in the part's local frame (capsules along local y).
 * `role` keys into TUNABLES.donor.parts (hp / blood share / mass).
 * Joints: spherical with per-axis angular limits (radians, in the PARENT's frame):
 *   x = flex forward/back, y = twist about the limb, z = sideways (abduction).
 * `motor: true` joints get a weak position motor while the donor is alive (posture / leg stiffness).
 *
 * A donor type may provide its own plan (e.g. scaled Big Giver) via `scalePlan()`.
 */
export const HUMANOID = {
  rootHeight: 0.98, // pelvis centre height: spawn positions refer to this point
  parts: [
    { name: 'pelvis', role: 'pelvis', shape: { type: 'box', hx: 0.16, hy: 0.09, hz: 0.1 }, pos: [0, 0.98, 0] },
    {
      name: 'chest', role: 'chest', shape: { type: 'box', hx: 0.19, hy: 0.2, hz: 0.11 }, pos: [0, 1.32, 0],
      parent: 'pelvis', anchor: [0, 1.095, 0], limits: { x: [-0.5, 0.6], y: [-0.4, 0.4], z: [-0.35, 0.35] }, motor: 'spine',
    },
    {
      name: 'head', role: 'head', shape: { type: 'ball', r: 0.13 }, pos: [0, 1.70, 0],
      parent: 'chest', anchor: [0, 1.555, 0], limits: { x: [-0.6, 0.6], y: [-0.9, 0.9], z: [-0.45, 0.45] }, motor: 'neck',
    },
    {
      name: 'upperArmL', role: 'upperArm', side: -1, shape: { type: 'capsule', hh: 0.1, r: 0.055 }, pos: [-0.27, 1.33, 0],
      parent: 'chest', anchor: [-0.265, 1.47, 0], limits: { x: [-2.2, 1.0], y: [-0.8, 0.8], z: [-2.6, 0.15] },
    },
    {
      name: 'upperArmR', role: 'upperArm', side: 1, shape: { type: 'capsule', hh: 0.1, r: 0.055 }, pos: [0.27, 1.33, 0],
      parent: 'chest', anchor: [0.265, 1.47, 0], limits: { x: [-2.2, 1.0], y: [-0.8, 0.8], z: [-0.15, 2.6] },
    },
    {
      name: 'forearmL', role: 'forearm', side: -1, shape: { type: 'capsule', hh: 0.085, r: 0.05 }, pos: [-0.27, 1.04, 0],
      parent: 'upperArmL', anchor: [-0.27, 1.18, 0], limits: { x: [-2.3, 0.05], y: [-0.2, 0.2], z: [-0.15, 0.15] },
    },
    {
      name: 'forearmR', role: 'forearm', side: 1, shape: { type: 'capsule', hh: 0.085, r: 0.05 }, pos: [0.27, 1.04, 0],
      parent: 'upperArmR', anchor: [0.27, 1.18, 0], limits: { x: [-2.3, 0.05], y: [-0.2, 0.2], z: [-0.15, 0.15] },
    },
    {
      name: 'thighL', role: 'thigh', side: -1, shape: { type: 'capsule', hh: 0.13, r: 0.075 }, pos: [-0.1, 0.70, 0],
      parent: 'pelvis', anchor: [-0.1, 0.905, 0], limits: { x: [-1.9, 0.45], y: [-0.5, 0.5], z: [-0.8, 0.15] }, motor: 'hip',
    },
    {
      name: 'thighR', role: 'thigh', side: 1, shape: { type: 'capsule', hh: 0.13, r: 0.075 }, pos: [0.1, 0.70, 0],
      parent: 'pelvis', anchor: [0.1, 0.905, 0], limits: { x: [-1.9, 0.45], y: [-0.5, 0.5], z: [-0.15, 0.8] }, motor: 'hip',
    },
    {
      name: 'shinL', role: 'shin', side: -1, shape: { type: 'capsule', hh: 0.14, r: 0.06 }, pos: [-0.1, 0.27, 0],
      parent: 'thighL', anchor: [-0.1, 0.485, 0], limits: { x: [-0.05, 2.3], y: [-0.15, 0.15], z: [-0.12, 0.12] }, motor: 'knee',
    },
    {
      name: 'shinR', role: 'shin', side: 1, shape: { type: 'capsule', hh: 0.14, r: 0.06 }, pos: [0.1, 0.27, 0],
      parent: 'thighR', anchor: [0.1, 0.485, 0], limits: { x: [-0.05, 2.3], y: [-0.15, 0.15], z: [-0.12, 0.12] }, motor: 'knee',
    },
  ],
};

/** Uniformly scale a body plan (sizes/positions). Masses are scaled separately by the donor type. */
export function scalePlan(plan, k) {
  const s = (v) => v.map((c) => c * k);
  return {
    rootHeight: plan.rootHeight * k,
    parts: plan.parts.map((p) => {
      const shape = { ...p.shape };
      for (const key of ['hx', 'hy', 'hz', 'r', 'hh']) if (key in shape) shape[key] *= k;
      return { ...p, shape, pos: s(p.pos), anchor: p.anchor ? s(p.anchor) : undefined };
    }),
  };
}

/** Bounding radius of a shape (used by analytic hazard / pool tests). */
export function shapeRadius(shape) {
  switch (shape.type) {
    case 'ball': return shape.r;
    case 'capsule': return shape.hh + shape.r;
    case 'box': return Math.hypot(shape.hx, shape.hy, shape.hz);
    case 'cylinder': return Math.hypot(shape.hh, shape.r);
    default: return 0.2;
  }
}

/** "Thickness" radius — the smallest half-extent (used for surface contact tests). */
export function shapeThickness(shape) {
  switch (shape.type) {
    case 'ball': return shape.r;
    case 'capsule': return shape.r;
    case 'box': return Math.min(shape.hx, shape.hy, shape.hz);
    case 'cylinder': return Math.min(shape.hh, shape.r);
    default: return 0.1;
  }
}
