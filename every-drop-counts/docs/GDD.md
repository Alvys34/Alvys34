# EVERY DROP COUNTS — Game Design Document

> Working title. A DRAINWELL™ Community Donation Center experience.
> All numbers in this document are **placeholders** to be tuned in play/sim, unless marked LOCKED.

## 1. One sentence

You are the operator of a giant rotating "donation drum": tumble a crowd of cheerful, sedated
volunteer donors into saws, spikes and grinders, and watch the room **flood with the blood you
spill** — which changes the physics of the very room you are playing in.

**Genre:** 3D physics arcade / dark-comedy splatter. Single player. Sessions of 2–3 minutes per shift.
**Platform:** Windows + Linux desktop (Steam), keyboard/mouse and gamepad. Steam Deck friendly.

## 2. Pillars (every feature must serve at least one)

1. **The drum is the controller.** The player never touches a donor directly. Two verbs only:
   ROTATE the drum and SLAM it. Everything else is physics consequence. Same input → same result.
2. **The gore is the game state.** Blood is not decoration: it is the score, the timer pressure,
   and a rising liquid that makes bodies float, drowns donors, and takes floor hazards out of play.
   A shift starts as "drop people onto spikes" and ends as "churn a red soup against the ceiling".
3. **Cheerful and clinical on the outside, appalling on the inside.** Pastel tiles, elevator
   muzak, smiling donors, polite PA announcements — and the only saturated colour in the game is
   red. The "fucked up" feeling comes from the contrast and the corporate indifference, never
   from cruelty-for-realism. It is slapstick: over-the-top, cartoonish, absurd volumes of blood.

**Content guardrails (LOCKED):** all donors are adults; no sexual content; no real-world
groups, brands or people; no torture-realism (stylised low-poly bodies, no anatomical organs
beyond bone nubs and red caps).

## 3. Core loop

- **Moment (seconds):** nudge the drum → the crowd slides/tumbles → someone meets a saw → fountain,
  squelch, litres tick up.
- **Loop (20–30 s):** a wave of donors drops from the intake hatch → read where the hazards are
  relative to current "down" → rotate/slam to process them → combo ("Sponsor Match") if kills chain →
  next wave arrives while the pool is a bit deeper.
- **Session (one shift, 90–150 s):** hit the litre quota before the shift clock ends. 1–3 blood-drop
  rating. Results screen = deadpan "shift report".
- **Meta:** 8 shifts unlocking in order (1 drop to unlock the next), each introducing exactly one
  new thing; then **OVERTIME** (endless) with a local high-score table. Local achievements.

## 4. Controls (LOCKED verbs, placeholder numbers)

| Action | Keyboard | Gamepad | Notes |
|---|---|---|---|
| Rotate drum CCW / CW | A / D or ← / → | Left stick X, or LT / RT | Angular acceleration with inertia; full 360°, unlimited |
| Brake | S / ↓ / Shift | X | Strong angular damping while held |
| SLAM | Space | A | Vertical jolt, cooldown ~2.5 s |
| Pause | Esc / P | Start | |
| Restart shift | R (hold 0.5 s) | Select (hold) | |

- **Rotate:** input → angular acceleration (~5 rad/s²), max |ω| ~2.2 rad/s, light damping with no
  input (drum coasts ~1 s then holds its angle). First visible response within 1 frame
  (drum starts moving + motor whine on press).
- **Slam:** instant Δv (~9 m/s) to every dynamic body along drum-relative "up" (opposite current
  effective gravity) + the drum visibly jolts + screen shake + bass thump. Uses: throw floaters into
  ceiling hazards, shake impaled bodies loose, unclog the grinder. Cooldown shown on HUD.
- **Feel rules:** hit-stop (2–4 frames) on dismemberment only when ≥2 events coincide; slow-mo
  (0.35× for ~0.6 s) on big combos (≥4 kills in 2 s); screen shake scales with event size and has a
  settings toggle; every verb and every hit has a sound on the same frame.

## 5. The drum (physics model)

- Sealed box chamber. Interior cross-section ~16 m wide × 10 m tall, depth ~5 m (z). The front
  face is glass (the camera looks through it), the back wall is the big "canvas".
