# PLAYTEST-1 — "Every Drop Counts", first fresh-eyes QA pass

**Tested:** 2026-11-13, 14:20–17:35 UTC, against the working tree as it moved from `09d9c5e` to `6ee2927`
(CONTENT and INTEGRATION were committing during the run; shift 7/8 quotas changed mid-run. Every number below
is tied to the run that produced it.) Dev server with `EDC_NO_HMR=1`, headless Chromium + SwiftShader, seed 1
unless noted. Played without hands: scripted humans through `__edc.setInput` + `step`, real UI flow by
keyboard / simulated gamepad. Nothing in `src/`, `desktop/` or `tests/` was modified.

**Harness caveat (read before judging the contact sheets):** post-FX accents (radial blur, desaturate, flash)
and the HUD count-up decay on *wall-clock* time. At ~1 render per 2 s they linger for many frames, so blurry or
bleached frames in `s*-*.jpg` sheets are artifacts. The `s1-*` sheets were made before I fixed the harness,
so their HUD litre counter lags the real value (the label above each tile is the true sim value). The
`steam-*.jpg` shots were rendered with accents off and are representative.

---

## Verdict

1. **Fun-shaped: yes.** Turning the drum, watching the crowd tumble into blades and the room fill with red
   is a strong toy. The pool, the copy and the clean pastel look are good enough to sell, and Overtime at minute 4
   is the best image in the game (`img/steam-overtime-250.jpg`).
2. **Shippable: no.** The game doesn't crash, leak or soft-lock, and every screen works. The problem is the
   game layer: the ratings often don't reward skill, one shift blocks progression for the wrong player, and the
   pool twist mostly works by itself without the player doing anything.
3. **Gap #1, the challenge doesn't reward intent.** On 3 of 8 shifts, mindless input earns 3 drops:
   - Shift 3: near-idle tapping.
   - Shift 4: hold-and-mash.
   - Shift 8: holding one direction (one seed).

   Shift 5 inverts it: doing nothing scores 40 of the 45 L quota, while a careful player scores 0 drops.
4. **Gap #2, the pool twist happens to the player, not through them.** Drowning almost never occurs (12 in 104
   scripted-human runs). The pool hits its fill cap partway through 5 of 8 shifts and then stops rising. The
   "slam into the ceiling" tactic is never taught.
5. **Gap #3, readability and teaching.** The camera re-fits the rotated drum and zooms ~1.8× with the drum angle,
   so donors are 30–60 px tall most of the time. The drum coasts ~51° after you release. Each shift's one-line
   tactic (`level.lesson`) is written but never shown. Shift 1 can be passed by killing one donor by accident.

---

## Blockers (must fix before anyone pays)

### B1. The fictional brand "DRAINWELL" is a live registered US trademark
- **What / where:** it appears on the title, signage, the PA lines, every report, `src/ui/copy.js BRAND` and the
  level text. It breaks the GDD §2 LOCKED guardrail ("no real-world brands"). Found and documented in
  `docs/local/title-check.md` (serial 98280147). I list it because it is still on every screen at `6ee2927`.
- **Why it matters:** a real drain-cleaner brand shown as the company that blends people is a takedown or
  complaint risk on the store page. Every screenshot and trailer made before the rename is wasted.
- **Direction:** rename it before any marketing capture. Drop the ™ from the in-game mark.

### B2. Shift 5 "Compliance" rewards not playing, and stops normal players from progressing
- **What happens:** an Inspector is worth +20 L if he survives, and two arrive. Results by policy:

  | Policy | Litres | Drops | Inspector deaths |
  |---|---|---|---|
  | Idle (bot matrix) | 40 | 0 (quota 45) | 0 |
  | Smart bot, long session | 77.6 (37.6 collected + 40.0 bonus) | 3, "Operator of the Shift" | 0 (processed 1 of 21 donors) |
  | Smart bot with 0.3 s human latency ("thinker") | 44.3 | 0, both seeds | 1 |
  | Worse player (0.6 s latency, 15 % wrong-way inputs) | 73 | 2 | 1 |
  | Masher, 1.5 s holds | 13 | 0 | 2 |

  - The worse player beats the careful one. Outcomes depend on whether the sphere happens to get hit.
  - The whole floor is one spike bed (−4.6…4.6 m) and the Inspector lands in the same crowd. "Steer the crowd
    away from him" isn't something you can do on purpose.
  - His sphere is a faint translucent bubble at gameplay zoom (`img/s5-thinker-01.jpg`), so you can't see what
    you're protecting.
