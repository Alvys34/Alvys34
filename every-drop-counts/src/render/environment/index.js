/**
 * Environment (ART owns): facility backdrop (world, never rotates), the drum (rotates with
 * ctx.drumGroup), lighting with fill-driven escalation.
 *
 * createEnvironment(ctx) -> { update(dt, state, alpha), onLevel(state), setQuality(q, name), dispose(),
 *                             surfaces, lighting, emergency (0..1, read-only) }
 *
 * Shared ART resources published on ctx (read-only for other pieces):
 *   ctx.artMaterials   palette materials (environment/palette.js sharedMaterials)
 *   ctx.artSigns       { texture, material, rects } signage atlas (environment/textures.js signAtlas)
 *   ctx.drumSurfaces   { back, sides, glass, frame, HW, HH, HD } drum meshes (VFX blood canvas)
 *   ctx.environment.emergency   0..1 escalation amount actually shown by the lights
 */
import { sharedMaterials } from './palette.js';
import { signAtlas, toTexture } from './textures.js';
import { createLighting } from './lighting.js';
import { createFacility } from './facility.js';
import { createDrum } from './drum.js';

export function getSigns(ctx) {
  if (ctx.artSigns) return ctx.artSigns;
  const { THREE } = ctx;
  const atlas = signAtlas();
  const texture = toTexture(THREE, atlas.canvas, { aniso: 8 });
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0, transparent: true, alphaTest: 0.02 });
  ctx.artSigns = { texture, material, rects: atlas.rects };
  return ctx.artSigns;
}

export function createEnvironment(ctx) {
  const M = sharedMaterials(ctx);
  const signs = getSigns(ctx);
  const facility = createFacility(ctx, M, signs);
  const drum = createDrum(ctx, M, signs);
  const lighting = createLighting(ctx, { tubes: [...facility.tubes, drum.lamps], beacon: facility.beacon });

  const api = {
    surfaces: drum.surfaces,
    lighting,
    get emergency() { return lighting.emergency; },
    onLevel(state) { drum.onLevel(state); },
    update(dt, state) {
      lighting.update(dt, state);
      facility.update(dt, state);
      drum.update(dt, state);
    },
    setQuality(q, name) {
      lighting.setQuality(q, name);
      facility.setQuality(q, name);
      drum.setQuality(q, name);
    },
    dispose() {
      lighting.dispose(); facility.dispose(); drum.dispose();
      if (ctx.artSigns) { ctx.artSigns.texture.dispose(); ctx.artSigns.material.dispose(); ctx.artSigns = null; }
      if (ctx.artMaterials) { for (const m of Object.values(ctx.artMaterials)) m.dispose(); ctx.artMaterials = null; }
    },
  };
  return api;
}
