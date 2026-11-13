# src/sim — headless game simulation

**Hard rule:** nothing in `src/sim/**` may import `three`, touch `window`/`document`, or read
wall-clock time. Randomness only through `ctx.rng` (seeded). Fixed `dt` (`TUNABLES.sim.dt`).
Every feel/balance number lives in `src/core/tunables.js` (levels may override per level).

```js
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const sim = createSim({ RAPIER, bus, seed });   // src/sim/index.js
sim.loadLevel(1);            // id 'shift-1', number 1, or an inline level object
sim.startOvertime();
sim.setInput({ rotate, brake, slam });   // rotate -1 (CCW) .. +1 (CW); slam = one-shot request
sim.step();                  // one 60 Hz step
sim.state                    // live read-only view (render/ui), see below
sim.snapshot()               // plain JSON (tests, __edc.getState)
sim.audioState()             // { fill, drumOmega, aliveCount, sawLoad, grinderLoad, intensity }
```

Run a whole shift in Node: `node tools/simbot.mjs --level 2 --policy smart` (policies
`idle|spin|rock|smart`), tests: `npm test`.

## Frames and units

Metres / kg / s / rad / display litres. Everything in sim state and bus events is **drum-local**:
origin at the drum centre, +x right, +y up when the drum angle θ = 0, +z toward the camera.
World = rotate by `drum.theta` about z. World-up in drum-local coords is `(drum.ux, drum.uy) =
(sin θ, cos θ)`; the world height of a drum-local point is `ux*x + uy*y`.
Positional bus events carry `pan` (−1..1, screen-space) **and** `pos: [x,y,z]` (drum-local).

The drum is simulated in its rotating frame (`physics.js`, `drum.js`): the shell is a static body,
gravity rotates, and centrifugal / Euler / Coriolis terms are applied to every dyn each step.

## Step order (`index.js` `step()`)

1. `mode.preStep` (clock, waves, spawner, PA) → timed props
2. `stepDrum` (rotation control, gravity) → `trySlam`
3. donor alive behaviour (`donorPreStep`), `hazard.preStep`, `prop.preStep`
4. `applyFrameForces` (fictitious forces, buoyancy, drag) → `world.step`
5. `readback` → `processContacts` (impact/crush damage) → `hazard.postStep`, `prop.postStep`
6. `stepBleeding` → `donorPostStep` (drowning, bleed-out) → `stepPool` (level, submersion, dissolve)
7. budgets (debris cap, body cap) → `scoring.step` → `mode.postStep` (end conditions)

## Key records

* **Dyn** (`physics.js makeDyn`): any dynamic body. Pose `x,y,z,qx..qw` (+ previous `px..pqw`
  for interpolation), velocity `vx..` (+ pre-step `pvx..`), pool `sub` (0..1), `removed`.
  **Change velocity only via `addVelocity(d, dx, dy, dz)`** — the force pass commits it.
  Torques may be applied directly with `d.body.applyTorqueImpulse`.
* **Part** (`donor.js`): Dyn + `donor, name, role, hp, hpMax, blood, bloodMax, wound, stumps,
  severed, broken, impaled`.
* **Donor**: `id, type, def, alive, cause, blood, bloodMax, parts{}, partList, joints, look, speech`.
* **ctx** (internal context passed to every plugin): `R` (RAPIER), `world`, `T` (tunables), `bus`,
  `rng`, `time`, `drum`, `pool`, `blood`, `scoring`, `mode`, `dyns`, `parts`, `donors`, `hazards`,
  `props`, `owners` (collider handle → owner), `drumBody`, `emit(type, payload, pos?)`.

Damage API (`donor.js`): `damagePart(ctx, part, amount, kind, cause)` — kind `cut|grind|explode`
severs a zeroed limb, `blunt|pierce|crush` breaks it; `severPart`, `breakPart`, `killDonor`,
`removePart(ctx, part, { release })` (grinding: `release: true` converts the remaining blood).
Blood: `releaseBlood(ctx, part, liters, { burst, pos })` is the only way litres reach `collected`.
Scoring: `ctx.scoring.addBonus(l, reason)`, `ctx.scoring.addFine(l, reason)`.

## Adding a hazard (rail saw, grinder, crusher…)

