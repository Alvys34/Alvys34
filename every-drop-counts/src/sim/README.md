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

Run a whole shift in Node: `node tools/simbot.mjs --level 2 --policy smart` (policies in
`tools/policies.mjs`: idle spin rock tumble slamSpam flipper rockAim park smart), the full matrix:
`node tools/botmatrix.mjs`, one run's death causes / damage sources: `node tools/simdiag.mjs 3 smart`.
Tests: `npm test`.

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

### Level-design rules from the balance pass (read before adding a shift)

* **Mindless mashing parks a SIDE wall at the bottom.** Alternating full left/right from rest drifts
  the drum to oscillate around ±2 rad (±115°), so the crowd lives on one side wall and its corners.
  Hazards on side walls / near corners get farmed by button-mashing. The money hazards therefore sit
  in the MIDDLE of a face, and the crowd should never rest across that middle at the start.
* Shifts 2–8 start upside down (`startAngle: Math.PI`, hatch `{ wall: 'back', x: 0, y: -1 }`): the
  crowd lands on the bare 'ceiling' face, the machinery is overhead on the 'floor' face. Reaching it
  needs a deliberate half-turn plus controlled tilting, or a flip (drop them 10 m onto it).
* Spikes only hurt what FALLS on them (`minSpeed` 5, impale 10 m/s), so sliding across a bed is
  safe — a bed is the most rock-proof hazard. Saws, grinders and rail saws cut whatever slides past.
* Idle must earn 0: the landing spot must be bare and out of every blade's reach (standing donors
  are ~1.8 m tall).
* Quotas: q3 ≈ what `smart` reaches, q1 ≈ what a careless player scrapes on shifts 1–3. Check
  every change with `node tools/botmatrix.mjs` (all policies, ≥ 2 seeds).

## Adding a mode

`modes/shift.js` and `modes/overtime.js` implement
`{ id, create(ctx, level) -> { status, result, clock, spawner, preStep, postStep, onBlood?, summary() } }`.
Register in `MODES` in `index.js`. A mode owns the clock, spawning, `ctx.pool.volume` (the tank)
and the end condition; it emits `shift:end { result, liters, stars }` exactly once.

## Events emitted (contract names, see docs/ARCHITECTURE.md)

`shift:start, shift:end, wave:incoming, hatch:open, donor:spawn, donor:hurt (throttled),
donor:death, limb:sever, limb:break, impact (top 3 per step), blood:spurt, blood:splat (throttled),
splash, hazard:contact, hazard:telegraph, grinder:clog, grinder:clear, slam, slam:ready, combo,
bonus, fine, prop:puncture, prop:explode, sphere:crack, sphere:shatter, pa:announce, timer:warning`.
All payloads also carry `t` (sim time); positional ones `pan` + `pos`.

Extensions (documented, safe to ignore): `donor:speak { id, text, pos }` (speech bubbles),
`part:dissolve { id, part, pos }`, `grinder:swallow { id, part, liters }` (a part went into the
rollers), `crusher:stroke {}` (every press stroke, even when empty — hydraulic thump).
UI emits `ui:*`, main emits `game:pause`, `src/core/achievements.js` emits `achievement { id, title }`.

Payload details added by CONTENT:
* `hazard:contact { hazard: 'saw'|'spike'|'grinder'|'crusher', intensity, pressed? }` — rail saws
  report `hazard: 'saw'`; crusher presses report `pressed` (donors caught by this stroke so far).
* `hazard:telegraph { hazard: 'crusher' }` — ~1.1 s before the stroke (light + hiss).
* `grinder:clog { heldMass }`, `grinder:clear { bySlam }`.
* `prop:puncture { cause: 'saw'|'spike'|'grinder'|'crusher'|'impact'|'explosion', prop }`,
  `prop:explode { radius, hits }`.
* `sphere:crack { hits, maxHits, cause, donorId }`, `sphere:shatter { cause, donorId }`.
* `fine { liters: 25, reason: 'workplace-incident' }`, `bonus { liters, reason:
  'sponsor-match'|'early-finish'|'compliance' }`.
* `shift:end` (shift mode) `{ result: 'complete'|'timeout'|'failed', liters, stars, levelId,
  levelNumber, name, collected, bonus, fines, kills, drownings, bestCombo, time, timeLeft,
  donorsTotal, causes, inspectorDeaths, inspectorsSaved, quota, variant: null|'staff',
  report: { title, lines: [string] },   // deadpan results text (UI shows it)
  ending: null | { pa, mood, next: 'credits' } }`  // shift 8 only, when passed: play the sting
