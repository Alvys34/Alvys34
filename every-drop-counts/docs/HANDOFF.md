# EVERY DROP COUNTS — Handoff (2)

For the local agent (or person) taking this over. The cloud session is finished: every cloud agent
has been stopped and nothing else will be pushed from it. You own the whole tree now.

State: branch `ccr-567c397f-f3s53e`, 2026-11-13 evening UTC. `npm test` 68/68 and `npm run build`
pass on commit `544253a` (the code state this file describes). The desktop build was **not**
re-run after fix round 2.

## Read these first

1. `docs/qa/PLAYTEST-1.md` — independent review. Verdict: fun-shaped, not shippable. Blockers B1–B2,
   majors M1–M7. This is still the task list; the table below says what is already addressed.
2. `docs/local/LOCAL-REPORT-1.md` — your own real-GPU / Windows findings (§6 bug table).
3. `docs/GDD.md` (design, LOCKED rules), `docs/ARCHITECTURE.md` (contracts), the per-area READMEs
   in `src/sim`, `src/render`, `src/ui`, `src/audio`, `desktop`.

## Run it

```
cd every-drop-counts
npm install
npm run dev      # http://localhost:5173  (?debug=1 → window.__edc harness, ?seed=, ?autostart=)
npm test         # 68 headless tests, ~2.5 min
npm run build

cd desktop && npm ci
npm run build:release   # now uses a Node zip (yazl); build the Linux depot on Linux/WSL only
npm run smoke           # Linux only (xvfb)
npm run verify
```

Balance tools: `node tools/botmatrix.mjs --levels 1,2,3,4,5,6,7,8,overtime --seeds 3 --jobs 4
--json out.json --compact` (policies: idle, spin, rock, smart, plus personas cautious, holder,
masher, thinker), `node tools/simbot.mjs --level 5 --policy thinker`, `tools/qa/control.mjs`
(drum response), `tools/camera-log.mjs`, `tools/qa/shaders.mjs` (program count, `?noprewarm=1` A/B).

## Hard rules

- `src/sim/**` is headless (no three, no DOM, no wall-clock; runs in Node). Velocity changes only
  through `addVelocity()` in `src/sim/physics.js`.
- Desktop: served from `app://game/`, save key `edc.save.v1`, Electron userData folder name —
  none of these may change. CSP: no inline script, no eval, no remote URLs.
- Red is reserved for blood; blood colour only from `src/render/blood/palette.js`.
- Content guardrails in GDD §2 are LOCKED (adults only, no real brands or people, stylised gore).
- Existing bus event names are locked; additions go in the ARCHITECTURE event table.

## Fix round 2 — what landed (cut short; the agents were stopped mid-wrap-up)

Everything below is in the tree, compiles and has passing tests, but **none of it was seen in real
time or re-playtested**, and the agents wrote no final reports. Treat "landed" as "needs your
eyes", not "verified". Docs the agents were updating (ARCHITECTURE event table, READMEs) may lag
the code.

