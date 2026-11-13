# src/render — baseline three.js views (swap file by file)

Rendering only **reads** `sim.state` and **listens** to bus events. It never mutates the sim.

```js
const view = createRenderer({ canvas, bus, settings });   // src/render/index.js
view.update(simState, alpha, dt);   // every frame; alpha = interpolation 0..1, dt = sim-scaled seconds
view.setQuality('low'|'medium'|'high'); view.resize(); view.info(); view.dispose();
```

## Scene graph

* `ctx.worldGroup` — static facility, droplets in flight (world space, gravity straight down).
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
| `blood/index.js` | VFX | droplets (world space), wall/glass splats (drum space) | `state.blood.bleeders`, bus `blood:spurt`(burst), `limb:sever`, `donor:death` |
| `blood/pool.js` | VFX | liquid prism + surface sheet | `state.pool.level/prevLevel`, `fill`; `liquidPolygon()` from `src/sim/geom.js` |
| `camera.js` | VFX | fixed front camera, sway, shake, zoom punch | bus `slam`, `limb:sever`, `combo`, `impact`… |
| `post.js` | VFX | `{ render(dt), resize(w,h), dispose() }` — baseline plain render | — |

Interpolation: a part's displayed pose is `lerp(p.px, p.x, alpha)` / `slerp(p.pq*, p.q*, alpha)`;
the pool level `lerp(prevLevel, level, alpha)`; the drum angle `lerp(prevTheta, theta, alpha)`.

Useful sim fields: `state.drum` (`theta, omega, jolt, ux, uy, hw, hh, hd`), `state.pool`,
`state.donors` (`look.gown/skin/accessory`, `speech`), `state.hatch` (`wall, at|x,y, open`),
`state.blood.bleeders` (`x,y,z, dx,dy,dz, rate` drum-local, ≤ 48), `state.T` (tunables).

Budgets: ≤ 250 draw calls (`view.info().calls`; baseline ≈ 50–60), one shadow-casting light.
Quality presets in `QUALITY` (`index.js`): pixel ratio, shadows, droplet/splat caps.
