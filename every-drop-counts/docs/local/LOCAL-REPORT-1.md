# LOCAL-REPORT-1 — first pass on a real GPU, a display and Windows

2026-11-13, branch `ccr-567c397f-f3s53e`. Everything was measured on `cf1c396`. The integration
commit `6ee2927` landed as this report was pushed and was **not re-measured**; it changes only
comments in `camera.js` (zoom rate unchanged), the desktop smoke path, docs and audio calibration
tooling, so the findings below still apply.
Machine: Windows 11 Pro 26200, Ryzen 7 9800X3D, **Radeon RX 9070 XT** (driver 32.0.32015), plus the
CPU's **Radeon iGPU (2 CU RDNA2)**, 32 GB, primary monitor 2560×1440 @ 180 Hz. Chrome 157 (system),
Electron 45.3.1 for the desktop build.

Nothing under `src/` or `desktop/src|scripts` was edited. Bugs found there are written up in §6.
Tools written for this pass live in `tools/local/` (own `package.json`, Playwright on the system
Chrome, never SwiftShader). Raw outputs (JSON, profiles, videos) are in `tools/local/out/`, which
is git-ignored.

**Not a desktop laptop GPU.** This machine is not a dual-GPU laptop. The RX 9070 XT is far above
the GDD's "mid-range laptop GPU" target, so I also pinned Chrome to the CPU's tiny iGPU
(`--use-adapter-luid=0,76383`). That iGPU is *weaker* than a typical laptop GPU (a Radeon 780M has
12 CUs, this has 2), so treat the two tables as a ceiling and a floor.

---

## 1. Real-GPU performance

Method (`tools/local/gpu-perf.mjs`): production build (`npm run build && npm run preview`),
1920×1080 viewport at DPR 1, `?debug=1&quality=Q&seed=1`, the `smart` bot from
`tools/policies.mjs` driving `__edc.setInput` every frame like a player. Fresh page per cell.
**vsync off and frame cap off** (`--disable-gpu-vsync --disable-frame-rate-limit`) so frame time is
real cost, not the 180 Hz refresh. Shift 1 / 7: measure seconds 15→55 (dGPU) or 15→45 (iGPU) of
the shift. Overtime: fast-forward the sim with the bot (no rendering) until ≥ 400 bodies, then
measure in real time. The auto-quality governor is off under `?debug=1`, so each row is the
preset itself. 1% low = mean of the worst 1% of frame intervals.

### RX 9070 XT (ceiling)

| Preset | Shift 1 avg / 1% low | Shift 7 avg / 1% low | Late Overtime avg / 1% low | Draw calls (max s1/s7/OT) |
|---|---|---|---|---|
| low | 1.13 ms / 4.75 ms | 1.35 ms / 5.16 ms | 1.54 ms / 8.71 ms | 72 / 90 / 117 |
| medium | 1.73 ms / 6.64 ms | 1.95 ms / 6.27 ms | 2.12 ms / 11.89 ms | 98 / 130 / 170 |
| high | 1.81 ms / 4.77 ms | 2.07 ms / 5.14 ms | 2.21 ms / 7.34 ms | 105 / 132 / 172 |

Overtime rows reached 407–428 live bodies. Sim step mean 1.0–1.6 ms (shifts), 2.0–3.1 ms (late
Overtime): inside the 4 ms budget. Main-thread split per frame on high, late Overtime: sim 0.31,
view 1.57, UI 0.10, audio 0.03 ms. Draw calls stay under the 250 budget everywhere (max 172).
Triangles: 250k (low s7) to 860k (high, late Overtime with 350 bodies; donor outlines double donor
triangles as the handoff said).
Caveat: in "low / shift 1" the bot finished the shift inside the window, so part of it is the
report screen.

### Radeon iGPU, 2 CU (floor)

| Preset | Shift 1 avg / 1% low | Shift 7 avg / 1% low | Late Overtime avg / 1% low |
|---|---|---|---|
| low | 25.1 ms (40 fps) / 1007 ms | 20.7 ms (48 fps) / 133 ms | 26.9 ms (37 fps) / 140 ms |
| medium | 33.5 ms (30 fps) / 67 ms | 36.6 ms (27 fps) / 82 ms | 46.8 ms (21 fps) / 335 ms |
| high | 42.9 ms (23 fps) / 332 ms | 49.2 ms (20 fps) / 102 ms | 69.6 ms (14 fps) / 828 ms |