- It rotates about the z axis through its centre. **Simulate in the drum's rotating reference
  frame:** colliders are static, the gravity vector rotates, and fictitious forces
  (centrifugal ω²r, Euler −α×r, optionally Coriolis) are applied to every dynamic body, so a slow
  turn = tumble-dryer cascade and a sustained fast spin = bodies pinned to the walls like a
  centrifuge. Rendering rotates the drum group; the facility backdrop stays level.
- The 5 m depth must matter: bodies pile and pass behind each other, some hazards cover only part
  of the depth.

## 6. Donors

Ragdolls: head, chest, pelvis, 2× upper arm, 2× forearm, 2× thigh, 2× shin (10 bodies), jointed with
limits. Hospital gown, simple painted face. **Alive** donors are "lightly sedated": a weak
upright/balance torque + leg stiffness makes them try (and mostly fail) to stand, they flail a
little, and emit speech bubbles ("Happy to help!", "Is this normal?", "I was told there'd be
cookies."). **Dead** donors go limp.

**Damage model**
- Each part has HP. Sources: hazard contact (per hazard), impact (relative speed above a
  threshold, scaled by mass), crush, explosion, drowning (alive + head submerged > ~6 s).
- Cutting damage that zeroes a limb **severs** it (joint removed; both stumps bleed). Blunt damage
  that zeroes a limb **breaks** it (limp joint).
- A donor dies when head or chest HP hits 0, when blood < 40 %, or by drowning.

**Blood model**
- Each donor carries a (comically large) blood volume; each part owns a share. Wounds bleed at a
  rate until that part's share is empty; severing/grinding releases bursts. Dead donors keep
  bleeding from open wounds; an **unwounded corpse (e.g. drowned) yields nothing** — drowning is
  waste.
- Every litre that leaves a body is credited to `collected` and feeds the pool.

**Donor types** (introduced one per shift)
| Type | Look | Rule |
|---|---|---|
| Standard | pastel gown | baseline (≈5 "L" share units — display numbers tuned for satisfaction, not realism) |
| Big Giver | large, heavy | ~2× blood, ~2.5× mass; crushes others when it lands on them; hard to slam |
| Thin-Blood | pale, red wristband | any wound drains them fast and completely |
| Inspector | suit, orange hard hat, inside a transparent "personal safety sphere" | **must survive.** Sphere rolls fast, cracks after a few hazard hits, then he is a normal ragdoll. Death = "workplace incident": −25 L fine. Alive at shift end = +20 L compliance bonus |

**Props**
- **Oxygen tank:** punctured by saw/spike/hard impact → rockets for ~2 s → explodes (radial
  impulse + damage). Chain-reaction tool and Inspector-killer.

## 7. Hazards (all mounted on drum walls; hazard-stripe yellow/black so they read instantly)

| Hazard | Behaviour | Player lesson |
|---|---|---|
| Spike strip | Impact damage ∝ speed; fast bodies get **impaled** (stuck, steady bleed) until slammed loose | drops need height |
| Saw | Spinning disc, cuts the part it touches, flings debris tangentially; motor pitch drops under load | precision cuts, covers part of depth |
| Rail saw | Saw travelling along a wall on a rail | timing |
| Grinder | Wall pocket with two toothed counter-rotating rollers; drags parts in and converts them 100 % to blood over ~1.5 s; can clog (slam to clear) | best yield, slow |
| Crusher | Periodic piston from a wall; telegraphed (light + hiss) | rhythm |

## 8. The pool (the twist)

- `fill = collected / levelCapacity` → liquid **area** in the drum cross-section. The surface is
  always level in the world, so as the drum turns the blood runs to whatever is currently "down"
  (2D polygon clip of the rectangle; solve surface height for area).
- **Buoyancy + drag** on submerged parts: bodies and severed parts float at the surface.
- **Consequences:** bottom-wall hazards end up under the pool where impacts are slow (drag) and
  bodies float above them → the player must use side walls at the waterline, the ceiling (slam!),
  and rotation to bring a fresh wall down. Headroom shrinks as the pool rises, so slams get
  deadlier. Alive donors drown (waste).
- Parts that are fully drained and submerged dissolve after a few seconds (performance + clean read).
- **Escalation of tone with fill:** lights drift from soft white to emergency red, the muzak
  detunes and distorts, PA text glitches, the glass gets smeared.

## 9. Scoring

Single currency: **litres**.
- Litres released from donors.
- **Sponsor Match (combo):** each kill within 3 s of the previous one raises the multiplier
  (×2 … ×8). Each kill grants bonus litres = base × (multiplier − 1). Popup: "SPONSOR MATCH ×3".
- **Fines / bonuses:** Inspector incident −25 L; Inspector survives +20 L; early finish
  (all donors fully processed) + litres per second left.
- Rating: 1 / 2 / 3 drops at per-level quota thresholds. Quota 1 must be reachable by a careless
  spinner on early shifts; 3 drops must require intent (hazard routing, combos, no drownings).

## 10. Shifts (levels) — one new idea each (introduce → practise → twist → test)

1. **Orientation** — floor spikes only, 3 small waves. Teaches ROTATE (drop from height).
2. **Sharp Objects** — wall saws; ceiling spikes. Teaches SLAM.
3. **High Tide** — big quota, small drum capacity: the pool rises fast. Teaches floating/drowning.
4. **The Good Machine** — grinder (and clogging).
5. **Compliance** — Inspectors. Teaches steering the crowd *away*.
6. **Breathe Easy** — oxygen tanks + Big Givers. Chain reactions.
7. **Rush Hour** — rail saws + crushers + Thin-Bloods, dense waves.
8. **Staff Appreciation Day** — everything; donors wear staff uniforms. Ending sting after the
   report: PA text, calm as ever — "Operator, please proceed to the intake chute. Thank you for
   donating." → the camera drops into the drum → credits.

**OVERTIME (endless):** the pool is your life. A demand pump drains it at a rising rate; waves get
denser and nastier. The tank running dry ends the run. Score = total litres delivered. Local top-10.

## 11. Presentation

- **Look:** clean toy-like low-poly, soft lighting with shadows, pastel mint/cream tile world,
  chrome and hazard-yellow machinery. Blood is the only saturated red and it is *very* red, glossy,
  and persistent: droplets, splats that paint the back wall and the glass, the pool with a
  sloshing surface. The drum should look filthy by the end of a shift.
- **Camera:** fixed front view, mild perspective so depth reads, subtle sway; kick/zoom-punch on
  big events. The drum rotates on screen; the facility behind it does not.
- **Audio (all synthesised, no samples):** wet squelches, bone cracks, saw whine with load,
  grinder chug, hydraulic slam, glassy drips, muffled polite yelps; elevator-muzak loop that
  degrades with fill; PA chime.
- **Writing:** short, deadpan corporate lines for PA, speech bubbles, results ("Complaints
  received: 0 (donors unavailable for comment)", "Cookies distributed: 0").
- **UI:** friendly medical-corporate: rounded sans, lots of white, one accent mint, red only for
  blood values. HUD: tank gauge with drop thresholds, shift clock, donors remaining, slam cooldown,
  Sponsor Match popup, PA ticker. No wall-of-text tutorials: shift 1–2 teach with one-line PA prompts.

## 12. Production-readiness checklist

- Title → shift select → play → pause → results → next/retry/menu; Overtime; settings
  (master/music/SFX volume, fullscreen, quality preset, screen shake, blood colour "red / green
  (streamer-safe)"), credits + third-party licences, quit (desktop).
- Save (progress, best litres per shift, settings, Overtime top-10, achievements) survives restart.
- Keyboard + gamepad everywhere, including menus. Window resize / any aspect ratio 16:10–21:9.
- Stable 60 fps target on a mid-range laptop GPU with the worst-case shift; quality presets and
  automatic degradation of particles/shadows.
- No console errors in a full playthrough. Pausing on focus loss.
- Desktop builds for Windows x64 and Linux x64, plus Steam store assets and release notes.

## 13. Out of scope (cut list — do not build)

Multiplayer, level editor, online leaderboards, story cutscenes, voice acting, key rebinding UI,
mobile/touch, localisation, more than one drum shape.
