# src/render — baseline three.js views (swap file by file)

Rendering only **reads** `sim.state` and **listens** to bus events. It never mutates the sim.

```js
const view = createRenderer({ canvas, bus, settings });   // src/render/index.js
view.update(simState, alpha, dt, frame);   // every frame; alpha = interpolation 0..1, dt = sim-scaled seconds,
                                           // frame = { realDt, timeScale, paused, slowMo, hitStop } from the loop
view.setQuality('low'|'medium'|'high'); view.resize(); view.info(); view.dispose();
view.setReduceFlashing(bool);              // live: post accents, light flicker, lamp blink (settings.reduceFlashing)
view.setHudInsets({ top, left, right } | null);  // HUD corner plates (viewport fractions) -> camera top band
view.playEnding() / view.stopEnding();     // shift-8 ending camera (refuses unless the shift has ended)
```

## Scene graph

* `ctx.worldGroup` — static facility; the pool group (world-aligned, follows the drum's jolt position).
* `ctx.drumGroup` — rotated by the **interpolated** drum angle (+ slam jolt offset). Anything
  authored in **drum-local** coordinates (the sim's frame: walls, hazards, donors, pool, stains)
  goes here, so poses from the sim are used as-is.
* `ctx.drumAngle` — interpolated angle this frame; `ctx.toWorld(x,y,z)` converts drum-local → world.

## Piece contract

Each piece is `createX(ctx) -> { update(dt, state, alpha), onLevel?(state), setQuality?(q, name), dispose() }`.
`onLevel` fires when `state.level` changes (rebuild level-specific geometry). Replace a piece by
editing its file; keep the factory name and return shape.

| File | Owner | Builds | Reads |
|---|---|---|---|
| `environment/index.js` | ART | facility backdrop, drum shell + glass + frame, hatch, lights | `state.hatch`, `state.pool.fill` (tone shift) |
| `donors/index.js` | ART | donor parts (one InstancedMesh per role), faces, stump caps | `state.parts` (pose prev/current, `donor.look`, `alive`, `blood`, `stumps`) |
| `donors/hazards.js` | ART | hazard meshes from `hazard.view` (`HAZARD_BUILDERS[kind]`) | `state.hazards[i].view` (spikes: wall/from/to/z0/z1/height; saw: x/y/z0/z1/radius/angle/spin) |
| `blood/index.js` | VFX | droplets + mist (drum space, rotating-frame ballistics), runners/drips, smears, tide marks (+ `droplets.js`, `atlas.js`, `runners.js`) | `state.blood.bleeders`, `state.parts` (smears), `state.hazards[].view` (saw spray), bus `blood:spurt`, `limb:sever`, `donor:death`, `hazard:contact`, `prop:explode`, `impact`, `slam` |
| `blood/pool.js` | VFX | pool volume (depth-absorbing slices), wavy glossy surface, foam, bubbles, splashes; `ctx.poolFx` | `state.pool.level/prevLevel`, `fill`, `state.drum.omega/alpha`, `state.dyns` (`sub`), `state.hazards[].view` (churn), bus `splash`, `slam`, `part:dissolve` |
| `camera.js` | VFX | angle-adaptive fit (whole interior always on screen, 4:3–21:9), top band for the HUD plates (≤ 12 % of the height, only while a mid-depth drum corner would sit under a plate: 16:9/16:10 near upright), sway, shake, kicks, zoom punch, shift-8 ending drift into the hatch | `ctx.drumAngle`, `state.drum.omega`, `state.hatch`, `settings.screenShake`, `settings.cameraZoomRange`, `settings.hudInsets`, bus `slam`, `limb:sever`, `combo`, `impact`, `prop:explode`, `shift:start` |
| `post.js` | VFX | HDR target, bloom, grade + fill escalation, ACES, vignette, CA, grain, slam/hit-stop/slow-mo/combo accents (off with `settings.reduceFlashing`); `{ render(dt, state, frame), resize, setQuality, stats, dispose }` | `state.pool.fill`, `frame` (real pause / slow-mo / hit-stop from the loop), bus `slam`, `prop:explode`, `combo` (+ `limb:sever`, `donor:death`, `game:pause` only without `frame`) |

Interpolation: a part's displayed pose is `lerp(p.px, p.x, alpha)` / `slerp(p.pq*, p.q*, alpha)`;
the pool level `lerp(prevLevel, level, alpha)`; the drum angle `lerp(prevTheta, theta, alpha)`.

Useful sim fields: `state.drum` (`theta, omega, jolt, ux, uy, hw, hh, hd`), `state.pool`,
`state.donors` (`look.gown/skin/accessory`, `speech`), `state.hatch` (`wall, at|x,y, open`),
`state.blood.bleeders` (`x,y,z, dx,dy,dz, rate` drum-local, ≤ 48), `state.T` (tunables).

Budgets: ≤ 250 draw calls (`view.info().calls`; baseline ≈ 50–60), one shadow-casting light.
Quality presets in `QUALITY` (`quality.js`, re-exported by `index.js`): pixel ratio, shadows, particle caps,
blood-map resolution, stamps/frame, pool slices, MSAA, bloom levels, CA/grain. `renderer.info.autoReset` is
off (several passes per frame); `view.info()` covers the whole frame.

## VFX interfaces (blood colour, shake, quality)

* **Blood colour — single source:** `src/render/blood/palette.js`. `bloodColors.fresh/deep/dry/hi/foam/mist`
  (THREE.Color, linear, mutated in place), `bloodUniforms` (shared shader uniforms), `setBloodColor('red'|'green')`,
  `onBloodColor(fn)`. From the game/UI: `view.setBloodColor(name)` / `view.bloodColor`; the initial value is
  `settings.bloodColor`. ART: use `material.color = bloodColors.fresh` (same object → follows the setting).
* **Screen shake:** `view.setScreenShake(v)` (0..1, booleans accepted) or `settings.screenShake`; scales sway,
  shake, kicks and zoom punch to zero. `settings.cameraZoomRange` (0..1, default 0.85) softens the adaptive zoom.
* **Quality:** `view.setQuality(name)` (player choice = ceiling), `view.setAutoQuality(bool)` (auto-degrade on
  by default except under `?debug=1`; `?autoq=1` forces it on), `view.perf()` → `{ quality, autoLevel, frameMs,
  loadScale, pixelRatio, blood: {drops, mist, runners, glassLoad, …}, post: {msaa, bloomLevels, passes} }`.
* `ctx.poolFx` (pool → blood): `{ wave, level, on, impulse(xw,a), addFoam(xw,a), ring(xw,z,amp) }`;
  `ctx.blood.emitLocal(x,y,z,vx,vy,vz,size,life,kind,mist)` spawns blood particles (drum-local).
* Tools: `tools/vfxshot.mjs` (canvas capture, stops the RAF loop; for slow SwiftShader), `tools/scripts/vfx-*.json`.

## ART (environment, donors, hazards, props) — interfaces

* Files: `environment/{index,palette,textures,geo,lighting,facility,drum}.js`, `donors/{index,bodyparts,material,looks,faces,hazards,props}.js`.
  `donors/props.js` exports `createPropViews` (wired in `index.js`, replaces `placeholders/`); `PROP_BUILDERS[kind]`
  and `HAZARD_BUILDERS[kind]` (`(ctx, view, kit) => { group, update(view, dt, …), dispose? }`) are the extension points.
* Palette: `environment/palette.js` `PAL`/`CSS`/`DONOR_PAL` — no reds. Anything blood-coloured (stump caps, wound
  cores, spike tips, stained blades, tank gauge, Thin-Blood band) uses VFX's live `blood/palette.js bloodColors.fresh`
  object directly (`material.color = bloodColors.fresh`), so red / streamer-green recolours it.
* Canvas text uses the bundled UI font (`'Nunito Variable'`, @fontsource) via `textures.js FONT`; atlases are redrawn
  once `document.fonts` has loaded it (`onFontsReady`), system fonts are only a first-frame fallback.
* Shared on ctx: `ctx.artMaterials` (shared metal/paint materials), `ctx.artSigns` (signage atlas `{texture, material, rects}`),
  `ctx.drumSurfaces = { back, sides, glass, frame, HW, HH, HD }` (drum meshes; the back wall's map is ART's tile canvas —
  overlay blood, don't replace the map), `ctx.environment.emergency` (0..1 escalation actually shown by the lights),
  `ctx.environment.lighting.lights` `{ hemi, key (the ONLY shadow caster), fill, rim, spot (beacon) }`.
* Lighting: procedural PMREM environment map (`scene.environment`), fill-driven escalation (key/hemi drift to red,
  failing fluorescent tubes, rotating beacon spot from ~45 % fill). All lights always exist (intensity 0 when off).
* Donors: one InstancedMesh per role + one per hairstyle/hat + stump caps + bone nubs; per-instance colour slots
  (gown/skin/trim/feet/band/hair/arm/leg/lower/accent), face atlas cell (smile, blink, worried, hurt, drown, dead),
  wound/drain state, a rim light (alive donors) and an inverted-hull outline mesh per role (shares the instance
  matrices). Visual sizes follow each part's sim shape per axis (fixed reference sizes in `donors/index.js REF`). Looks are resolved from `donor.type` + `donor.look` (`outfit: 'gown'|'suit'|'staff'`, `accessory`).
* Quality: `low` = no shadows, facility detail props hidden; `medium/high` shadow map 1024/2048 (PCF radius 2.5/3.5).