GPU-bound: "view" (render submission, which blocks on the GPU) is 19–59 ms of each frame; the sim
stays at 0.5–3 ms per step. Low is only ~1.5× faster than high on this GPU, because what costs
the most (fill rate at 1080p: post, pool slices, blood atlas) scales with pixels, not with
particle caps. Worst single frames: 8.0 s (low s1), 2.8 s (high OT), see "start-of-shift stall".

### Start-of-shift stall (reproducible, every run, both GPUs) — top perf problem

- On the RX 9070 XT the first frames of every shift take **580–770 ms**, then **145–215 ms** when
  the first donor spawns/first slam happens, then 60–110 ms frames for ~3 s (hitch probe,
  `tools/local/hitch-probe.mjs`, 6 runs).
- On the iGPU the same stalls reach **1–8 s** and keep appearing when new effects first show up
  (first blood, first tank, first sphere crack): that is where the 1% lows above come from.
- Cause (CPU profile, `tools/local/cpu-profile.mjs`): `getProgramInfoLog` called from three's
  `getUniforms` on first render of each new material = **lazy shader compilation**, 500 ms of
  blocking in the first 6 s on the fast GPU. Part of the first-frame stall is also the audio bank
  `warmup(5000)` in `ui.startRun` when a shift starts straight from boot (debug path); in the real
  menu flow the bank pre-renders in the menus, so that part may not occur for players.
