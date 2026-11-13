# EVERY DROP COUNTS — Handoff

Written for an agent (or person) picking this project up on a local machine with a real GPU.
State as of commit `872ae07` on branch `ccr-567c397f-f3s53e`, 2026-11-13 ~15:40 UTC.

## What this is

A 3D physics splatter arcade game for Steam. The player operates a rotating "donation drum" full
of ragdoll blood donors (two verbs: ROTATE and SLAM). Hazards on the drum walls cut, impale, grind
and crush them; the blood spilled floods the drum as a level-seeking pool that makes bodies float,
drowns donors and takes floor hazards out of play. Tone: cheerful clinical surface, appalling inside.

- Design: `docs/GDD.md` (pillars, loop, controls, scoring, the 8 shifts, production checklist).
- Contracts and ownership: `docs/ARCHITECTURE.md` (event bus, audio, desktop bridge, save, debug
  harness, desktop CSP constraints, plus notes each specialist appended).
- Per-area detail: `src/sim/README.md`, `src/render/README.md`, `src/ui/README.md`,
  `src/audio/README.md`, `desktop/README.md`.
- Steam process and upload templates: `docs/STEAM_RELEASE.md`, `desktop/steam/`.

## Run it

```
cd every-drop-counts
npm install
npm run dev          # http://localhost:5173  (add ?debug=1 for the window.__edc harness)
npm test             # 34 headless sim tests (Node, no browser)
npm run build        # static dist/, base './'
```

Desktop (separate package):

```
cd every-drop-counts/desktop
npm ci
npm run build:release   # builds ../dist, then Windows x64 + Linux x64 folders and zips in release/
npm run smoke           # launches the packaged Linux build (needs a display or xvfb-run)
npm run verify          # static checks on both builds
```

Useful tools: `node tools/simbot.mjs --level 3 --policy smart` (one headless shift),
`node tools/botmatrix.mjs` (policy × seed table), `tools/shot.mjs` / `tools/vfxshot.mjs` /
`tools/ui-shots.mjs` (Playwright captures), `node tools/audio/run.mjs` (audio meters; `--wav`
exports every sound for listening).

## Stack

Vite + plain JS ES modules. three.js (render), Rapier 3D compat (physics, WASM embedded), WebAudio
synthesis (no sample files), HTML/CSS DOM UI, Nunito via `@fontsource-variable`. All art is
code-generated. Electron wrapper in `desktop/` with optional steamworks.js. No network at runtime.

Hard rules that are easy to break:
- `src/sim/**` is headless: no three, no DOM, no wall-clock. It must keep running in Node.
- Sim code changes velocities only through `addVelocity()` in `src/sim/physics.js`.
- Desktop CSP: no inline `<script>`, no `eval`/`new Function`, no remote URLs. The game is served
  from `app://game/`; saves are tied to that origin, so it must never change after release.
- Red is reserved for blood. All blood colour comes from `src/render/blood/palette.js`.

## What is built

| Area | State | Verified how |
|---|---|---|
| Sim: drum in rotating frame, ragdolls, damage, clotting blood model, pool with buoyancy | Done | `npm test` 34/34 |
| Hazards: spikes, saw, rail saw, grinder, crusher | Done | Tests + screenshots |
| Donors: standard, Big Giver, Thin-Blood, Inspector in safety sphere; oxygen tanks | Done | Tests + screenshots |
| Shifts 1–8, Overtime, 14 achievements | Done, two balance rounds | Bot matrix (below) |
| Blood VFX, pool liquid, adaptive camera, post, quality presets, GPU fallbacks | Done, one polish round | Software-rendered screenshots only |
| Art: facility, drum, lighting escalation, donors, hazards, props | Done, one polish round | Software-rendered screenshots only |
| UI: boot, title, shift select, briefing, HUD, pause, settings, report, records, credits, ending | Done | Driven by keyboard and simulated gamepad in Playwright |
| Audio: every bus event, adaptive muzak, mix/limiter | Done | Meters only — nobody has listened to it |
| Desktop wrapper and build pipeline | Done | Linux smoke passed against a placeholder page; real-game build in progress |

## In flight when this was written (cloud session)

Two agents were still running in the cloud session and pushing to this branch. Pull before you
start, and expect their changes to land in these areas:

1. **Integration agent** — closing cross-system seams, then the first real desktop build. Its list:
   reduce-flashing setting ignored by `src/render/post.js`; no `view.playEnding()` camera move for
   the shift-8 ending (UI falls back to CSS); audio scaling never calibrated against real sim
   payloads; `state.hasSaw` / `state.hasGrinder` and the `crusher:stroke` / `grinder:swallow`
   events not wired to sounds; audio pre-render hitch (~1–1.4 s of CPU after unlock); HUD corner
   plates covering drum corners at 1280×720; shift 1/2 PA lines naming keyboard keys; possible
   hard-coded head size in `src/render/donors/bodyparts.js`; reset-progress not reseeding the
   achievement tracker. Touches `src/render`, `src/audio`, `src/ui`, `src/main.js`, `desktop/`.