| Item | State | Where / how to check |
|---|---|---|
| B1 brand rename | Landed. Provisional name **SUNNYVEIN** (one web search found no such brand; not legally cleared; owner has not confirmed). Single source `src/core/brand.js`; grep for the old name is clean outside `docs/local` and `docs/qa`. | Check sign letter spacing in `src/render/environment/textures.js`. Docs, store text and desktop metadata are plain text: rename by hand if the name changes. |
| M4 drum handling | Landed. Full-speed release stops in ~12° / 0.23 s, 0.25 s tap ~16° total, Brake ~3.5°. | `T.drum.coastDamping / settleDecel / holdDamping`, `tests/handling.test.mjs`. **Feel is unjudged — play it.** |
| M2 pool fill curve | Landed. Shift mode maps litres → fill by quota: deep by q1, cap only at 1.15 × q3. Overtime keeps real volume. | `src/sim/pool.js`, `tests/systems.test.mjs`. |
| M2 drowning | Landed. Live donors float low; `donor.drown01`; event `donor:drowning`; `wasted` litres on drowning deaths; air-gauge meter over heads (`src/render/donors/drown.js`); gurgle sound; "−X L wasted" popup. | Sanity matrix: mashers lose 14–30 % of product on shifts 2–4 and 6, thinker 0–17 %. |
| M6 waves | Landed. Regular waves open on clear OR after a gap; timed arrivals keep their time. `maxIdle` is 4 s on every shift. | `src/sim/modes/shift.js`. |
| B2 Inspector bonus rule | Landed. Bonus is held until donor litres reach q1; otherwise withheld (`result.complianceWithheld`, event `bonus:withheld`, report line). Idle on shift 5 now scores 0. | `src/sim/scoring.js`. **Shift 5 itself was not reworked — see below.** |
| M3 camera | Landed. Constant framing (drum's circumscribed circle); gentle tighten at rest ≤ 1.25×; ease-out ≤ 0.28/s. | `src/render/camera.js`, `tests/camera.test.mjs`, stills `docs/progress/fix2-camera-*.png`. Motion unjudged. |
| Shader precompile | Code landed and wired (`src/render/precompile.js`, `view.warming` holds the sim). **Verification unfinished**: the agent's last note still listed lazy compiles at 7 s, 11.7 s and 16.3 s; it is unclear whether that run had the warm-up on. | Run `tools/local/hitch-probe.mjs` and `tools/qa/shaders.mjs` on a real GPU. |
| Quality governor | Landed with 10 unit tests: pixel-ratio-first when GPU-bound, kept across presets, immediate step when > 2× over budget, boot benchmark for `auto`, hysteresis. | `src/render/quality.js`, `tests/quality.test.mjs`. Re-run your iGPU governor test. |
| Late-shift readability | Landed: self-lit yellow/black hazard marks, wall/glass paint caps, fewer and fatter runners, emergency tint from 28–52 % fill, clearer safety sphere. Only one still was taken (`docs/progress/fix2-read-s5-inspector.png`). | `src/render/README.md` "Readability (fix 2)". Needs a real-GPU look at late shift 7 and Overtime. |
| M5 teaching UI | Landed: `level.lesson` and "new this shift" callouts on the briefing, contextual Brake/Slam prompts with saved counters, prompts moved off the play area, shift-1 PA lines no longer contradict. | `src/ui/briefing.js`, stills `docs/progress/fix2-ui-*.png`. |
| Overtime demand meter | Landed: `demandTier` + `demandRate` from the sim, HUD shows tier and rate. | `src/sim/modes/overtime.js`, `src/ui/hud.js`. |
| UI polish | Landed: bubble overlap cap, report headline keyed by drops, quality order Low→Auto, future-version save backup, favicon, HUD first frame. | `tests/ui.test.mjs`. |
| Desktop | Landed: Node zip in `desktop/scripts/build.mjs` (fixes Windows `zip ENOENT`), log handling for a second instance in `desktop/src/main.js`. | **Not built or smoke-tested since.** |

## Not done — your task list, in priority order

1. **Shift 5 is now unpassable (progression blocker).** With the bonus rule in place and the
   layout unchanged, one-seed results against quota [45, 68, 76]: smart 31 L, thinker 19 L,
   masher 21 L — 0 drops for everyone. Shift 5 gates 6–8. Rework the layout per PLAYTEST-1 B2
   (give the Inspector his own lane or a safe ledge; the floor is one spike bed today) and retune
   the quota. Target: idle 0 drops, thinker ≥ 1 drop on 3 seeds, careful play beats sloppy play.
2. **Rebalance every shift.** Handling, the fill curve and drowning changed under unchanged
   quotas. One-seed sanity run (`docs/qa/botmatrix-fix2-quick.json`), litres / drops:

   | Shift (quota) | idle | masher | thinker | smart |
   |---|---|---|---|---|
   | 1 (6/35/48) | 0 | 18 / 1 | 54 / 3 | 56 / 3 |
   | 2 (24/70/105) | 0 | 77 / 2 | 82 / 2 | 104 / 2 |
   | 3 (40/135/150) | 0 | 116 / 1 | 152 / 3 | 144 / 2 |
   | 4 (40/95/110) | 0 | 91 / 1 | 105 / 2 | 116 / 3 |
   | 5 (45/68/76) | 0 | 21 / 0 | 19 / 0 | 31 / 0 |
   | 6 (45/115/130) | 3 / 0 | 100 / 1 | 104 / 1 | 106 / 1 |
   | 7 (55/145/185) | 0 | 141 / 1 | 186 / 3 | 116 / 1 |
   | 8 (55/125/150) | 1 / 0 | 162 / 3 | 117 / 1 | 149 / 2 |

   Reading: shifts 3, 4 and 7 now separate mashing from intent; shift 8 still rewards mashing
   (M1, M6); shift 6 is too tight; shift 1's q1 of 6 L is still passable by accident (M5).
   The full 3-seed matrix with all personas and Overtime was never run — run it first.
3. **Overtime** was not retuned (M1: mindless play reached ~75 % of the smart bot) and the
   harder debris cap for > 300 bodies (M7) was not started.
4. **Shift 2 teaching moment** (scripted "Turn them over." beat) and ceiling-slam teaching (M2,
   M5) were not started. Level layouts for shifts 3 and 4 (PLAYTEST-1 M1 directions) untouched.
5. **Not confirmed either way:** green-blood HUD values, fullscreen setting sync from
   `edcDesktop`, donor outline cost on the low preset, the five missing store asset sizes in
   `docs/STEAM_RELEASE.md`. Check each before assuming.
6. **Rebuild and smoke the desktop app** on Windows and Linux after the above.
7. **Play it.** 15 minutes with sound on a real GPU, using the checklist at the end of
   PLAYTEST-1. Handling, camera, audio mix and gore tone have never been judged by a person.
8. **Second independent playtest**, then repeat until it finds no blockers.

## Release items (owner decisions)

- Final brand name (replace SUNNYVEIN or clear it) and whether to keep the title "Every Drop
  Counts" (no Steam conflict; weak for search — `docs/local/title-check.md`).
- Steam: app id, store assets and text (paused at the owner's request), achievements in
  Steamworks (`docs/STEAM_RELEASE.md` §5.1), code signing, VC++ redistributable tick.
- Move the game out of this profile repo into its own repository; squash on the way (branch
  history carries ~99 MB of raw playtest frames).

## Conventions

- `node_modules`, `dist`, `desktop/release`, `tools/out`, `tools/local/out`, `docs/qa/raw` are
  ignored. Progress stills go in `docs/progress/`, QA evidence in `docs/qa/`.
- No assets fetched from the internet, no telemetry, no network at runtime.