- **Evidence:** `raw/humanmatrix-5-8.jsonl`, `docs/qa/botmatrix-5-8.json`, `raw/longsession.log` (shift 5
  line), `img/s5-thinker-0*.jpg`, `img/s5-masher-0*.jpg`.
  Repro: `node tools/simbot.mjs --level 5 --policy idle` gives 40 L.
- **Why it matters:** shift 5 gates shifts 6–8 and the ending (one drop unlocks the next shift). The lesson the
  player learns is "don't play".
- **Direction:**
  - Give the Inspector his own lane: a separate entry, or a safe ledge he drifts to. Then protecting him is a
    steering skill.
  - Make the survival bonus conditional on processing quota (e.g. paid only above q1).
  - Make the sphere opaque-tinted with a hazard-orange rim.
  - Re-check the shift with laggy and noisy personas, not only `smart`.

---

## Major (clearly hurts fun or polish)

### M1. Mindless input earns top ratings; "3 drops needs mastery" fails on 3 of 8 shifts
Litres / drops per persona, seeds 1 and 2 (`raw/humanmatrix-*.jsonl`):

| Shift | Cautious (0.25 s taps) | Holder (one direction) | Masher (3 s holds, slam spam) | Thinker | Quota |
|---|---|---|---|---|---|
| 3 | **162 / 172 L, 3★** | 60 / 48 L, 1★ | 123 / 134 L, 1★ | 173 / 169 L, 3★ | 40 / 135 / 150 |
| 4 | 5 L, 0★ | 24 / 30 L, 0★ | **112 / 120 L, 3★** | 126 / 112 L, 3★ | 40 / 95 / 110 |
| 8 | – | 66 L 1★ / **160 L 3★** | 62 / 68 L, 1★ | 140 L, 2★ (browser) | 55 / 125 / 150 |

- **Overtime:** the mindless bots reach ~75 % of the best player.
  - Bots: `spin` 1175 L, `rock` 1145 L, `smart` 1537 L (`docs/qa/botmatrix-ot.json`).
  - My masher persona was still alive at 5:24 with 945 L.
  - The HUD "Demand" meter maxes out (`demandLevel = 1`) at ~110 s, so it shows nothing for the rest of the run
    (`raw/ot-masher/trace.json`).
- **Why it matters:** if hammering the keys gets the top rating, the drops mean nothing and nobody replays for
  them.
- **Direction:**
  - Shift 3: the hanging saws reach the floating crowd on their own as the tide rises. The player should have
    to bring the crowd to the waterline.
  - Shift 4: the side spike beds near the corners are what the mashing farms. Move the yield into the middle of
    the face.
  - Make 3★ depend on technique (combo peak, early finish, zero drownings), not only volume.
  - Overtime: scale the drain with how well the player has been doing, or weight combos more heavily.

### M2. The pool twist mostly plays itself
- **Drowning is close to absent:**
  - Scripted-human matrix: 12 drownings in 104 runs.
  - Browser personas: 3 in 19 runs.
  - The thinker drowned 0 donors on every shift.
  - Shift 3 ("teaches floating/drowning"): the thinker clears all 26 donors by t=60 s with 0 drownings
    (`img/s3-thinker-0*.jpg`).
- **The pool reaches its 0.82 fill cap and then stops rising.** Quotas exceed `capacity × maxFill` on shifts 2,
  3, 4, 6 and 7. For example, shift 3 is capped at 65.6 L of pool against a 135/150 L quota. Time to cap:

  | Run | Cap reached at |
  |---|---|
  | Shift 3 thinker | 40 s |
  | Shift 3 masher | 48 s |
  | Shift 4 thinker | 92 s |
  | Shift 6 masher | 78 s |
  | Shift 7 thinker | 106 s |

  After that, the rising tide is a static backdrop. The litres keep climbing, but the room stops reacting.