- Fix suggestion (render owner): during the briefing, `renderer.compileAsync(scene, camera)` with
  every material the shift can show already in the scene (a hidden donor of each look, a blood
  splat, a sphere, a tank, the pool at a high level), or render one hidden frame of each.
  `KHR_parallel_shader_compile` is available on both GPUs here (listed in chrome://gpu).

### Auto-quality governor (`src/render/quality.js`)

Tested on the iGPU with `?autoq=1`, vsync on, starting at high, shift 7, 120 s
(`tools/local/governor-test.mjs`). It does react, at the designed 2.5 s steps:

| t (s) | preset | level | pixel ratio | fps |
|---|---|---|---|---|
| 5 | high | 0 | 1 | 22 |
| 17 | high | 3 | 0.75 | 25 → 31 |
| 21 | medium | 0 | **1 (reset)** | 27 |
| 35 | medium | 3 | 0.75 | 28 |
| 40 | low | 0 | **1 (reset)** | 16 (preset switch hitch) |
| 52–85 | low | 3 | 0.75 | 40–58 |

Problems:
1. **Slow**: ~52 s of 16–28 fps before it reaches a playable state. A whole shift is 105–140 s.
2. **Levels 1–2 do nothing on a GPU-bound machine** (load scale 0.7 / 0.45 and bloom off: 22 → 25,
   23 → 24 fps). Only level 3 (pixel ratio × 0.75) helps (+25–45%).
3. **Every preset step resets the pixel ratio to 1**, throwing away the only lever that worked,
   then walks levels 1–3 again (7.5 s each time). Each preset switch also causes a visible stall
   (shader/target rebuild).
4. It never reaches 60 fps here even at low + 0.75; that is the iGPU's limit, fine.

Suggestions (render owner): try pixel ratio first when the frame is GPU-bound (view ms ≫ sim ms);
keep the pixel scale across preset changes; shorten the dwell when far over budget (e.g. avg > 2×
budget → step immediately); pick the first-launch preset from a 2-second benchmark during boot
instead of starting everyone at high (`quality: 'auto'` currently means high).

### Memory over 3 consecutive shifts

`tools/local/mem-test.mjs`: three real-time shift-7 runs in one page, high preset, forced GC
(CDP) after each report.

| After | JS heap | DOM nodes | Listeners | three geometries / textures | Chrome GPU process |
|---|---|---|---|---|---|
| boot | 12.4 MB | 746 | 45 | 42 / 19 | 1088 MB |
| shift #1 | 16.3 MB | 896 | 72 | 69 / 21 | 787 MB |
| shift #2 | 16.9 MB | 888 | 56 | 69 / 21 | 862 MB |
| shift #3 | 13.0 MB | 882 | 55 | 69 / 21 | 853 MB |

**No growth.** Geometries and textures are flat after the first shift; heap returns to ~13 MB;
GPU process memory moves ±40 MB between runs with no trend.

### Steady 1 Hz hitch: not reproducible

The first two probes showed ~25 ms hitches once a second that disappeared when the DOM HUD was
hidden. Three later runs (with HUD) showed **zero** frames over 20 ms in 20 s each. The first runs
overlapped `npm test` (4 workers) in the background, so I treat it as external load, not a bug. If
anyone sees 1 Hz stutter on a weak CPU, look at `hud.js bump()` (forces a sync reflow via
`offsetWidth`) first.

---

## 2. Real-time visual review

Captured in real time on the RX 9070 XT, vsync on, 1080p, high preset unless noted
(`tools/local/capture.mjs`, `capture-screen.mjs`): shifts 1, 3, 5, 8 (late, ~45% fill),
Overtime with 350–430 bodies, camera spin-up test, green blood, reduced flashing, each preset.
Videos and screenshots: `tools/local/out/cap/`, `tools/local/out/footage/`.

What works in motion:
- **Pool line** is always readable: a bright surface edge on a dark red volume; saws and spikes
  below it read through the translucent pool (8 consecutive 60 fps frames checked: no flicker, no
  z-fighting between pool, glass and back wall).
- **Inspector sphere** reads instantly (bright rim + highlight) even on a red-painted wall.
- **Donors** read as colourful figures; outlines + rim light do their job up to ~200 bodies.
- **Green blood** recolours droplets, wall paint, pool and runners.
- **Reduced flashing** works: the largest frame-to-frame brightness jump of the whole frame drops
  from 3.2 to 1.2 (out of 255) over 30 s of shift 2 with slams; both are far below flash-risk
  levels.
- **Lighting escalation** is real and fill-driven: facility wall colour goes from mint
  (179,200,191) in shift 1 to warm brown-red (159,130,110) late in shift 3 (82% fill). In motion it
  reads as "sepia / dirty" more than "emergency red"; at shift 8's 45% fill it is barely visible
  (172,182,167).
- **No console errors** in any real-GPU run (the only message is a 404 for `/favicon.ico` in the
  browser build, §6). No shader compile errors, no missing textures, no context loss.
- Low / medium / high: low has visibly blockier particles and no shadows; medium and high look
  almost the same at 1080p.

Problems seen in motion, most important first:
1. **Camera zoom on spin-up lurches.** Measured from the camera log: from rest to full rotate, the
   camera distance changes **35.6% within 0.25 s** (per-frame steps up to 2.9%). Late shift 8 at
   max spin: 32.6% in 0.25 s. The `ZOOM_OUT_RATE = 0.9` cap in `camera.js` allows 90% of the
   distance per second; that is the lurch. It is short, but it's a whole-screen scale change right
   when the player presses a key, which is the kind of motion that makes people queasy. Suggest a
   cap around 0.25–0.35/s plus the existing look-ahead, and accept a brief crop of the drum
   corners instead.
2. **Readability drops fast as the drum gets painted.** By mid shift 2 the back wall is mostly
   red; by shift 7 the wall, glass and pool are one red mass and the saws/crushers above the pool
   are hard to pick out. Donors stay visible, hazards don't. Hazard-stripe yellow is mostly on the
   frame, not on the hazards themselves. Suggest: cap back-wall paint coverage/opacity, or keep a
   bright yellow edge/emissive ring on every hazard, so the GDD's "hazard-stripe so they read
   instantly" survives late shifts.
3. **Wall "runners" read as hair/veins.** At high fill (shift 8 late, Overtime) the vertical drip
   runners form dense thin dark-red streaks over the whole back wall. In stills it looks like hair
   or veins rather than drips. Fewer, thicker runners would read as blood.
4. **Speech bubbles overlap** each other in crowds ("Is this normal?" twice on top of each other in
   shift 1; up to 4 overlapping in Overtime).
5. **Permanent pink/red screen-edge vignette** at all fills (visible in every footage frame). If
   that is the "fill escalation" edge, it starts too early; at 0% fill the game should look clean
   mint.
6. **HUD stays red in green-blood mode** (litres number, gauge). Probably intended ("red only for
   blood values"), but a streamer turning blood green may expect the red UI to follow.
7. Possible contradiction in shift 8 (unverified): the HUD shows "Inspector: incident" at the same
   moment as a "+20 L Compliance bonus" toast and the PA line "The Inspector has concluded his
   visit. Compliance noted." Could be two Inspectors with different fates; needs a check.
8. Shift 1 felt hard by hand (§3): blind keyboard play earned 2.7 L of the 6 L quota, 1/15
   donors. One data point from a non-player, not a balance verdict.

Not checked: 4K layout, a gamepad on real hardware, ultrawide on a real monitor, the shift-8
ending camera, and how the audio actually sounds (§3 proves it plays; nobody listened).

---

## 3. Desktop build on Windows (first ever run of the Windows build)

`cd desktop && npm ci && npm run build:release`:
- **Fails on Windows at the zip step**: `scripts/build.mjs` runs `execFileSync('zip', …)` and
  Windows has no `zip` (`spawnSync zip ENOENT`). `npm run build:release -- --no-zip` works: Windows
  folder 316 MB, Linux folder 274 MB. Bug in §6.
- `npm run verify`: **Windows build passes** every check (PE32+ x64, version info 0.1.0, exe icon =
  generated blood-drop icon at 16–256 px, `steam_api64.dll` win64). Linux build **fails 2 checks**
  (binary and `.sh` launcher not executable): NTFS can't store exec bits, so **the Linux depot
  must be built on Linux**.
- `npm run smoke`: Linux-only by design (xvfb), exits on Windows. I did the smoke test by hand
  instead:

| Check | Result |
|---|---|
| Starts fullscreen | Yes: 2560×1440 on the primary monitor, borderless, `edcDesktop.isFullscreen() = true`, log `shown fullscreen=true` |
| F11 / Alt+Enter | Both toggle (F11 → window, Alt+Enter → fullscreen) |
| Audio after first key press | Yes. No audio session before the key; after it, the game's session peaks 0.01–0.06 on the menu, 0.25 (−12 dBFS) during play, mean 0.15 (Windows CoreAudio meter, `tools/local/audio-peak.ps1`) |
| Full shift playable | Yes, shift 1 with real key presses to the Shift report (A/D, S, Space, Esc). Focus loss pauses the game as designed |
| Quit | Title → Quit → "Clock out and quit?" → Quit: process exits, none left. `edcDesktop.quit()` also exits cleanly |
| Progress survives relaunch | Yes: best shift-1 2.7 L, 1 shift played, 12 slams, 105 s on shift all still there |
| Single instance | Second launch logs "another instance is running; exiting" and focuses the first |
| GPU selection | Renders on the RX 9070 XT. First launch writes `HKCU\…\DirectX\UserGpuPreferences` = `GpuPreference=2` (high performance) for the exe path, as designed. Not a hybrid laptop, so the "wrong GPU on a laptop" case is untested |
| Exe icon | Correct blood-drop icon in Explorer (extracted from the exe and checked) |
| Code signing | Not signed (`Get-AuthenticodeSignature`: NotSigned) |
| SmartScreen | With a download mark on the exe (Zone 3), launching shows **"Open File – Security Warning: The publisher could not be verified… Publisher: Unknown Publisher"** before the game starts. Cancelled; mark removed. Steam installs carry no download mark, so Steam players should not see this; anyone getting the zip from a website will |

Smaller notes: Electron 45.3.1 ships Chrome 156; the app log keeps only one previous log
(`main.old.log`), so the first launch's log was overwritten by the second-instance message; the
save's `settings.fullscreen` is `false` while the game runs fullscreen (did not check whether the
Settings screen shows the wrong state).

---

## 4. Steam store assets — paused

Paused at the owner's request on 2026-11-13 ("hold off for Steam release stuff; I will review it
before it goes on Steam"). State at the pause:
- Pushed earlier in this pass: `steam/store-text.md` (draft short/long description, mature-content
  text, tags). Draft only, for review.
- Made locally, **not committed**: real-time 1080p screenshots (`tools/local/out/cap/`), five
  ~11 s trailer clips at a true 60 fps with game audio, no HUD (`tools/local/out/footage/`, 56 s
  total, made with `tools/local/capture-screen.mjs`), four gore-free "all ages" candidates.
- Not made: capsules (composer script exists, `tools/local/compose-capsules.mjs`, never run).
- Verified from the official Steamworks pages: header 920×430, small 462×174, main 1232×706,
  vertical 748×896, ≥ 5 screenshots at 1920×1080 min (≥ 4 marked all-ages), page background
  1438×810, library capsule 600×900, library header 920×430, library hero 3840×1240 (no text),
  library logo 1280 wide and/or 720 tall transparent PNG, shortcut icon 256×256, app icon 184×184
  .jpg, event cover 800×450; trailer up to 1920×1080, 30 or 60 fps, ≥ 5000 kbps, H.264 + AAC
  preferred. `docs/STEAM_RELEASE.md`'s list matches but misses the last five.
- One technical finding worth keeping: in-page `MediaRecorder` on the canvas only delivered
  ~34–38 fps with gaps on this machine; the screen grab (`ffmpeg ddagrab` + AMD hardware encoder)
  gives a clean 60 fps.

## 5. Title and brand check

Full write-up: `docs/local/title-check.md`. Short version:
- **DRAINWELL is a live registered US trademark** (serial 98280147, Total Drain Solutions LLC,
  drain-cleaning products, Class 3). The GDD's own locked rule says no real-world brands. Rename
  the fictional brand before any public material shows it; candidate names are in the write-up
  (not cleared).
- **"Every Drop Counts"**: no Steam game by that name; a free 2019 game-jam game of that name on
  itch.io; several live US registrations of the phrase, all for non-game goods (irrigation
  software in Class 9, bottled water, fuel distribution). Low legal risk, but a weak, unsearchable
  name (common water-saving slogan).

---

## 6. Bugs in files I must not edit (for the owners)

| # | Where | Bug | Evidence | Suggested fix |
|---|---|---|---|---|
| 1 | `src/render` (all materials) | Lazy shader compile stalls the first seconds of every shift: 0.6–0.8 s frame + 145–215 ms on first donor (RX 9070 XT), 1–8 s on a weak GPU | CPU profile: `getProgramInfoLog` via `getUniforms` on first render, 500 ms in 6 s | Precompile during the briefing (`compileAsync` with every material present) |
| 2 | `src/render/quality.js` | Governor slow (~52 s to playable), levels 1–2 useless when GPU-bound, preset change resets pixel ratio | `tools/local/out/governor-7-high.json` | Pixel ratio first when GPU-bound; keep pixel scale across presets; faster steps when far over budget; boot benchmark for `auto` |
| 3 | `src/render/camera.js` | Spin-up zoom changes distance 35.6% in 0.25 s | `tools/local/out/cap/spinup/camera.json` | Lower `ZOOM_OUT_RATE` (0.9 → ~0.3), accept brief corner crop |
| 4 | `src/render/blood` | Late-shift readability: hazards lost against painted walls; runners look like hair/veins | Footage clips 1, 4, 5 | Cap wall paint coverage; fewer, thicker runners; hazard highlight |
| 5 | `src/ui/bubbles.js` | Speech bubbles overlap in crowds | Shift 1 and Overtime frames | Simple collision push / skip when overlapping |
| 6 | `src/render/post.js` (probably) | Pink/red edge vignette visible at 0% fill | Every footage frame | Start the edge tint later in the fill curve |
| 7 | `desktop/scripts/build.mjs` | `build:release` crashes on Windows: no `zip` binary | `spawnSync zip ENOENT` | Use a Node zip (or `tar -a -c -f x.zip` on Windows), or default to `--no-zip` on win32 |
| 8 | `desktop/` release process | Linux build made on Windows loses exec bits (verify fails 2 checks) | `npm run verify` | Document: build the Linux depot on Linux/WSL only |
| 9 | `index.html` | No favicon: 404 `/favicon.ico` in browser builds (console error) | Every browser run | `<link rel="icon" href="data:,">` or a real icon |
| 10 | `src/ui` + sim (unverified) | Shift 8: "Inspector: incident" shown together with a compliance bonus and "concluded his visit" | `tools/local/out/cap/s8-late/shot-05.png` | Check the two-Inspector case |
| 11 | `src/ui` / desktop (unverified) | Save says `fullscreen: false` while the desktop build runs fullscreen | CDP read of `edc.save.v1` | Sync the setting from `edcDesktop.isFullscreen()` at boot |
| 12 | `desktop/src/main.js` | Only one old log kept; a second-instance launch overwrites the useful log | `%APPDATA%\EveryDropCounts\logs` | Don't rotate logs in the instance that exits immediately |

## 7. What I could not check

Real dual-GPU laptop (desktop machine); a mid-range laptop GPU (only a faster dGPU and a much
slower iGPU); gamepad on hardware; Steam overlay/achievements (no app id); Linux build execution;
the real SmartScreen "Windows protected your PC" screen from an Explorer double-click (only the
download warning from a scripted launch); listening to the audio.
