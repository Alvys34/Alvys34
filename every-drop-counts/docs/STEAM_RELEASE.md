# Releasing EVERY DROP COUNTS on Steam

A step-by-step guide for a first-time Steamworks developer. Build tooling lives in `desktop/`
(see `desktop/README.md`). Items marked **[verify]** are from memory of Valve's process and
change over time — check them against the current Steamworks documentation
(partner.steamgames.com/doc) before relying on them.

---

## 0. Timeline at a glance

| When | What |
|---|---|
| Day 0 | Create Steamworks account, sign agreements, pay the Steam Direct fee, bank + tax + identity |
| Day 0 + 30 | Earliest possible release: Valve enforces a **30-day wait after paying the app fee** |
| ≥ 2 weeks before launch | Store page must be **public as "Coming Soon" for at least 2 weeks** |
| Before Coming Soon | Store page review by Valve (typically **3–5 business days**, can be longer) |
| Before launch | Build review by Valve (also typically **3–5 business days**) |
| Launch day | You press **Release** yourself in Steamworks |

Practical advice: pay the fee and start onboarding **6–8 weeks** before the target date; submit
the store page as early as possible (it can show "Coming Soon" while the game is unfinished) and
the build at least ~2 weeks before launch so a failed review can be fixed and resubmitted.

## 1. Before Valve lets you sell anything

1. **Steamworks account**: partner.steamgames.com → "Join Steamworks" with a Steam account you
   control long-term (use Steam Guard). Enter your legal name / company and address.
2. **Agreements**: sign the Steam Distribution Agreement (and NDA) online.
3. **Steam Direct fee**: **US$100 per app**, non-refundable, recoupable — Valve pays it back once
   the game has made US$1,000 adjusted gross revenue on Steam.
4. **Bank information** for payouts.
5. **Tax interview** (built into Steamworks): US persons fill a W-9; non-US individuals a W-8BEN,
   non-US companies a W-8BEN-E (claims treaty benefits to reduce US withholding where your
   country has a treaty).
6. **Identity verification** (government ID, done through Valve's verification flow; can take a
   few days) **[verify current flow]**.
7. After the fee is paid you get an **App ID**. Valve also creates default packages (a store
   package and a "Developer Comp" package for your team).

## 2. App configuration (Steamworks → App Admin)

After every change in App Admin you must go to the **Publish** tab and publish, or nothing changes.

### 2.1 Depots (SteamPipe → Depots)

Create two depots (the first one, App ID + 1, may already exist):

| Depot | Operating system | Architecture | Language | Content |
|---|---|---|---|---|
| `<APPID+1>` "Every Drop Counts Windows" | Windows | 64-bit | all languages | `desktop/release/EveryDropCounts-win-x64/` |
| `<APPID+2>` "Every Drop Counts Linux" | Linux + SteamOS | 64-bit | all languages | `desktop/release/EveryDropCounts-linux-x64/` |

Then **add both depots to every package** that should grant the game (the store package and the
Developer Comp package): Steamworks → *All Associated Packages, DLC, Demos and Tools* → each
package → *Add depots*. Forgetting this is the classic "the game installs nothing" bug.

### 2.2 Installation → General

- **Install folder**: `Every Drop Counts`
- **Launch options** (one per OS):

| Executable | Arguments | Operating system | CPU arch |
|---|---|---|---|
| `EveryDropCounts.exe` | (none) | Windows | 64-bit |
| `EveryDropCounts.sh` | (none) | Linux + SteamOS | 64-bit |

The Linux launcher (`EveryDropCounts.sh`) starts the Electron binary with Chromium's sandbox when
the system supports unprivileged user namespaces and falls back to `--no-sandbox` otherwise (a
setuid `chrome-sandbox` is impossible in a Steam depot, and Steam's runtime containers / some
distros block user namespaces). Alternative: launch option `EveryDropCounts` with argument
`--no-sandbox`. The game content is local and fixed and all navigation/network is blocked, so
running without the OS sandbox is an accepted trade-off.

- **Redistributables (Windows)**: Steamworks → Installation → **Redistributables** → tick the
  **Visual C++ 2015–2022 (x64)** runtime **[verify exact label]**. Electron itself needs nothing,
  but the Steam native module (`steamworks.js`) imports `VCRUNTIME140.dll`. Without it the game
  still runs — it just silently starts without Steam (no achievements/overlay); `main.log` then says
  `steamworks.js failed to load`.