2. **Playtest agent** — read-only on the game. Writes `docs/qa/PLAYTEST-1.md` with a prioritised
   blocker/major/minor list and evidence in `docs/qa/img/`. That report is the input to the next
   fix round; if it exists when you read this, start there.

## Balance (latest 3-seed bot matrix, drops earned)

Quotas are per shift in `src/sim/levels/shiftN.js`; all tunables in `src/core/tunables.js`.

| Shift | idle | careless (rock / spin / slam-spam) | smart bot |
|---|---|---|---|
| 1 Orientation | 0 | 1 for any active play; 0 for pure max spin | 3 / 2 / 3 |
| 2 Sharp Objects | 0 | 0–1 | 3 / 3 / 3 |
| 3 High Tide | 0 | 1 | 3 / 3 / 3 |
| 4 The Good Machine | 0 | 0–1 | 3 / 3 / 1 |
| 5 Compliance | 0 | 0–1 (rockers kill the Inspectors) | 3 / 3 / 3 |
| 6 Breathe Easy | 0 | 1–2 | 3 / 3 / 2 |
| 7 Rush Hour | 0 | 1 (slam-spam 2 on one seed) | 3 / 2 / 3 |
| 8 Staff Appreciation Day | 0 | 1 (spin 3 on one seed) | 3 / 3 / 2 |

Overtime (one seed each): idle ends at 66 s, smart bot lasts 7.2 min.

Bots are proxies. "On target" means the difficulty shape is right, not that it is fun.

## Known problems and open questions

- **Nobody has played it in real time or heard it.** Everything visual was judged from
  software-rendered stills at ~1 fps; audio was judged by meters. Control feel, camera motion,
  animation timing, the muzak and whether the gore sounds comic or grim are all unjudged.
- **Real GPU performance is unmeasured.** Sim step is ~2.7 ms mean on the worst shift and ~4 ms in
  late Overtime at ~440 bodies (at budget, measured under heavy machine load). Draw calls are
  110–156 per frame against a 250 budget. Donor outlines roughly double donor triangles.
- **Camera:** when spinning up from rest it zooms out fast for ~0.25 s to avoid cropping the drum.
  `settings.cameraZoomRange` (~0.9) softens it. Needs a human eye.
- **Balance outliers:** shift 4 smart bot fails one seed (likely the bot); shift 6 is high-variance
  from tank chains; shift 7 slam-spam and shift 8 spin each get lucky on one seed.
- **The pool twist** reaches its game-changing depth by half-time on six of eight shifts; shifts 1
  and 5 stay shallow.
- **Windows build has never been executed.** Checked statically only (PE headers, icon, asar,
  Steam binaries). Needs a real Windows 10/11 run; the exe is not code-signed.
- **Steam:** no app id configured (`desktop/steam_appid.txt`), no real Steam session tested, no
  store assets made yet (capsules, screenshots, description, trailer). The Steam module needs the
  VC++ 2015–2022 x64 redistributable ticked in Steamworks.
- **Not visually confirmed:** oxygen tank explosion debris, the grinder's amber jam lamp,
  4K layout, browser fullscreen.
- **Title is a working title.** "Every Drop Counts" and the fictional brand "DRAINWELL" have not
  been checked against existing Steam titles or trademarks.
- **Repo location:** this lives in a subfolder of a GitHub profile repo. It should move to its own
  repository before release.

## Suggested next steps

1. Play it for 15 minutes on a real GPU with sound. Note what feels off (control response, camera,
   readability at speed, audio mix, first-shift clarity). This is the highest-value thing left.
2. Read `docs/qa/PLAYTEST-1.md` once it lands and fix its blockers and majors.
3. Profile a full shift 7 and a late Overtime run on real hardware (frame time, the auto-quality
   governor's thresholds in `src/render/quality.js`).
4. Confirm the integration items above landed; then `npm run build:release && npm run smoke &&
   npm run verify` in `desktop/`, and run the Windows build on Windows.
5. Steam store assets and text, achievements set up in Steamworks (API names in
   `docs/STEAM_RELEASE.md` §5.1), app id, depots, upload via the VDF templates.
6. Second independent playtest after fixes; repeat until it finds no blockers.

## Conventions

- Commit at working states; `node_modules`, `dist`, `desktop/release`, `tools/out` are ignored.
- Screenshots that document progress go in `docs/progress/`; QA evidence in `docs/qa/`.
- Do not fetch assets from the internet and do not add telemetry.