- **Ceiling slams and the waterline** are explained in exactly one line: the shift-3 PA at t=40 s ("Donors
  float. Donors also drown."). That line arrives after the thinker has already scored 3 drops.
- **What does work:** the visual. Bodies float, the saws and spikes sit visibly under the surface, and the room
  turns red (`img/s2-thinker-03.jpg`, `img/steam-3-29.0.jpg`, `img/steam-overtime-250.jpg`).
- **Why it matters:** this is the hook in the one-line pitch. Right now the player watches it, but doesn't play
  with it.
- **Direction:**
  - Let the cap be reached only near the end of the shift (raise capacity, or lower quotas on 3/4/6/7).
  - Make drowning a visible, timed threat: a bubble meter over submerged heads, a gurgle, a "−X L" waste popup.
  - Add one ceiling hazard per pool shift that only the risen pool or a slam can reach.
  - Show the lesson on the briefing (see M5).

### M3. The camera zooms ~1.8× with drum angle, so donors are small whenever the drum is tilted
- **What happens:** `src/render/camera.js` fits the rotated drum, with lookahead.
  - Upright: the interior fills the screen and donors are ~150 px tall at 720p.
  - At ~45°: the camera pulls back almost 2×. Donors are ~40–60 px, severed parts are confetti, and speech
    bubbles shrink to about 10 px text.
- **Evidence:** `img/s1-cautious-01.jpg` (tiles t=6.0 → t=6.5, a single 0.25 s tap); `img/s1-masher-01.jpg`;
  the drum's on-screen size changes in every row of `img/s2-thinker-01.jpg`.
- **Why it matters:**
  - Shifts 2–8 start upside down and are played by tilting, so the camera is almost always in motion.
  - Kills read as specks, which undercuts the slapstick.
  - The GDD asks for a "fixed front view, subtle sway".
  - Possible motion discomfort. I could not judge this at 1 fps (see the human checklist).
- **Direction:** pick one zoom that fits the drum's circumscribed circle (or a compromise, like 85 % of it with a
  soft crop) and keep it. Use zoom only for punches.

### M4. The drum handles like ice: most of the travel happens after you let go
- **What happens:** pure `stepDrum` with the live tunables (`tools/qa/control.mjs`, `raw/control.json`):

  | Input | Angle at release | Final angle | Settles |
  |---|---|---|---|
  | 0.1 s tap | 2.4° | 13° | 0.9 s |
  | 0.25 s tap | 11° | 41° | 1.4 s |
  | Release from full speed | — | +51° coast | 1.4 s |
  | Release from full speed with Brake | — | +10° | 0.4 s |

  Other numbers: 0.40 s to reach full speed; a 180° flip takes 1.6 s.
- **Why it matters:** shifts 2–8 are about precise half turns and tilts. Coasting 50° past the target makes
  aiming feel loose.
  - Brake fixes it, but it is prompted only on shift 1, and only after 2.5 s above 1.9 rad/s.
  - My cautious persona never stopped where it meant to (`raw/s1-cautious/trace.json`: θ keeps drifting
    0.3–0.7 rad after each tap).
- **Direction:**
  - Raise `coastDamping` (or add a strong "hold" once input is released below ~1 rad/s).
  - Alternatively, prompt Brake contextually on shifts 2–3 whenever the drum overshoots a hazard face.

### M5. Teaching: shift 1 can be passed by accident; shift 2 is a cliff; the tactic lines are never shown
- **Shift 1 is passed by luck.** The 1-drop quota is 6 L. My cautious persona bruised one donor to death, got
  6.1 L, saw the headline "Meets expectations." and unlocked shift 2 with 14 of 15 donors still alive
  (`img/s1-cautious-report.jpg`).
- **Shift 2 is a cliff.**
  - Cautious: 0 L on both seeds.
  - Holder / hold-and-slam: 1 drop.
  - The flip / tilt-into-blades technique is never shown. It is told once, in a PA line at 15–26 s on shift 1.
- **`level.lesson` is never displayed.** Every shift has a tactic sentence in its level data, for example
  shift 3: "The pool lifts everything. Bottom hazards drown; use the waterline." No UI file reads it
  (`grep lesson src/ui` finds only the teaching-prompt array). The briefing shows the `BRIEFINGS` blurb instead.
- **Contradictory PA lines on the player's very first kill** (shift 1, t=15.48, `raw/s1-cautious/events.json`):
  - "Donation received. Thank you for your service."
  - "Bruising is not a donation. Please use the equipment."

  Both fire on the same frame, 0.5 s after the "drop them from height" hint. Both `on: 'donor:death'` entries in
  `shift1.js` match the first death.