- **Steam Linux Runtime**: Steamworks can run native Linux games inside the Steam Linux Runtime
  container ("sniper"/3.0). This is **not tested** with this build — the launcher's fallback is
  designed for it, but test on a real Linux machine and on Steam Deck **[verify where this
  setting lives in App Admin]**.

### 2.3 App ID inside the game

- Put the App ID in `desktop/steam_appid.txt` (just the number) **before building**. It is baked
  into `resources/app.asar/build-info.json`. When the Steam client launches the game it also
  sets the `SteamAppId` environment variable, which takes precedence.
- Never ship a `steam_appid.txt` file in the depot (the depot scripts exclude it) and never
  build with `480`.
- Without an App ID, or without Steam running, the game runs normally; achievements are no-ops.

## 3. Uploading builds with SteamPipe (steamcmd)

### 3.1 Install steamcmd

- **Linux** (Debian/Ubuntu need 32-bit libs: `sudo apt install lib32gcc-s1`):
  ```bash
  mkdir -p ~/steamcmd && cd ~/steamcmd
  curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar zxvf -
  ./steamcmd.sh +quit            # first run self-updates
  ```
- **Windows**: download `https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip`, unzip to
  e.g. `C:\steamcmd`, run `steamcmd.exe +quit` once.
- The Steamworks SDK (download from Steamworks) also contains `tools/ContentBuilder` with steamcmd.

Use a **dedicated build account** (Steamworks → Users & Permissions → add a Steam account with
only "Edit App Metadata" + "Publish App Changes To Steam" for this app) and Steam Guard. The first
login asks for a Steam Guard code; credentials are then cached.

**Upload the Linux depot from Linux/macOS/WSL**, not from a Windows filesystem, so the executable
bits of `EveryDropCounts` and `EveryDropCounts.sh` are preserved **[verify]**.

### 3.2 Build and upload

```bash
cd every-drop-counts/desktop
npm ci                                  # once
npm run build:release                   # web build + Windows + Linux folders
npm run smoke                           # Linux smoke test (xvfb)
npm run verify                          # static checks of both builds
npm run steam:vdf -- --app <APPID> --win-depot <WIN_DEPOT> --linux-depot <LINUX_DEPOT> --branch beta
steamcmd +login <build_account> +run_app_build "$PWD/steam/generated/app_build.vdf" +quit
```

The templates are in `desktop/steam/` (`app_build.template.vdf`, `depot_build_windows.template.vdf`,
`depot_build_linux.template.vdf`) with `__APP_ID__`, `__WIN_DEPOT_ID__`, `__LINUX_DEPOT_ID__`
placeholders if you prefer editing by hand. `--preview` makes a dry run. `steam/output/` keeps
the upload cache/logs (ignored by git).

### 3.3 Setting a build live

- Steamworks → SteamPipe → **Builds**: every upload appears there. `SetLive` in the VDF can only
  target a **non-default branch** (e.g. `beta`); Valve does not allow setting the **default**
  branch live from steamcmd — select the build and "Set build live now" on `default` in the web UI.
- Create a password-protected `beta` branch for testers if useful.

## 4. Testing with the Steam client

1. Make sure your Steam account owns the game: the Developer Comp package is granted to team
   members (or request keys: Steamworks → *Request Steam Product Keys*, use "for testing").