* `shift:end` (overtime) `{ result: 'failed', mode: 'overtime', liters, stars: 0, time, waves,
  kills, drownings, bestCombo, inspectorDeaths, peakDrain, report }` — score = `liters`.

## Snapshot / state fields for CONTENT kinds (read-only; for ART, VFX, AUDIO, UI)

All coordinates drum-local. Hazards: `state.hazards[i].view` (plain object, updated in place),
`state.hazards[i].load` 0..1. Props: `state.props[i]` (`removed` once gone) with `.view`; props
with a body expose `view.dyn` = the Dyn (pose `x,y,z,qx..qw`, previous `px..pqw` for interpolation).

| kind | `view` fields |
|---|---|
| `spikes` | `wall, from, to, z0, z1, height, n, t, impaled` |
| `saw` | `wall, x, y, z0, z1, radius, dir, angle, spin, n` |
| `railSaw` | `wall, n, t, from, to, offset, railA:[x,y], railB:[x,y], x, y` (current blade centre)`, z0, z1, radius, dir, angle, spin, u` (0..1 along the rail)`, vel` (m/s along t) |
| `grinder` | `wall, n, t, at, width, housing, z0, z1, x, y` (roller-face centre)`, angle` (rollers counter-rotate ±angle)`, clogged, held, heldMass, chewing, boost` (0..1 after a slam-clear) |
| `crusher` | `wall, n, t, at, width, plate, z0, z1, span, reach, x, y` (base on the wall)`, ext` (plate-face distance from the wall)`, state` ('idle'/'telegraph'/'extend'/'hold'/'retract')`, warn` (0..1 telegraph progress)`, cycle` |
| prop `oxygenTank` | `dyn, radius, halfLength` (capsule along local +y, nozzle at −y)`, state` ('intact'/'punctured'/'exploded')`, fuse, thrust` (0..1 exhaust) |
| prop `safetySphere` | `dyn, radius, hits, maxHits, cracks` (0..1)`, shattered, donorId` |

Audio: `sim.audioState().grinderLoad` = max grinder `load` (0 idle, ~0.4–1 chewing, 1 jammed);
`sawLoad` includes rail saws.

Donors (`state.donors[i]`): `type` ('standard'|'bigGiver'|'thinBlood'|'inspector'), `alive`,
`mustSurvive` (Inspector), `encased` (inside his sphere: his parts are posed by the sphere and
have `part.encased = true`; draw him normally), `sphere` (the prop or null), `look = { gown, skin,
accessory: null|'wristband'|'hardhat', outfit: 'gown'|'suit'|'staff', scale }`. Big Givers use a
1.3× scaled body plan (part shapes are scaled; `look.scale` = 1.3). Part: `opened` (has an open,
bleeding wound — blunt bruises are not), `grinding` (held by a grinder).

`sim.snapshot()` adds: `props: [{id, type, state, hits}]`, `inspectors: [{id, alive, encased,
hits}]`, `aliveTargets` (alive donors that are product, i.e. not Inspectors), `overtime: null |
{ tank, tankMax, drainRate, wave, nextWaveIn, demandLevel, drained }`, `blood: { pending,
dissolved }`. `donorsLeft` excludes Inspectors.

Levels (`listLevels()`): `{ id, number, name, subtitle, lesson, quota, duration, variant }`.
Shift 8 has `variant: 'staff'` (donor outfits) and `ending`.

## Damage & yield model (CONTENT balance pass)

Wounds open at a rate per hp that depends on the damage KIND (`T.damage.wound`): cut / pierce /
grind / explode / press open real wounds; blunt (wall impacts, falls on bare metal) and crush
(piles) barely bleed. Open wounds CLOT (`woundClot` 1/s), stumps clot slowly (`stumpClot`), impaled
parts never clot while pinned, Thin-Bloods never clot. Death releases `deathBurst` from OPEN wounds
only. So a donor beaten to death against bare walls yields almost nothing; a donor routed into the
machinery yields most of their blood; the grinder converts 100 %. Sponsor Match only counts
`T.scoring.comboCauses` (not 'impact', not 'drown'); Inspectors never count.