- **Direction:**
  - Show `lesson` as a second line on the briefing and as the opening PA line.
  - On shift 1, make the first donation-type PA line exclusive (`where: { cause: not impact }`).
  - Raise shift-1 q1 so that it needs at least one spike kill.
  - On shift 2, add a scripted moment: the first wave lands, the PA says "Turn them over.", and the prompt shows
    a half-turn arrow.

### M6. The finale isn't a finale
- **Dead time:** shift 8 uses fixed-timer waves (`advanceWhenClear: false`). Every bot policy sits idle for
  15–22 s at a stretch (bot matrix `maxIdle`). Thinker / masher in the browser went 26 s / 20 s without a litre.
- **No escalation:** the pool never reaches its cap (thinker fill 0.65 at the end), so it peaks lower than
  shift 3. Thinker 2★, holder 3★ on seed 2 (see M1).
- **The ending works:** a real shift-8 run, then "Clock out", plays the 3-line PA sting (~16 s), then credits,
  then title, with no errors (`tools/qa/ending2.mjs`).

  I could not judge the camera drop in real time.
- **Why it matters:** the last shift should be the hardest and the most spectacular. It has the most hazards,
  but it plays the slowest.
- **Direction:**
  - Keep the Inspector visits timed, but advance the regular waves when the drum is clear.
  - Lower the capacity so that the room floods by 100 s.
  - Make the staff-uniform twist land: name tags, "Operator" lines from the donors.

### M7. Sim headroom on the worst case is thin (verify on target hardware)
- **What happens:**
  - Long single-page session, all 8 shifts plus Overtime: Overtime sim-step means over 10 s windows reach
    **4.3–5.8 ms** at 377–395 bodies (budget: 4 ms, ≤ 450 bodies).
  - Single-step spikes reach 38 ms.
  - 0.92 M triangles and 170 draw calls at peak.
  - Bot matrix (4 parallel jobs) shows single-step spikes from 85 ms to 1.37 s on several shifts. That is partly
    contention, but worth a look.
- **Evidence:** `raw/longsession.json`, `raw/longsession.log`, `docs/qa/botmatrix-*.json`.
- **Why it matters:** a 38 ms step is a two-frame hitch. Overtime is where players spend the most time.
- **Direction:** run `tools/perf.mjs overtime smart` on a mid-range laptop. Cap Overtime body count harder:
  dissolve debris sooner once more than 300 bodies are active.

---

## Minor

- **Report headline is one tier too generous.** `src/sim/modes/report.js` TITLES maps 1★ to "Meets
  expectations." and 3★ to "Operator of the Shift." `copy.js` has `RESULT_HEADLINES[1] = 'Quota met.'`, but it's
  bypassed. The 1/15-processed run reads "Meets expectations." and "Drownings: 0. Exemplary.". It's funny once,
  but it makes the rating feel meaningless (`img/s1-cautious-report.jpg`).
- **Shift 1 rotate prompt covers the hazard.** The "A D Rotate the drum" pill sits bottom-centre, on top of the
  floor spike bed at θ=0 (`img/fr-1280x720-05-shift-4s.jpg`, `img/s1-cautious-01.jpg`). Move it above the
  floor line or to the left plate.
- **Quality setting order.** Pressing → on "Auto" selects "Low" (order is Auto, Low, Medium, High). Players
  expect → to mean "more".
- **Future-version saves are accepted silently.** A `version: 99` save is accepted as v1 and its `unlocked: 99`
  is kept (`raw/sweep1.json` `save.futureVersion`). It's harmless now, but a downgrade should warn or back up the
  save the way corrupt saves are.
- **Uninitialised HUD.** The first HUD frame of a shift shows "0:00 · 0 left" before it fills in
  (`img/fr-1280x720-04-shift-start.jpg`).
- **Geometry count creeps.** It rose 55 to 152 over the long session; textures stayed flat at 20 to 23 and the
  DOM was stable. 30 rapid restarts gave only 46 to 52, so this is probably caches. Check that it plateaus.
- **Report total counts up from the previous value.** In one long-session capture, the shift-7 report's big
  "Total donated" figure still showed shift 6's total 5 s after appearing. It's probably a count-up running on
  slow real time, but confirm that the odometer starts from 0.
