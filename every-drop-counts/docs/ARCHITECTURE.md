# EVERY DROP COUNTS — Architecture & Team Contract

Read `GDD.md` first. This file is the contract between agents working in parallel.
If the code and this file disagree after Phase 1, **the code in `src/sim` and `src/core` wins**
and this file should be corrected by whoever notices.

## Stack (LOCKED)

- Web tech, shipped to Steam inside Electron.
- **Vite** + plain **JavaScript ES modules** (JSDoc types welcome, no TypeScript build step).
- **three** (rendering), **@dimforge/rapier3d-compat** (physics, WASM embedded — works from `file://`).
- UI: HTML/CSS DOM overlay, no framework.
- Audio: WebAudio synthesis only, no sample files.
- Fonts: only via npm `@fontsource/*` (OFL), bundled locally. **No CDN, no network at runtime.**
- Assets: code-generated only (procedural meshes, canvas textures). Network policy blocks asset
  sites; npm registry and GitHub releases are reachable.
- `vite.config.js` must use `base: './'` so `dist/index.html` runs from `file://` in Electron.

## Layout and ownership

```
every-drop-counts/
  docs/                 GDD, this file, release docs
  package.json          web game package (owner: CORE; others may add deps, never remove)
  index.html
  src/
    main.js             boot + wiring (owner: CORE; others make small, atomic edits to register systems)
    core/               event bus, fixed-step loop, input, RNG, save, config/tunables   (CORE)
    sim/                PURE game simulation: no DOM, no three, runs in Node           (CORE, then CONTENT)
      drum, ragdoll, damage, blood accounting, pool, hazards/, donors/, props/, levels/, modes/
    render/             three.js views of sim state                                    (CORE baseline)
      environment/      facility, drum model, lighting, materials                      (ART)
      donors/           donor/prop/hazard visuals                                      (ART)
      blood/            droplets, decals/painting, pool liquid                         (VFX)
      camera.js, post.js                                                               (VFX)
    audio/              standalone synth engine                                        (AUDIO)
    ui/                 menus, HUD, results, settings, speech bubbles, PA ticker       (UI)
  tools/                Playwright screenshot + bot scripts, Node sim bots             (CORE, all may add)
  tests/                Node tests of the sim                                          (CORE, all may add)
  desktop/              Electron wrapper — separate npm package                        (DESKTOP)
  steam/                store assets and text                                          (RELEASE)
```

### Hard rule: `src/sim` is headless

`src/sim/**` must not import `three`, touch `window`/`document`, or read wall-clock time. It takes
a seeded RNG and a fixed `dt`. This lets `node tools/simbot.mjs --level 3 --policy spin` run a whole
shift in seconds for balancing and regression tests. Rendering, audio and UI only **read** sim
state and **listen** to bus events.

## Event bus contract (LOCKED names — audio is built against this in parallel)

```js
bus.on(type, fn) // -> unsubscribe function
bus.emit(type, payload)
```

