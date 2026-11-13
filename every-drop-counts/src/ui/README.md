# src/ui — BASELINE (temporary, replace freely)

`createUI({ root, bus })` → `{ showGate(onStart), update(snapshot, realDt), showResults(result, {onRetry, onNext, hasNext}),
hideResults(), setPaused(bool, {onResume, onRestart}), dispose() }` — wired in `src/main.js`.
It is a bare HUD + "press any key" gate (the gate is the audio-unlock gesture — keep one) + a
results card + a pause card. No menus, settings or shift select yet.

## Data a real UI needs

Per frame, `sim.snapshot()` (plain JSON) gives: `liters`, `collected`, `bonus`, `fines`,
`quota [q1,q2,q3]`, `clock { t, left, duration }` (`left` null in Overtime), `donorsLeft`,
`alive`, `kills`, `drownings`, `combo { count, multiplier, best }`, `fill`,
`slam { cooldown, ready }` (cooldown total: `TUNABLES.slam.cooldown`), `status`, `result`.
Live objects (for world-anchored widgets such as speech bubbles): `sim.state.donors[i]`
(`speech { text, t }`, `parts.head` drum-local pose) + `view.ctx.camera` and
`view.ctx.drumGroup.localToWorld()` to project.

Bus events to present:

| Event | UI |
|---|---|
| `shift:start { levelId, mode, name, number }` | level banner, reset widgets |
| `wave:incoming { count }` / `hatch:open` | "incoming donors" cue |
| `combo { count, multiplier }` | SPONSOR MATCH ×n popup |
| `bonus { liters, reason }` / `fine { liters, reason }` | +/− litre popups (`sponsor-match`, `early-finish`, …) |
| `pa:announce { text, mood }` | PA ticker (`calm` / `urgent` / `glitch`) |
| `donor:speak { id, text, pos }` | speech bubble over that donor's head |
| `timer:warning { secondsLeft }` | clock urgency |
| `slam` / `slam:ready` | cooldown widget |
| `shift:end { result, liters, stars, collected, bonus, fines, kills, drownings, bestCombo, time, donorsTotal, causes }` | shift report (main shows it ~1.8 s later) |

UI should emit `ui:hover`, `ui:click`, `ui:back`, `ui:star { n }` (results drop n of 3) for audio.
Progress/settings: `src/core/save.js` (`getSave()`, `updateSave(fn)`, `recordShiftResult`,
`recordOvertime`); levels: `listLevels()` / `nextLevel()` in `src/sim/levels/index.js`.
Menu navigation: `input.onPress(fn(action))` with `up/down/left/right/confirm/back/pause/slam/restart`
(keyboard + gamepad). Desktop: `window.edcDesktop` when running in Electron (quit/fullscreen).