- **Thin briefings.** Each one is a single sentence with a large empty panel, and no hazard callouts.
  "Rail saws, crushers and Thin-Bloods. It is rush hour." names three new things in one shift, which goes
  against the GDD's "one new idea" rule.

---

## Per-shift table (1–5)

| Shift | Goal clarity | Readability | Feedback | Challenge | Twist present | Fun guess | One line |
|---|---|---|---|---|---|---|---|
| 1 Orientation | 3 | 4 | 3 | 2 | 1 | 3 | Rotate is prompted and the room is upright and readable. The "drop from height" idea arrives only as PA text, and 6 L passes by accident. |
| 2 Sharp Objects | 3 | 3 | 4 | 3 | 3 | 4 | First real fun: upside-down start, saws, combos up to ×4, and the pool floods half the room by 90 s. Cautious players hit a wall. |
| 3 High Tide | 2 | 3 | 4 | 1 | 4 | 3 | The flood is spectacular, but the waterline saws do the work: near-idle tapping earns 3★ and nobody drowns. |
| 4 The Good Machine | 4 | 3 | 4 | 2 | 3 | 4 | The grinder is satisfying (14 grinds for the thinker), but mashing also earns 3★ via the side spike beds. |
| 5 Compliance | 2 | 2 | 3 | 1 | 1 | 2 | You can't see the sphere and you can't steer around him. Doing nothing nearly passes, careful play fails (B2). |
| 6 Breathe Easy | 3 | 3 | 4 | 3 | 3 | 4 | The tanks give real chain-reaction moments (6 explosions for the thinker). Best-balanced mid-game shift. |
| 7 Rush Hour | 3 | 3 | 4 | 3 | 3 | 4 | The crusher rhythm works (19 crush kills for the thinker, ×8 match). The opening 13 s are quiet for a "rush". |
| 8 Staff Appreciation | 3 | 3 | 3 | 2 | 2 | 3 | Everything at once, but 15–22 s gaps and less flood than shift 3. The sting works. |
| Overtime | 4 | 3 | 4 | 2 | 5 | 4 | The best visuals in the game, and the tank-as-life idea is clear. Mindless play reaches ~75 % of the best score, and the demand bar pins at 2 min. |

---

## What is genuinely good (don't "fix" these away)

- **The pool.** A level red slab that sloshes as the drum turns, with drained grey bodies floating and blades
  visibly underwater. It is readable and it's the thing to market (`img/steam-overtime-250.jpg`,
  `img/s2-thinker-03.jpg` tile t=58.5).
- **The writing.** Best lines:
  - "Partial donations are still donations."
  - "Donors float. Donors also drown. Please choose the first one."
  - "A donor has drowned. That product is now pool water."
  - "No donors were harmed. They were processed."
  - "Overtime will be paid in exposure."
  - "Oxygen tanks returned: 0 of 39."
  - The upside-down "THIS SIDE UP" sign at the start of shifts 2–8.

  Weakest lines: "Mind your toes!" and "Coming through!", which are generic.

  The tone hits the brief: cheerful, clinical, appalling. Guardrails hold (stylised bodies, adults, no organs).
- **The art direction matches the GDD:** pastel mint tile, chrome, hazard yellow, red as the only saturated colour.
- **Robustness.**
  - A full single-page session (8 shifts, ending, credits, Overtime, initials) produced 0 console errors and 0
    warnings.
  - 30 rapid restarts across all shifts: no growth in bodies, textures or DOM nodes.
  - Corrupt save: toast, plus a backup copy kept under `.corrupt`.
  - Bad-typed save values are sanitised.
  - Pausing during slow-mo resumes at timescale 1.
  - Hidden tab and window blur both pause, and the sim does not advance.
  - 160 random menu key presses: no errors and no stuck state.
  - No bodies escaped the drum in 166 bot runs.
- **The menu flow is clean.**
  - Every back path returns focus to the item you left from: Settings goes back to "Settings", the confirm
    dialog goes back to "Quit to menu".
  - The confirm dialog defaults to "Keep working".
  - The A / Space press that starts a shift does not also slam.
  - Hold R and hold Select both restart. A tap of R does not.
- **The gamepad works end to end:** D-pad and stick navigation, adjusting sliders, B for back, Start to pause,
  triggers and stick to rotate, X to brake, and the glyphs switch to pad icons (`img/pad-hud-glyphs.jpg`).