2. Set the build live on a branch you can see (before release, the default branch is only
   visible to the team; or opt into `beta` in the game's Properties → Betas).
3. Install from the Steam library and test on **both** OSes: launch, fullscreen toggle (F11 /
   Alt+Enter), Quit button, save persistence across restarts, gamepad, achievements, Steam overlay
   (Shift+Tab).
4. Logs: `%APPDATA%\EveryDropCounts\logs\main.log` (Windows), `~/.config/EveryDropCounts/logs/main.log`
   (Linux). They state whether Steam initialised (`[steam] initialised, app id …`).
5. Local testing without uploading: `EDC_STEAM_APPID=480 ./EveryDropCounts.sh` (or set the env var
   on Windows) with the Steam client running uses Valve's public test app **Spacewar (480)**; its
   achievements include `ACH_WIN_ONE_GAME` (the placeholder page's "Unlock test achievement" button).
   Reset with the Steam console (`steam://open/console`): `reset_all_stats 480` **[verify]**.

**Steam overlay note**: when Steam initialises, the wrapper calls
`steamworks.electronEnableSteamOverlay()`, which runs Chromium with `--in-process-gpu` and
`--disable-direct-composition` and forces a repaint every frame. This is the documented
steamworks.js way to get the overlay in Electron, but it is **untested here**; if it causes
instability, set `EDC_STEAM_OVERLAY=0` in the launch options' environment
(`EDC_STEAM_OVERLAY=0 %command%`) and remove it in `desktop/src/main.js`.

## 5. Achievements

1. Steamworks → **Stats & Achievements → Achievements** → *New Achievement* for each entry below:
   API name (must match the game exactly), display name, description, hidden flag, and two icons
   (achieved / unachieved; 256×256 JPG/PNG recommended **[verify current size requirement]**).
2. **Publish** (App Admin → Publish).
3. In game: `window.edcDesktop.unlockAchievement('<API_NAME>')` → resolves `true` if Steam accepted
   it, `false` otherwise (no Steam, unknown name, stats not ready). The game should still record
   achievements in its local save and can re-send them on every launch (unlocking twice is harmless).

### 5.1 Achievement list

<!-- ACHIEVEMENTS: to be filled in by the gameplay/content agent. Keep API names in sync with the
     ids the game emits on the `achievement` bus event and passes to unlockAchievement(). -->

| API name | Display name | Description | Hidden |
|---|---|---|---|
| `FIRST_SHIFT` | Orientation Complete | Pass Shift 1. |  |
| `ALL_SHIFTS` | Staff Appreciated | Pass Shift 8: Staff Appreciation Day. |  |
| `PERFECT_RECORD` | Operator of Every Month | Earn 3 drops on all 8 shifts. |  |
| `OVERTIME_5_MIN` | Voluntary Overtime | Keep the tank from running dry for 5 minutes in Overtime. |  |
| `SPONSOR_MATCH_8` | Fully Matched | Reach a ×8 Sponsor Match. |  |
| `HEAD_ABOVE_WATER` | Head Above Water | Pass High Tide (Shift 3) without a single drowning. |  |
| `FULLY_COMPLIANT` | Fully Compliant | Earn 3 drops on a shift with every Inspector still alive. |  |
| `SINGLE_STROKE` | Single Stroke | Press 3 donors with one stroke of the crusher. |  |
| `PERCUSSIVE_MAINTENANCE` | Percussive Maintenance | Jam The Good Machine, then SLAM it clear. |  |
| `PRESSURE_EVENT` | Pressure Event | Set off an oxygen tank with another oxygen tank. |  |
| `SOME_ASSEMBLY_REQUIRED` | Some Assembly Required | Collect 30 partial donations in one shift. |  |
| `INCIDENT_REPORT` | Incident Report | An Inspector met an oxygen tank. | yes |
| `PRODUCT_NOT_RECOVERABLE` | Product Not Recoverable | Let 5 donors drown in one shift. | yes |
| `CONSCIENTIOUS_OBJECTOR` | Conscientious Objector | Finish a shift without processing a single donor. | yes |

Source of truth: `src/core/achievements.js` (`ACHIEVEMENTS`). The tracker there listens to the
sim's bus and emits `achievement { id }` once per unlock; the UI saves it and forwards the id to
`edcDesktop.unlockAchievement`. Create each entry in Steamworks with exactly these API names
(14 achievements; the hidden ones should be marked "Hidden" so their description stays secret).

## 6. Store page and content

### 6.1 Mature content survey (gore)

Steamworks → Store page admin → **Content Survey / Mature Content**. EVERY DROP COUNTS has
cartoonish but constant dismemberment and blood, so answer honestly:

- Tick **"Frequent Violence or Gore"** and describe it plainly, e.g. *"Stylised low-poly
  characters are cut, crushed and ground by machinery; exaggerated, cartoonish volumes of blood are
  the core mechanic. No realistic torture, no sexual content, all characters are adults."*
- Do **not** tick nudity/sexual content (there is none).
- Effects **[verify]**: the store shows a content notice/age gate, and players who filter
  "Frequent Violence or Gore" in their Steam content preferences won't see the game in
  browsing/search by default. Some countries restrict or ban gory games; Valve may ask for
  ratings (Steam supports entering existing ESRB/PEGI/USK etc. ratings; Germany has specific
  USK/age-verification rules). If unsure, ask Valve via the Steamworks support form.
- Mention the in-game **blood colour "green (streamer-safe)"** option in the description; it does
  not change the survey answers.

### 6.2 Store page checklist

Assets are produced in the repo's `steam/` folder (owned by the release/art side). Check every
size against Steamworks → Store page admin → Graphical Assets; at the time of writing **[verify]**:
header capsule 920×430, small capsule 462×174, main capsule 1232×706, vertical capsule 748×896,
≥ 5 screenshots (1920×1080), library capsule 600×900, library hero 3840×1240, library logo (PNG
with transparency), trailer recommended. Also: short + long description, tags, supported OS
(Windows, Linux/SteamOS), system requirements, controller support ("Full Controller Support" if
every screen is gamepad-navigable), languages (English), price, release date / "Coming Soon".

Submit the store page for review → after approval press **"Coming Soon"** → wait ≥ 2 weeks.

### 6.3 Build review

Steamworks → **Release** → the "Release Readiness" checklist shows what is missing. Mark the build
ready for review once the default branch has the launch build; Valve launches it on their
hardware. Typical rejection reasons: game fails to start, missing launch option for a listed OS,
store page claims (controller support, OS) that the build doesn't meet.

## 7. Steam Deck

- The Linux build runs natively on SteamOS through `EveryDropCounts.sh`; Valve may also test the
  Windows build through Proton — both should work, neither has been tested on hardware yet.
- Deck compatibility review criteria (Steamworks → Steam Deck Compatibility; you can request a
  review once the game has a build **[verify]**): full gamepad navigation incl. all menus, a
  default controller configuration (set Steam Input's default template to **Gamepad**), legible
  text at 1280×800 (Valve asks for ≥ 9 px at that resolution), 16:10 support (the GDD targets
  16:10–21:9), no launcher/anticheat issues, on-screen keyboard when text entry is needed (the game
  has none).
- The game starts fullscreen; F11/Alt+Enter are irrelevant on Deck. Suspend/resume: the page keeps
  running (no background throttling), so the game should pause on `visibilitychange`/`blur`.
- Performance: test the "Low" quality preset at 1280×800, 60 Hz and 40 Hz.

## 8. Cloud saves (optional, not set up)

Saves are Chromium localStorage (LevelDB) in the profile directory. If Steam Cloud is wanted,
Steamworks → Steam Cloud → **Auto-Cloud**: root `WinAppDataRoaming`, subdirectory
`EveryDropCounts/Local Storage/leveldb`, pattern `*`, recursive; and the Linux equivalent
(`LinuxXdgConfigHome`, same subdirectory) with a root override **[verify root names]**. LevelDB is
a multi-file database: syncing it is only safe because the game flushes and exits cleanly; test
carefully (two machines, conflicts) or leave Cloud off for 1.0.

## 9. Pre-launch checklist

- [ ] Steamworks onboarding complete (agreements, fee paid ≥ 30 days ago, bank, tax, identity).
- [ ] `desktop/steam_appid.txt` holds the real App ID (not 480); company name set via
      `EDC_COMPANY_NAME`; version bumped in the web game's `package.json`.
- [ ] `npm run build:release` from a clean checkout; `npm run smoke` passes; `npm run verify` passes
      (it fails on placeholder builds on purpose).
- [ ] Windows build launched on a **real Windows 10/11 x64 PC** (never executed by the build
      machine): starts fullscreen, F11/Alt+Enter, Quit, save survives restart, gamepad, dual-GPU
      laptop uses the discrete GPU, icon/metadata look right in Explorer and the taskbar,
      SmartScreen behaviour acceptable (the exe is **not code-signed**).
- [ ] Linux build launched on a real desktop (X11 and Wayland) and on Steam Deck.
- [ ] Achievements created + published, API names match, unlock tested via Steam.
- [ ] Steam overlay works (Shift+Tab) on both OSes, or `EDC_STEAM_OVERLAY=0` decided.
- [ ] Depots in all packages; launch options for Windows and Linux; Publish done.
- [ ] Store page approved, "Coming Soon" live ≥ 2 weeks, mature content survey answered.
- [ ] Build approved by Valve; launch build set live on `default`.
- [ ] Third-party licences shipped (Electron `LICENSE` + `LICENSES.chromium.html` are in both
      builds; the game's credits screen lists three.js, Rapier, fonts, steamworks.js (MIT)).
- [ ] Release button pressed. Watch the Steam forums / reviews and `main.log` reports.