Every positional event carries `pan` in −1..1 (screen-space horizontal, already accounting for the
drum's rotation) so audio never needs geometry. Sim may add fields; never rename these.

| Event | Payload |
|---|---|
| `shift:start` | `{ levelId, mode: 'shift'|'overtime' }` |
| `shift:end` | `{ result: 'complete'|'timeout'|'failed', liters, stars }` |
| `wave:incoming` | `{ count }` (≈1 s before the hatch opens) |
| `hatch:open` | `{ pan }` |
| `donor:spawn` | `{ id, type, pan }` |
| `donor:hurt` | `{ id, amount, cause, pan }` |
| `donor:death` | `{ id, type, cause: 'cut'|'impale'|'crush'|'grind'|'impact'|'drown'|'explode'|'bleedout', pan }` |
| `limb:sever` | `{ id, part, pan }` |
| `limb:break` | `{ id, part, pan }` |
| `impact` | `{ kind: 'flesh'|'metal'|'glass'|'prop', speed, mass, pan }` |
| `blood:spurt` | `{ rate, pan }` (start of a strong bleed/burst) |
| `blood:splat` | `{ size, pan }` (droplets landing; emitter may throttle) |
| `splash` | `{ size, pan }` (something hits the pool surface) |
| `hazard:contact` | `{ hazard: 'saw'|'spike'|'grinder'|'crusher', intensity, pan }` |
| `hazard:telegraph` | `{ hazard, pan }` (crusher about to fire) |
| `grinder:clog` / `grinder:clear` | `{ pan }` |
| `slam` | `{}` |
| `slam:ready` | `{}` |
| `combo` | `{ count, multiplier }` |
| `bonus` | `{ liters, reason }` |
| `fine` | `{ liters, reason }` |
| `prop:puncture` | `{ pan }` |
| `prop:explode` | `{ pan }` |
| `sphere:crack` / `sphere:shatter` | `{ pan }` |
| `pa:announce` | `{ text, mood: 'calm'|'urgent'|'glitch' }` |
| `timer:warning` | `{ secondsLeft }` |
| `game:pause` | `{ paused }` |
| `ui:hover` / `ui:click` / `ui:back` | `{}` |
| `ui:star` | `{ n }` (results screen drop n of 3 awarded) |
| `achievement` | `{ id }` |

## Audio contract (LOCKED)

`src/audio/index.js` exports:

```js
export function createAudio() // -> audio
audio.attach(bus)                       // subscribe to the events above
audio.unlock()                          // call from first user gesture (creates/resumes AudioContext)
audio.update(dt, state)                 // every frame
audio.setVolume('master'|'music'|'sfx', v /* 0..1 */)
audio.suspend(); audio.resume(); audio.dispose()
```

`state` passed each frame:
`{ screen: 'menu'|'playing'|'paused'|'results', fill /*0..1*/, drumOmega /*rad/s*/, aliveCount,
   sawLoad /*0..1*/, grinderLoad /*0..1*/, timeScale /*1 = normal*/, intensity /*0..1*/ }`

Audio must never throw into the game loop and must be a silent no-op if WebAudio is unavailable.

## Desktop bridge contract (LOCKED)

When running inside Electron, the preload script exposes `window.edcDesktop`:

```js
edcDesktop.isDesktop            // true
edcDesktop.platform             // 'win32' | 'linux' | 'darwin'
edcDesktop.version              // app version string
edcDesktop.quit()
edcDesktop.setFullscreen(bool) ; edcDesktop.isFullscreen() // -> Promise<boolean>
edcDesktop.unlockAchievement(id) // no-op resolve(false) when Steam is not available
```

The web game must run identically in a plain browser when `window.edcDesktop` is undefined
(hide the Quit button, use the Fullscreen API).

## Save contract

`localStorage` key `edc.save.v1`, a single JSON object, written through `src/core/save.js` only.

## Debug / test harness (CORE provides, everyone uses)

With `?debug=1` the page exposes `window.__edc`:

- `ready` (Promise), `loadLevel(id)`, `startOvertime()`, `getState()` (plain JSON snapshot:
  screen, time, liters, fill, alive, bodies, fps/step-ms stats…),
- `setInput({ rotate: -1..1, brake: bool, slam: bool })`, `step(n)` (advance n fixed sim steps
  without waiting for real time), `setTimeScale(x)`, `setQuality(name)`, `errors` (collected
  `window.onerror`/`console.error` messages).
- `?seed=123` fixes the RNG. `?autostart=3` jumps straight into shift 3.

Tools: `tools/shot.mjs` (Playwright; loads a URL, optionally steps/plays a scripted input
sequence, writes PNG screenshots) and `tools/simbot.mjs` (Node; runs policies `idle|spin|rock|smart`
on a level and prints litres, kills, drownings, timing, peak body count, mean/max step ms).

Headless WebGL: launch Chromium with
`args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']`.
Software rendering is slow — never judge GPU frame rate from it; judge sim step time and
draw-call / triangle counts instead (`renderer.info`).

## Budgets

- Sim: ≤ 4 ms mean per 60 Hz step with the worst-case shift on a desktop CPU; ≤ ~450 rigid bodies
  alive at once (dissolve drained submerged parts, cap debris).
- Render: ≤ 250 draw calls typical (instancing for droplets, donor parts where practical),
  shadows from one light only.
- Production bundle should load in < 3 s from disk.

## Working rules for all agents

1. Several agents edit this tree **at the same time**. Stay inside the paths you own. In shared
   files (`main.js`, `package.json`) make small, atomic edits and never reformat or reorder.
2. Never leave the tree unbuildable: write new modules complete before importing them.
3. If something you do not own is broken, wait a minute and retry (someone is mid-edit); if it
   stays broken, note it in your final report instead of rewriting it.
4. Use your own dev-server port (given in your brief). Close browsers and servers you start.
5. **Do not run git commit / push / checkout / stash / reset.** The orchestrator handles git.
6. Do not commit secrets, do not fetch assets from the internet, do not add telemetry.
7. Verify your work by running it (sim bot, screenshots you actually look at) before reporting.
   Report honestly: what works, what is rough, what you did not verify.

## Desktop runtime constraints (added after Phase 1 — binding for all web code)

- In Electron the game is served from the private origin `app://game/` (not `file://`). Saves are
  tied to that origin; it must never change after release.
- A strict CSP applies: **no inline `<script>`, no `eval` / `new Function`, no remote URLs of any
  kind** (http/https/ws requests are cancelled). WebAssembly, inline styles, `data:` and `blob:`
  URLs are allowed. Workers must be bundled files or blob URLs.
- `edcDesktop.setFullscreen(bool)` returns `Promise<boolean>` (the new state).
- Final builds: `cd desktop && npm ci && npm run build:release && npm run smoke && npm run verify`.

## Implementation notes (CORE, Phase 1) — additive to the contract above

- Positional events also carry `pos: [x,y,z]` (drum-local metres); every sim event carries `t` (sim
  seconds). Extra events: `donor:speak { id, text, pos }`, `part:dissolve { id, part, pos }`.
- Donor ragdolls have **11** bodies (the GDD §6 list: head, chest, pelvis, 2× upper arm, 2× forearm,
  2× thigh, 2× shin), not 10.
- `__edc.step(n, render = true)`: pass `false` to skip the render (software WebGL is ~0.3 s/frame).
  `__edc` also exposes `sim`, `bus`, `view`, `loop`, `input`, `ui`, `audio`, `pause(bool)`.
- `tools/shot.mjs --serve` starts Vite with `EDC_NO_HMR=1` (no live reload while other agents edit).
- Production build is a single classic IIFE script (`vite.config.js`) so `dist/index.html` runs
  from `file://`. Interfaces for later agents: `src/sim/README.md`, `src/render/README.md`,
  `src/ui/README.md`.

## Implementation notes (UI, Phase 2) — additive

- App flow lives in `src/ui/index.js` (`createUI`); `main.js` only forwards the loop to it. Details and
  the flow map: `src/ui/README.md`.
- The sim is created with a **gated bus** (`createSimBus(bus)` in `src/ui/attract.js`). Menus run the
  sim in attract mode with the gate closed, so `shift:start`, impacts, speech etc. from the attract
  scene never reach audio/VFX/achievements. Anything that must hear real gameplay only: listen on the
  main bus as before (nothing changes for you).
- Extra events: UI emits `ending:start {}` when the shift-8 sting hands over to the camera
  (`view.playEnding()`; the CSS push-in is only a fallback now). `achievement {id}` is persisted,
  toasted and forwarded to Steam by the UI (`src/ui/systems.js`), which also creates CONTENT's tracker.
- `ui:star {n}` fires as each drop lands on the shift report; `game:pause {paused}` on pause/resume.
- `__edc.getState().screen` is the UI mode (`boot|menu|briefing|playing|paused|results|ending`);
  `__edc.ui.debug` has helpers for screenshots; `?autopause=1` re-enables focus-loss pause in debug.
- Save schema (`edc.save.v1`, `src/core/save.js`): every field is sanitised on load; unreadable JSON is
  kept under `edc.save.v1.corrupt` and replaced; `MIGRATIONS[n]` upgrades raw saves from version n.

## Integration notes (INTEGRATION pass) — additive

- `view.update(state, alpha, dt, frame)`: `frame = { realDt, timeScale, paused, slowMo, hitStop }` comes
  from the loop (`loop.slowMoActive`, `loop.hitStopActive`); post uses it instead of re-deriving feel rules.
  Every render piece already advances with the sim-scaled `dt`, so particles, runners and pool waves freeze
  on pause / hit-stop and slow in slow-mo. `loop.stepNow(n)` also counts down slow-mo / hit-stop.
- Accessibility: `view.setReduceFlashing(bool)` (wired from settings at boot and live) turns off the slam
  flash, red edges, CA and desaturate snaps, light flicker / tube stutter and the hard lamp blinks.
- Camera: the HUD reports its top-corner plates (`view.setHudInsets`); at 16:9 / 16:10 near upright the
  camera reserves a top band (≤ 12 %) so the drum corners are not hidden; 21:9 is unaffected.
  `view.playEnding()` = shift-8 drift into the intake hatch (only once the shift has ended).
- Audio: fixed payload curves calibrated on real runs (`tools/audio/calibrate.mjs`); `crusher:stroke`,
  `grinder:swallow` have sounds; `hasSaw`/`hasGrinder` are passed by `main.js`; the sound bank finishes
  rendering in the menus (`audio.warmup` at shift start as a backstop).
- `__edc.perf()` / `__edc.perfReset()`: summed main-thread ms for sim steps / view.update / UI / audio.
  Boot timeline marks `edc:boot|rapier|renderer|audio|ui|ready` (`performance.getEntriesByType('mark')`).
