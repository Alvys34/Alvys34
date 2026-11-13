# EVERY DROP COUNTS — desktop wrapper (Electron)

Wraps the static web build (`../dist`, Vite, `base: './'`) into Windows x64 and Linux x64 game
folders for Steam depots. This folder is its own npm package; it never touches the web game's
`package.json` or `src/`.

Release/Steamworks steps for humans: [`../docs/STEAM_RELEASE.md`](../docs/STEAM_RELEASE.md).

## Quick start

```bash
cd desktop
npm install                 # also downloads the Electron binary for `npm start` (postinstall)
npm start                   # dev run: ../dist if it exists, else placeholder/ ; devtools on F12
npm run start:placeholder   # dev run of the placeholder page explicitly
```

Dev-only switches (`npm start -- <flag>` or env):

| Flag / env | Effect |
|---|---|
| `--dev` / `EDC_DEV=1` | DevTools (F12, Ctrl+Shift+I), reload (F5, Ctrl+R). Implied by `npm start`. Also works on a packaged build. |
| `--game-dir=<dir>` / `EDC_GAME_DIR` | serve another folder (dev runs only) |
| `--debug` | load `index.html?debug=1` (the game's `window.__edc` harness) |
| `--query=<qs>` / `EDC_QUERY` | arbitrary query string for `index.html` |
| `EDC_USER_DATA_DIR=<dir>` | throw-away profile (saves, window state, logs) |
| `EDC_STEAM_APPID=480` | try Steam with Spacewar (needs the Steam client running); `=0` forces Steam off |
| `EDC_STEAM_OVERLAY=0` | do not enable the Steam overlay hook |
| `EDC_NO_GPU_PREF=1` | Windows: do not write the "high-performance GPU" preference |
| `EDC_NO_SANDBOX=1` / `EDC_FORCE_SANDBOX=1` | Linux launcher (`EveryDropCounts.sh`) sandbox override |

As **root** (containers/CI), Chromium refuses to start without `--no-sandbox`; the Linux launcher
adds it automatically, for `npm start` pass it yourself: `npm start -- --no-sandbox`.

## Building

```bash
# once the web game builds:
npm run build:release        # = npm run build in the parent, then Windows + Linux
npm run build:all            # Windows + Linux from an existing ../dist
npm run build:linux          # one platform
npm run build:win            # cross-built from Linux, no wine needed
npm run build:placeholder    # wrapper-only test build of placeholder/ (NOT shippable)
```

Output (`desktop/release/`):

```
EveryDropCounts-win-x64/EveryDropCounts.exe   (+ resources/app.asar, Chromium runtime files)
EveryDropCounts-win-x64.zip
EveryDropCounts-linux-x64/EveryDropCounts     (Electron binary)
EveryDropCounts-linux-x64/EveryDropCounts.sh  (Steam launch target; handles the Chromium sandbox)
EveryDropCounts-linux-x64.zip
build-summary.json
```

What the build does (`scripts/build.mjs`):

1. Takes `../dist` (fails with a clear message if missing; `--placeholder` is an explicit opt-in;
   `--web-build` runs the parent's `npm run build` first). Rejects absolute `/assets/...` URLs
   (means `base: './'` is missing). Source maps are dropped (`--keep-sourcemaps` to keep).
2. Version = the web game's `package.json` version (override `--version 1.2.3`).
3. Generates the icon procedurally (`scripts/make-icon.mjs` → `resources/icons/`: `icon.ico`
   16–256 px, PNGs 16–512 px). No downloaded art.
4. Stages `src/`, the game under `game/`, `build-info.json` and only that platform's
   `steamworks.js` native binaries; packages with `@electron/packager` (asar on, native Steam
   files unpacked to `app.asar.unpacked/`). Windows exe icon + version info are written with the
   pure-JS `resedit` (inside packager) — **no wine/rcedit**.
5. Prunes Chromium locales to `en-US` (about −7 MB), flips Electron fuses (no `ELECTRON_RUN_AS_NODE`,
   no `NODE_OPTIONS`, no `--inspect`, app only from asar), writes the Linux launcher, zips.
6. Zips each folder with a pure-Node zip (`yazl`, no `zip` binary: works on Windows). Unix modes
   and symlinks are stored; in the Linux zip the binary, the `.sh` launcher, `chrome-sandbox` and
   `chrome_crashpad_handler` are always stored executable (0755). `--no-zip` skips this step.

**Build the Linux depot on Linux or WSL (inside the Linux file system, e.g. `~/`), never on an NTFS
drive.** NTFS cannot store exec bits: a Linux folder built on Windows has a non-executable binary
and launcher, and `npm run verify` fails two checks for it. The Linux *zip* is fixed up either way,
but Steam uploads the *folder*. The Windows build can be made on either OS.

Company name in the exe metadata: `EDC_COMPANY_NAME="Your Studio" npm run build:all`
(defaults to "Every Drop Counts").

Steam app id: put the number in `desktop/steam_appid.txt` before building; it is baked into
`build-info.json` (the file itself is never shipped). Don't bake 480.

## Testing

```bash
npm run smoke      # Linux, needs xvfb-run: launches the packaged Linux build twice, exit code != 0 on failure
npm run verify     # static checks of both builds (PE/ELF headers, exe icon + version info, asar
                   # contents, native Steam binaries, fuses); add --allow-placeholder for placeholder builds
```

`npm run smoke` runs `release/EveryDropCounts-linux-x64/EveryDropCounts.sh` under
`xvfb-run` with SwiftShader WebGL and a temporary profile, and checks: window visible, page served
from `app://game`, the bridge exposes exactly the contract, `isFullscreen/setFullscreen/
unlockAchievement` resolve booleans, no Node globals, WebGL/WebAudio/Gamepad API present, remote
fetch / `window.open` / external navigation blocked, F11 and Alt+Enter toggle fullscreen,
localStorage survives a relaunch, first launch is fullscreen and a windowed choice is remembered, non-blank screenshot, no page console
errors, and quitting via `edcDesktop.quit()` exits 0. For a real-game build it loads
`index.html?debug=1&quality=low` and also requires `window.__edc.ready` to resolve and `__edc.errors` to be empty,
then plays the game with OS-level key events (`runGameFlow` in `src/main.js`): boot splash → title (audio
unlocks from that press) → Clock in → briefing → shift with D/A/Space → Esc pause/resume → fullscreen
on/off through the game's settings path → an achievement persisted → (first launch) the shift fast-forwarded
to its report so a result is saved → back to the title → Quit → Yes (the game's own quit button path).
The second launch checks the save (best result, achievement, stats) survived.
Artifacts: `release/smoke/run{1,2}/{report.json,screenshot.png,x11-root.png,stdout.log}`.
Options: `--direct` (skip the launcher), `--wait <ms>`, `--query <qs>`, `--allow-console-errors`.

The smoke mode lives in `src/main.js` and is inert unless `EDC_SMOKE_DIR` is set.

## Runtime design (src/)

- `main.js` — single window; serves the game from the private origin **`app://game/`** via
  `protocol.handle` (files read from `app.asar`, path traversal rejected, CSP + COOP/COEP headers
  so the page is `crossOriginIsolated`). **localStorage is keyed by this origin — never change
  `SCHEME`/`HOST` after release or players lose their saves.** Profile dir:
  `%APPDATA%\EveryDropCounts` / `~/.config/EveryDropCounts` (logs in `logs/main.log`).
- Window: starts fullscreen (borderless) on first launch, remembers fullscreen/windowed size in
  `window-state.json`, no menu, F11 and Alt+Enter toggle fullscreen, single instance, shown on
  `ready-to-show`, dark `backgroundColor`, `backgroundThrottling: false`.
- Security: `contextIsolation`, `sandbox`, no `nodeIntegration`, devtools off unless `--dev`;
  navigation, redirects, `window.open`, `<webview>`, downloads blocked; every http/https/ws
  request cancelled; permissions denied except `fullscreen` and `pointerLock` (the Gamepad API is
  not permission-gated in Chromium). CSP: `script-src 'self' 'wasm-unsafe-eval'` (Rapier WASM),
  styles allow inline, data:/blob: for images/fonts/media.
- Crashes: renderer crash → "Reload / Quit" dialog; hang → "Wait / Reload / Quit" dialog that
  closes itself if the page recovers; missing game files → "verify integrity" dialog.
- GPU: `ignore-gpu-blocklist`, GPU rasterization, SwiftShader allowed as last resort; on Windows
  the exe is registered once as "High performance" in `HKCU\Software\Microsoft\DirectX\
  UserGpuPreferences` (only if the user has no setting; opt out `EDC_NO_GPU_PREF=1`). The game
  should still request `powerPreference: 'high-performance'` on its WebGL context.
- `preload.js` — exposes exactly `window.edcDesktop` (`isDesktop`, `platform`, `version`,
  `quit()`, `setFullscreen(bool)` → `Promise<boolean>`, `isFullscreen()` → `Promise<boolean>`,
  `unlockAchievement(id)` → `Promise<boolean>`). `quit()` flushes localStorage before exiting.
- `steam.js` — optional `steamworks.js`; app id from `EDC_STEAM_APPID`, `SteamAppId` (set by the
  Steam client), `steam_appid.txt` next to the exe / in cwd, or the baked id. Any failure ⇒ Steam
  off, `unlockAchievement` resolves `false`. Overlay hook enabled only after a successful init.

## Files

```
src/main.js, src/preload.js, src/steam.js   runtime
placeholder/                                 test page (WebGL, WebAudio, localStorage, gamepad, bridge)
scripts/build.mjs, make-icon.mjs, smoke.mjs, verify.mjs, steam-vdf.mjs
resources/icons/                             generated icons (regenerated on every build)
steam/*.template.vdf                         SteamPipe app/depot build templates
```