- **Settings take effect live and persist across a reload.** Verified for volume (engine gain values), quality,
  blood colour and reduce-flashing.
- **The UI holds at every size tested:** 1280×720, 1280×800, 1920×1080, 2560×1080, 1024×768 and 800×600
  (`img/rs-sheet-*.jpg`).

---

## What I could not judge (a human should do this in ~15 minutes)

On a real GPU, with headphones, from a fresh save (`localStorage.removeItem('edc.save.v1')`):

1. **Camera (2 min, shift 2).** Rock the drum ±45° for 30 s. Does the zoom pumping (M3) feel cinematic or
   seasick? Can you still pick out a single donor while tilted?
2. **Control feel (3 min, shifts 1–2).** Try to stop the drum exactly upside down without Brake, then with it.
   Is the ~50° coast fun momentum or frustrating? Does the first-frame response feel instant?
3. **Audio by ear (3 min).**
   - Every slam: a thump on the same frame as the visual jolt.
   - Every saw kill: a squelch and the saw pitch dropping under load.
   - Muzak detuning as fill rises past 50 %.
   - The PA chime before each line.
   - Is anything clipping or masking when ×4 combos and explosions stack on shift 6?
   - Do the menus stay quiet?
4. **Performance (3 min).** Overtime past 4:00 at High quality: is it a steady 60 fps? Do hitches line up with
   big explosions or the grinder? Does the Auto quality setting actually step down?
5. **Pacing (2 min).** Shift 8, from 0 to 60 s: do the gaps between waves feel like breathing room or dead air?
6. **Ending (1 min).** Clock out after shift 8. Does the camera drop into the chute read as "you're next"? Is
   16 s too long or too short?
7. **Fullscreen (1 min).** Toggle it in Settings in the Electron build. Headless Chromium can't show whether the
   setting matches the real window state. Also verify Alt-Enter / F11 if supported.
8. **Desktop build.** Not tested at all here: `desktop/`, Steam overlay, the Quit button and the `app://`
   save origin.

---

## Evidence index and tools

- **Contact sheets:** `docs/qa/img/s{1..8}-{thinker,masher}-NN.jpg`, `s1-cautious-NN.jpg`, `ot-*-NN.jpg`.
  - 0.5 s spacing for shift 1, 2 s for shifts 2–8, 8 s for Overtime.
  - Each tile label shows sim time, input (`<<` / `>>`, SLAM), ω, litres, kills, fill.
  - Reports: `*-report.jpg`.
- **First launch:** `img/fr-sheet.jpg`, `raw/fr-1280x720.json` (screen-by-screen text and focus).
- **Store candidates:** `img/steam-*.jpg`, `img/steam-sheet.jpg`. Cold take:
  - Worth using: the Overtime flood, the shift-3 waterline saws, shift 8 in staff uniforms.
  - The rest are mostly empty pastel tile with specks: shift 1 tumble, shift 5, shift 6 and shift 7 don't show
    what the game is.
  - Shoot store art at the upright camera with the pool at 40–70 % and donors mid-air, and crop tighter than the
    gameplay camera does.
- **Data:**
  - `docs/qa/botmatrix-{1-4,5-8,ot}.json`: all bot policies, 2 seeds.
  - `raw/humanmatrix-*.jsonl`: scripted humans.
  - `raw/*/trace.json` and `events.json`: per-run.
  - `raw/longsession.*`: memory, bodies and step time across the full session.
  - `raw/sweep1.json`: menus, back paths, pause, settings, saves.
  - `raw/sweep2.json`: resize.
  - `raw/control.json`: drum response.
- **Tools (`tools/qa/`):**
  - `persona.mjs`: browser persona runs with frames.
  - `personas.js`: the cautious, masher, holder and thinker personas.
  - `humanmatrix.mjs`: the same personas headless in Node.
  - `sheet.py`: builds the contact sheets.
  - `firstrun.mjs`, `sweep1.mjs`, `sweep2.mjs`, `pad.mjs`, `ending.mjs`, `ending2.mjs`.
  - `longsession.mjs`, `steam.mjs`, `control.mjs`.
  - `withserver.mjs`: wraps any of these with its own Vite server on 5179, e.g.
    `node tools/qa/withserver.mjs tools/qa/sweep1.mjs`.