1. Create `src/sim/hazards/<name>.js` exporting `{ type, create(ctx, spec, id) }`.
2. In `create`: build colliders **attached to `ctx.drumBody`** (they then rotate with the drum),
   register each with `ctx.owners.set(collider.handle, { kind: 'hazard', hazard: inst })`, and
   return an instance:
   ```js
   { view: {...plain render data, drum-local...}, load: 0,
     preStep(ctx, dt) {},            // e.g. move a kinematic body (rail saw, crusher piston)
     postStep(ctx, dt) {},           // test ctx.parts analytically, call damagePart(...)
     onContact(ctx, part, speed, F) {}, // contact-force events with your colliders
     onSlam(ctx) {}, dispose(ctx) {} }
   ```
   Use `wallFrame / wallPoint / heightAboveWall` from `physics.js` for wall placement.
   Moving parts: create a kinematic body (`RigidBodyDesc.kinematicPositionBased()`) and drive it
   in `preStep` with `setNextKinematicTranslation` (drum-local coordinates).
3. Register it: add `registerHazard(myHazard)` in `hazards/index.js` (one import + one line).
4. Emit `hazard:contact` (throttled), `hazard:telegraph` (crusher), `grinder:clog/clear` with
   `ctx.emit(type, payload, [x,y,z])`. Expose `load` 0..1 (grinder → `audioState().grinderLoad`;
   type `grinder` is picked up automatically, rail saws should use type `railSaw`).
5. Render: add a builder in `src/render/donors/hazards.js` (`HAZARD_BUILDERS[view.kind]`);
   unknown kinds render as a placeholder box meanwhile.

`spikes.js` (impale = spherical joint part↔drumBody, dislodged by `onSlam`) and `saw.js` are the
reference implementations.

## Adding a donor type (Big Giver, Thin-Blood, Inspector…)

`registerDonorType({...})` in `src/sim/donors/` (see the typedef in `donors/index.js`):
data (`massScale`, `bloodScale`, `hpScale`, `bleedScale`, `slamScale`, `behaviour`, `look`,
`lines`, optionally a scaled `plan` via `scalePlan(HUMANOID, 1.3)`) plus optional hooks
`onSpawn / preStep / postStep / onDeath / onShiftEnd`. Examples: Inspector → `onDeath` calls
`ctx.scoring.addFine(25, 'workplace-incident')`, `onShiftEnd` adds the +20 L bonus if alive;
the safety sphere is best done as a prop that holds the donor (joint) until it shatters.
Import the new file once from `donors/index.js`. Waves reference it by `type`:
`{ at: 30, count: 6, types: { standard: 4, bigGiver: 2 } }`.

## Adding a prop (oxygen tank…)

`registerProp({ type, create(ctx, spec, id) })` in `src/sim/props/` (typedef in
`props/index.js`). Create bodies with `makeDyn('prop', body, collider, {...})`, push them to
`ctx.dyns` (so they get drum forces, buoyancy, slam), register colliders in `ctx.owners` as
`{ kind: 'prop', prop: inst, dyn }`. Explosions: loop `ctx.parts`, `addVelocity` radially +
`damagePart(..., 'explode', 'explode')`, emit `prop:explode`. Spawn from level `props` (timed)
or from a wave's `props: [{ type, count }]` (comes out of the hatch).

## Adding a level

Copy `levels/shift1.js` (format documented at the top), then add one import + one
`registerLevel()` line in `levels/index.js`. Per-level tunable overrides go in `tunables: {}`.
Balance with the bots: `idle` must fail, `spin` (careless) ≈ 1 drop, `smart`/`rock` can reach 3.

## Adding a mode

`modes/shift.js` and `modes/overtime.js` implement
`{ id, create(ctx, level) -> { status, result, clock, spawner, preStep, postStep, onBlood?, summary() } }`.
Register in `MODES` in `index.js`. A mode owns the clock, spawning, `ctx.pool.volume` (the tank)
and the end condition; it emits `shift:end { result, liters, stars }` exactly once.

## Events emitted (contract names, see docs/ARCHITECTURE.md)

`shift:start, shift:end, wave:incoming, hatch:open, donor:spawn, donor:hurt (throttled),
donor:death, limb:sever, limb:break, impact (top 3 per step), blood:spurt, blood:splat (throttled),
splash, hazard:contact, slam, slam:ready, combo, bonus, fine, pa:announce, timer:warning`.
Extensions: `donor:speak { id, text, pos }` (speech bubbles), `part:dissolve { id, part, pos }`.
All payloads also carry `t` (sim time). Not emitted yet (CONTENT): `hazard:telegraph`,
`grinder:*`, `prop:*`, `sphere:*`; UI emits `ui:*`, main emits `game:pause`.
