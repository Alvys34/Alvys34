# src/render — baseline three.js views (swap file by file)

Rendering only **reads** `sim.state` and **listens** to bus events. It never mutates the sim.

```js
const view = createRenderer({ canvas, bus, settings });   // src/render/index.js
view.update(simState, alpha, dt);   // every frame; alpha = interpolation 0..1, dt = sim-scaled seconds
view.setQuality('low'|'medium'|'high'); view.resize(); view.info(); view.dispose();
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
| `camera.js` | VFX | angle-adaptive fit (whole interior always on screen, 4:3–21:9), sway, shake, kicks, zoom punch | `ctx.drumAngle`, `state.drum.omega`, `settings.screenShake`, `settings.cameraZoomRange`, bus `slam`, `limb:sever`, `combo`, `impact`, `prop:explode` |
| `post.js` | VFX | HDR target, bloom, grade + fill escalation, ACES, vignette, CA, grain, slam/hit-stop/slow-mo/combo accents; `{ render(dt, state), resize, setQuality, stats, dispose }` | `state.pool.fill`, bus `slam`, `limb:sever`, `donor:death`, `combo`, `prop:explode`, `game:pause` |

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
