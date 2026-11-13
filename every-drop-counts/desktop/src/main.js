'use strict';
// EVERY DROP COUNTS - Electron main process.
// One game window, fully offline: the web build is served from a private `app://game/` origin
// (inside app.asar), no remote content can ever load, and the page only sees `window.edcDesktop`.

const { app, BrowserWindow, ipcMain, protocol, session, dialog, Menu, screen, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const steam = require('./steam');

// ------------------------------------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------------------------------------
const PRODUCT_NAME = 'Every Drop Counts';
const USER_DATA_DIR_NAME = 'EveryDropCounts';
// The page origin. localStorage (the save game) is keyed by it: NEVER change scheme or host
// after release or every player loses their save.
const SCHEME = 'app';
const HOST = 'game';
const ORIGIN = `${SCHEME}://${HOST}`;
const BG_COLOR = '#101214';
const MIN_W = 960;
const MIN_H = 540;

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  // Cross-origin isolation: enables SharedArrayBuffer + precise timers for the game; everything is
  // same-origin so nothing breaks.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
};

const argv = process.argv.slice(1);
const argValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const IS_DEV = !app.isPackaged || argv.includes('--dev') || process.env.EDC_DEV === '1';
const SMOKE_DIR = process.env.EDC_SMOKE_DIR || null;

// ------------------------------------------------------------------------------------------------
// userData (must happen before the single-instance lock and before 'ready')
// ------------------------------------------------------------------------------------------------
app.setName(PRODUCT_NAME);
const defaultUserData = path.join(app.getPath('appData'), USER_DATA_DIR_NAME);
const userDataOverride = process.env.EDC_USER_DATA_DIR || argValue('user-data-dir');
app.setPath('userData', userDataOverride ? path.resolve(userDataOverride) : defaultUserData);
const USER_DATA = app.getPath('userData');
try { fs.mkdirSync(USER_DATA, { recursive: true }); } catch { /* reported by log() fallback */ }

// ------------------------------------------------------------------------------------------------
// Logging: userData/logs/main.log (previous run kept as main.old.log)
// ------------------------------------------------------------------------------------------------
const LOG_DIR = path.join(USER_DATA, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'main.log');
let logFd = null;
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (fs.existsSync(LOG_FILE)) fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'main.old.log'));
  logFd = fs.openSync(LOG_FILE, 'a');
} catch { logFd = null; }
let logBytes = 0;
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (typeof p === 'string' ? p : safeJson(p))).join(' ')}`;
  try { console.log(line); } catch { /* stdout may be closed */ }
  if (logFd !== null && logBytes < 2 * 1024 * 1024) {
    try { const b = Buffer.from(line + '\n'); fs.writeSync(logFd, b); logBytes += b.length; } catch { /* ignore */ }
  }
}
function safeJson(v) { try { return JSON.stringify(v); } catch { return String(v); } }

process.on('uncaughtException', (e) => log('[main] uncaughtException', e && e.stack ? e.stack : String(e)));
process.on('unhandledRejection', (e) => log('[main] unhandledRejection', e && e.stack ? e.stack : String(e)));

// ------------------------------------------------------------------------------------------------
// Build info + game location
// ------------------------------------------------------------------------------------------------
const APP_PATH = app.getAppPath();
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
const BUILD_INFO = readJson(path.join(APP_PATH, 'build-info.json'), {});

function resolveGameRoot() {
  const candidates = [];
  const explicit = process.env.EDC_GAME_DIR || argValue('game-dir');
  if (explicit && IS_DEV) candidates.push(path.resolve(explicit));
  candidates.push(path.join(APP_PATH, 'game'));                       // packaged (inside app.asar)
  if (!app.isPackaged) {
    candidates.push(path.resolve(APP_PATH, '..', 'dist'));            // dev: real web build
    candidates.push(path.join(APP_PATH, 'placeholder'));              // dev: placeholder page
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}
const GAME_ROOT = resolveGameRoot();

// ------------------------------------------------------------------------------------------------
// Single instance
// ------------------------------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  log('[main] another instance is running; exiting');
  app.exit(0);
  return; // eslint-disable-line no-useless-return -- CommonJS top-level return is valid in Electron main
}

log(`[main] ${PRODUCT_NAME} ${app.getVersion()} electron ${process.versions.electron} chrome ${process.versions.chrome} ` +
  `${process.platform}-${process.arch} packaged=${app.isPackaged} dev=${IS_DEV} smoke=${!!SMOKE_DIR} ` +
  `sandbox=${!app.commandLine.hasSwitch('no-sandbox')}`);
log(`[main] userData=${USER_DATA} game=${GAME_ROOT || '(missing)'}`);

// ------------------------------------------------------------------------------------------------
// Steam (optional; must run before 'ready' for the overlay switches)
// ------------------------------------------------------------------------------------------------
const STEAM = steam.initSteam({
  log,
  bakedAppId: BUILD_INFO.steamAppId,
  exeDir: path.dirname(process.execPath),
  enableOverlay: process.env.EDC_STEAM_OVERLAY !== '0',
});

// ------------------------------------------------------------------------------------------------
// Chromium switches for a WebGL game
// ------------------------------------------------------------------------------------------------
app.commandLine.appendSwitch('ignore-gpu-blocklist');            // never fall back to "WebGL blocked"
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('force_high_performance_gpu');      // dual-GPU (honoured on macOS)
app.commandLine.appendSwitch('enable-unsafe-swiftshader');       // last-resort software WebGL (content is trusted & local)
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-http-cache');              // nothing remote, nothing to cache
if (!IS_DEV) app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

// Dual-GPU Windows laptops: ask Windows to run us on the high-performance GPU (same thing the user
// would set in Settings > System > Display > Graphics). Only written once and never overrides a
// value the user already chose. Opt out with EDC_NO_GPU_PREF=1.
function preferHighPerformanceGpuOnWindows(state) {
  if (process.platform !== 'win32' || process.env.EDC_NO_GPU_PREF === '1' || !app.isPackaged) return;
  if (state.gpuPrefFor === process.execPath) return;
  try {
    const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
    const opts = { windowsHide: true, timeout: 4000, stdio: 'ignore' };
    const q = spawnSync('reg.exe', ['query', key, '/v', process.execPath], opts);
    if (q.status !== 0) {
      const a = spawnSync('reg.exe', ['add', key, '/v', process.execPath, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], opts);
      log(`[gpu] UserGpuPreferences high-performance: ${a.status === 0 ? 'set' : 'failed'}`);
    } else {
      log('[gpu] UserGpuPreferences already present for this exe; leaving it alone');
    }
    state.gpuPrefFor = process.execPath;
    saveWindowState(state);
  } catch (e) {
    log('[gpu] could not set GPU preference', String(e));
  }
}

// ------------------------------------------------------------------------------------------------
// Custom protocol (must be registered before 'ready')
// ------------------------------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

function registerGameProtocol(ses) {
  const root = GAME_ROOT ? path.resolve(GAME_ROOT) : null;
  ses.protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== HOST || !root) return new Response('Not found', { status: 404 });
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
      if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      const data = await fs.promises.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(request.method === 'HEAD' ? null : data, {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Length': String(data.length), 'Cache-Control': 'no-cache', ...SECURITY_HEADERS },
      });
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'EISDIR' || e.code === 'ENOTDIR')) {
        log(`[protocol] 404 ${request.url}`);
        return new Response('Not found', { status: 404 });
      }
      log(`[protocol] 500 ${request.url} ${e && e.message}`);
      return new Response('Internal error', { status: 500 });
    }
  });
}

// ------------------------------------------------------------------------------------------------
// Window state persistence
// ------------------------------------------------------------------------------------------------
const STATE_FILE = path.join(USER_DATA, 'window-state.json');
function loadWindowState() {
  const s = readJson(STATE_FILE, {});
  return {
    fullscreen: typeof s.fullscreen === 'boolean' ? s.fullscreen : true,   // first launch: fullscreen
    width: Number.isFinite(s.width) ? Math.max(MIN_W, s.width) : 1600,
    height: Number.isFinite(s.height) ? Math.max(MIN_H, s.height) : 900,
    x: Number.isFinite(s.x) ? s.x : undefined,
    y: Number.isFinite(s.y) ? s.y : undefined,
    maximized: !!s.maximized,
    gpuPrefFor: typeof s.gpuPrefFor === 'string' ? s.gpuPrefFor : undefined,
  };
}
function saveWindowState(state) {
  try {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    log('[state] save failed', String(e));
  }
}
function fitToDisplays(state) {
  // Keep a remembered windowed rectangle only if it is still visible on a connected display.
  try {
    const wa = (state.x !== undefined && state.y !== undefined)
      ? screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height }).workArea
      : screen.getPrimaryDisplay().workArea;
    state.width = Math.min(state.width, wa.width);
    state.height = Math.min(state.height, wa.height);
    const visible = state.x !== undefined && state.y !== undefined &&
      state.x + 64 <= wa.x + wa.width && state.y + 64 <= wa.y + wa.height &&
      state.x + state.width - 64 >= wa.x && state.y >= wa.y - 8;
    if (!visible) {
      state.x = Math.round(wa.x + (wa.width - state.width) / 2);
      state.y = Math.round(wa.y + (wa.height - state.height) / 2);
    }
  } catch { state.x = undefined; state.y = undefined; }
  return state;
}

// ------------------------------------------------------------------------------------------------
// Security: deny everything the game does not need
// ------------------------------------------------------------------------------------------------
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'pointerLock']);
function isGameUrl(u) {
  return typeof u === 'string' && (u === ORIGIN || u.startsWith(ORIGIN + '/'));
}

function hardenSession(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = ALLOWED_PERMISSIONS.has(permission) && isGameUrl(details && details.requestingUrl ? details.requestingUrl : wc.getURL());
    if (!ok) log(`[security] denied permission request: ${permission}`);
    callback(ok);
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => ALLOWED_PERMISSIONS.has(permission) && isGameUrl(requestingOrigin));
  ses.setDevicePermissionHandler(() => false);              // WebHID / WebUSB / Web Serial
  if (typeof ses.setDisplayMediaRequestHandler === 'function') ses.setDisplayMediaRequestHandler((req, cb) => cb({}));
  ses.on('will-download', (e) => { e.preventDefault(); log('[security] blocked download'); });
  // Defence in depth: no request may leave the machine.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (details, cb) => {
    log(`[security] blocked network request: ${details.url}`);
    cb({ cancel: true });
  });
  ses.setSpellCheckerEnabled(false);
}

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => { log(`[security] blocked window.open ${url}`); return { action: 'deny' }; });
  contents.on('will-navigate', (e, legacyUrl) => {
    const url = e.url || legacyUrl;
    if (!isGameUrl(url)) { e.preventDefault(); log(`[security] blocked navigation to ${url}`); }
  });
  contents.on('will-redirect', (e, legacyUrl) => {
    const url = e.url || legacyUrl;
    if (!isGameUrl(url)) { e.preventDefault(); log(`[security] blocked redirect to ${url}`); }
  });
  contents.on('will-attach-webview', (e) => { e.preventDefault(); log('[security] blocked <webview>'); });
  contents.on('will-frame-navigate', (e) => {
    if (!isGameUrl(e.url) && !String(e.url).startsWith('about:') && !String(e.url).startsWith('data:') && !String(e.url).startsWith('blob:')) {
      e.preventDefault();
      log(`[security] blocked frame navigation to ${e.url}`);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// Main window
// ------------------------------------------------------------------------------------------------
/** @type {BrowserWindow | null} */
let win = null;
let windowState = null;
let quitVia = null;
let crashTimes = [];

function gameUrl() {
  const q = process.env.EDC_QUERY || argValue('query') || (argv.includes('--debug') ? 'debug=1' : '');
  return `${ORIGIN}/index.html${q ? '?' + q.replace(/^\?/, '') : ''}`;
}

function iconPath() {
  const p = path.join(APP_PATH, 'resources', 'icons', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

function createWindow() {
  windowState = fitToDisplays(loadWindowState());
  const icon = iconPath();
  win = new BrowserWindow({
    title: PRODUCT_NAME,
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: MIN_W,
    minHeight: MIN_H,
    useContentSize: true,
    show: false,
    fullscreen: windowState.fullscreen,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: BG_COLOR,
    icon: icon && process.platform !== 'darwin' ? nativeImage.createFromPath(icon) : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: IS_DEV,
      autoplayPolicy: 'no-user-gesture-required',
      safeDialogs: true,
    },
  });
  win.removeMenu();
  if (windowState.maximized && !windowState.fullscreen) win.maximize();

  let shown = false;
  const showNow = (why) => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    win.show();
    if (windowState.fullscreen && !win.isFullScreen()) win.setFullScreen(true);
    win.focus();
    log(`[window] shown (${why}) fullscreen=${win.isFullScreen()}`);
  };
  win.once('ready-to-show', () => showNow('ready-to-show'));
  setTimeout(() => showNow('timeout'), 8000);                   // never stay invisible forever

  // --- state persistence
  let saveTimer = null;
  const persist = () => {
    if (!win || win.isDestroyed()) return;
    const fs_ = win.isFullScreen();
    windowState.fullscreen = fs_;
    if (!fs_) {
      windowState.maximized = win.isMaximized();
      if (!windowState.maximized && !win.isMinimized()) {
        const b = win.getContentBounds();
        Object.assign(windowState, { x: b.x, y: b.y, width: b.width, height: b.height });
      }
    }
    saveWindowState(windowState);
  };
  const persistSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); };
  win.on('resize', persistSoon);
  win.on('move', persistSoon);
  win.on('maximize', persistSoon);
  win.on('unmaximize', persistSoon);
  win.on('enter-full-screen', persist);
  win.on('leave-full-screen', persistSoon);  // Linux reports the restored bounds a tick later
  win.on('close', () => { clearTimeout(saveTimer); persist(); flushStorage('window-close'); });
  win.on('closed', () => { win = null; });

  // --- keyboard: F11 / Alt+Enter fullscreen, dev tools only in dev
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key;
    const toggleFs = key === 'F11' || (key === 'Enter' && input.alt && !input.control && !input.meta);
    if (toggleFs) {
      event.preventDefault();
      if (!input.isAutoRepeat) setFullscreen(!win.isFullScreen());
      return;
    }
    if (IS_DEV) {
      if (key === 'F12' || (input.control && input.shift && (key === 'I' || key === 'i'))) { event.preventDefault(); win.webContents.toggleDevTools(); }
      else if (key === 'F5' || (input.control && (key === 'r' || key === 'R'))) { event.preventDefault(); win.webContents.reload(); }
    }
  });
  win.webContents.on('zoom-changed', () => win && win.webContents.setZoomFactor(1));
  win.webContents.on('did-finish-load', () => { if (win) win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {}); });

  // --- crash / hang handling: offer reload instead of a dead window
  win.webContents.on('render-process-gone', (_e, details) => {
    log('[window] render-process-gone', details);
    if (details.reason === 'clean-exit' || !win || win.isDestroyed()) return;
    if (SMOKE_DIR) { smokeFail(`renderer gone: ${details.reason}`); return; }
    const now = Date.now();
    crashTimes = crashTimes.filter((t) => now - t < 60000).concat(now);
    offerReload(
      'The game stopped unexpectedly.',
      `Reason: ${details.reason} (exit code ${details.exitCode}).\n` +
      (crashTimes.length >= 3 ? 'This keeps happening - updating your graphics driver or verifying the game files in Steam may help.\n' : '') +
      'Your progress up to the last save is safe.',
    );
  });
  let hangAbort = null;
  win.on('unresponsive', async () => {
    log('[window] unresponsive');
    if (SMOKE_DIR || hangAbort || !win) return;
    hangAbort = new AbortController();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', title: PRODUCT_NAME, message: 'The game is not responding.',
      detail: 'You can wait for it, reload it, or quit.', buttons: ['Wait', 'Reload', 'Quit'],
      defaultId: 0, cancelId: 0, noLink: true, signal: hangAbort.signal,
    }).catch(() => ({ response: 0 }));
    hangAbort = null;
    if (response === 1 && win) {
      win.webContents.forcefullyCrashRenderer();
      win.webContents.reload();
    }
    if (response === 2) quitGame('hang-dialog');
  });
  win.on('responsive', () => {
    log('[window] responsive again');
    if (hangAbort) hangAbort.abort();
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;   // -3 = aborted (e.g. a reload)
    log(`[window] did-fail-load ${code} ${desc} ${url}`);
    if (SMOKE_DIR) { smokeFail(`load failed: ${code} ${desc}`); return; }
    dialog.showMessageBoxSync({
      type: 'error', title: PRODUCT_NAME, message: 'The game data could not be loaded.',
      detail: `${desc} (${code})\n\nIn Steam: right-click the game > Properties > Installed Files > Verify integrity of game files.`,
      buttons: ['Quit'], noLink: true,
    });
    quitGame('load-failed');
  });
  win.webContents.on('preload-error', (_e, p, err) => log(`[window] preload error ${p}`, String(err && err.stack)));
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning' || IS_DEV || SMOKE_DIR) {
      log(`[page:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
    // The network probe below (and the placeholder) deliberately trigger a CSP refusal for this host.
    if (SMOKE_DIR && details.level === 'error' && !String(details.message).includes('edc-network-probe.invalid')) smokeState.consoleErrors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });

  if (!GAME_ROOT) {
    const msg = 'Game files are missing (index.html not found).';
    log(`[main] ${msg}`);
    if (SMOKE_DIR) { smokeFail(msg); return; }
    dialog.showMessageBoxSync({ type: 'error', title: PRODUCT_NAME, message: msg, detail: 'Verify the integrity of the game files in Steam.', buttons: ['Quit'] });
    quitGame('missing-game');
    return;
  }
  win.loadURL(gameUrl()).catch((e) => log('[window] loadURL rejected', String(e)));
  if (SMOKE_DIR) win.webContents.once('did-finish-load', () => runSmoke().catch((e) => smokeFail(String(e && e.stack))));
}

async function offerReload(message, detail) {
  if (!win || win.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'error', title: PRODUCT_NAME, message, detail, buttons: ['Reload', 'Quit'], defaultId: 0, cancelId: 1, noLink: true,
  }).catch(() => ({ response: 1 }));
  if (response === 0 && win && !win.isDestroyed()) win.webContents.reload();
  else quitGame('crash-dialog');
}

function setFullscreen(on) {
  if (!win || win.isDestroyed()) return false;
  win.setFullScreen(!!on);
  return !!on;
}

function flushStorage(why) {
  try {
    session.defaultSession.flushStorageData();
    log(`[storage] flushed (${why})`);
  } catch (e) {
    log('[storage] flush failed', String(e));
  }
}

function quitGame(via) {
  if (!quitVia) quitVia = via;
  flushStorage(`quit:${via}`);
  app.quit();
}

// ------------------------------------------------------------------------------------------------
// IPC: the bridge (only the game page may call it)
// ------------------------------------------------------------------------------------------------
function trusted(event) {
  const frame = event.senderFrame;
  return !!(win && !win.isDestroyed() && event.sender === win.webContents && frame && frame.parent === null && isGameUrl(frame.url));
}
ipcMain.on('edc:info', (event) => {
  event.returnValue = trusted(event) ? { platform: process.platform, version: app.getVersion() } : null;
});
ipcMain.on('edc:quit', (event) => {
  if (!trusted(event)) return;
  log('[bridge] quit()');
  quitGame('bridge');
});
ipcMain.handle('edc:setFullscreen', (event, on) => {
  if (!trusted(event)) return false;
  return setFullscreen(on === true);
});
ipcMain.handle('edc:isFullscreen', (event) => (trusted(event) && win ? win.isFullScreen() : false));
ipcMain.handle('edc:unlockAchievement', (event, id) => (trusted(event) ? steam.unlockAchievement(STEAM, id, log) : false));

// ------------------------------------------------------------------------------------------------
// Smoke-test mode (EDC_SMOKE_DIR=<dir>): probe the page, screenshot, then quit via the bridge.
// Inert unless the env var is set. Used by `npm run smoke`.
// ------------------------------------------------------------------------------------------------
const smokeState = { consoleErrors: [], failed: false };
function smokeWrite(name, data) {
  try { fs.mkdirSync(SMOKE_DIR, { recursive: true }); fs.writeFileSync(path.join(SMOKE_DIR, name), data); } catch (e) { log('[smoke] write failed', String(e)); }
}
function smokeFail(reason) {
  if (smokeState.failed || quitVia === 'bridge') return;
  smokeState.failed = true;
  log(`[smoke] FAIL ${reason}`);
  smokeWrite('report.json', JSON.stringify({ ok: false, reason, consoleErrors: smokeState.consoleErrors }, null, 2));
  app.exit(3);
}
const PROBE = `(async () => {
  const r = { href: location.href, title: document.title, crossOriginIsolated: self.crossOriginIsolated === true };
  const d = window.edcDesktop;
  if (d && typeof d === 'object') {
    r.bridge = { keys: Object.keys(d).sort(), isDesktop: d.isDesktop, platform: d.platform, version: d.version,
      types: Object.fromEntries(Object.keys(d).map((k) => [k, typeof d[k]])) };
    try { r.bridge.isFullscreen = await d.isFullscreen(); } catch (e) { r.bridge.isFullscreenError = String(e); }
    try { r.bridge.setFullscreenFalse = await d.setFullscreen(false); await new Promise((res) => setTimeout(res, 600)); r.bridge.isFullscreenAfterSet = await d.isFullscreen(); } catch (e) { r.bridge.setFullscreenError = String(e); }
    try { r.bridge.unlockAchievement = await d.unlockAchievement('EDC_SMOKE_TEST_NOT_A_REAL_ACHIEVEMENT'); } catch (e) { r.bridge.unlockError = String(e); }
    r.bridge.nodeLeak = typeof window.require !== 'undefined' || typeof window.process !== 'undefined' || typeof window.module !== 'undefined';
  } else { r.bridge = null; }
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      r.webgl = { context: (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ? 'webgl2' : 'webgl',
        version: gl.getParameter(gl.VERSION), renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    } else r.webgl = null;
  } catch (e) { r.webgl = null; r.webglError = String(e); }
  try {
    const k = 'edc.smoke.launches';
    const n = (parseInt(localStorage.getItem(k) || '0', 10) || 0) + 1;
    localStorage.setItem(k, String(n));
    r.localStorage = { key: k, launchCount: n, saveKeyPresent: localStorage.getItem('edc.save.v1') !== null };
  } catch (e) { r.localStorage = null; r.localStorageError = String(e); }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { const ac = new AC(); r.webaudio = { state: ac.state, sampleRate: ac.sampleRate }; await ac.close(); } else r.webaudio = null;
  } catch (e) { r.webaudio = null; r.webaudioError = String(e); }
  r.gamepadApi = typeof navigator.getGamepads === 'function';
  try { await fetch('https://' + 'edc-network-probe.invalid/'); r.remoteFetchBlocked = false; } catch { r.remoteFetchBlocked = true; }
  try { r.windowOpenBlocked = window.open('https://' + 'edc-network-probe.invalid/popup') === null; } catch { r.windowOpenBlocked = true; }
  try {
    const before = location.href;
    location.href = 'https://' + 'edc-network-probe.invalid/navigate';
    await new Promise((res) => setTimeout(res, 800));
    r.navigationBlocked = location.href === before;
  } catch { r.navigationBlocked = true; }
  if (window.__edc) {
    const g = window.__edc;
    try { await Promise.race([g.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('__edc.ready timeout')), 30000))]); r.game = { ready: true }; }
    catch (e) { r.game = { ready: false, error: String(e) }; }
    try { r.game.state = typeof g.getState === 'function' ? g.getState() : null; } catch (e) { r.game.stateError = String(e); }
    try { r.game.errors = Array.isArray(g.errors) ? g.errors.slice(0, 50).map(String) : null; } catch { r.game.errors = null; }
  } else r.game = null;
  r.placeholder = window.__placeholderResults || null;
  return JSON.parse(JSON.stringify(r));
})()`;

// Real-game flow (only with the ?debug=1 harness): boot splash -> title -> Clock in -> briefing ->
// shift 1 with real key input (OS-level input events, so audio unlocks from a real gesture) ->
// pause/resume -> fullscreen + achievement through the game's own bridge calls -> (first launch)
// finish the shift so a result is saved -> back to the title, Quit dialog opened for the UI quit.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAVE_SUMMARY = `(() => { try { const s = JSON.parse(localStorage.getItem('edc.save.v1') || 'null');
  return s && { secondsOnShift: s.stats && s.stats.secondsOnShift, best: Object.keys(s.best || {}), achievements: Object.keys(s.achievements || {}), unlocked: s.progress && s.progress.unlocked }; } catch (e) { return String(e); } })()`;
async function runGameFlow() {
  const js = (src) => win.webContents.executeJavaScript(src, true);
  const key = async (keyCode, holdMs = 60) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    await sleep(holdMs);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await sleep(200);
  };
  const screen = () => js('window.__edc.ui.screen');
  const waitScreen = async (want, ms) => { const t0 = Date.now(); let sc; do { sc = await screen(); if (sc === want) return sc; await sleep(100); } while (Date.now() - t0 < ms); return sc; };
  const f = {};
  f.saveAtBoot = await js(SAVE_SUMMARY);
  f.bootScreen = await screen();
  win.focus(); win.webContents.focus();
  await key('Enter');                                   // boot splash -> title (the audio-unlock gesture)
  f.afterBoot = await waitScreen('menu', 6000);
  await sleep(300);
  f.audio = await js(`(() => { const a = window.__edc.audio; const s = a && a.debug && a.debug.stats(); return s ? { state: s.state, bankQueue: s.bankQueue, errors: s.errors } : null; })()`);
  await key('Enter');                                   // title: Clock in -> briefing
  f.afterClockIn = await waitScreen('briefing', 6000);
  await key('Enter');                                   // briefing: begin
  f.afterBegin = await waitScreen('playing', 10000);
  if (f.afterBegin !== 'playing') { await js('window.__edc.ui.startRun(1), true'); f.startedViaHarness = true; }
  await js('window.__edc.perfReset && window.__edc.perfReset(), true');
  const t0 = await js('window.__edc.sim.state.time');
  const w0 = Date.now();
  const th0 = await js('window.__edc.sim.state.drum.theta');
  // hold keys for a number of RENDERED frames (software GL may present one frame every few seconds)
  const frames = () => js('window.__edc.loop.stats.frames');
  const waitFrames = async (n, maxMs = 20000) => { const f0 = await frames(); const t = Date.now(); while ((await frames()) - f0 < n && Date.now() - t < maxMs) await sleep(50); };
  const hold = async (keyCode, n) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); await waitFrames(n); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await waitFrames(1); };
  await waitFrames(2);                                  // the press that began the shift is swallowed on its first frame
  await hold('D', 4); await hold('A', 3); await hold('Space', 1); await hold('D', 2);
  f.play = await js(`(() => { const e = window.__edc; const s = e.getState(); return { screen: s.screen, levelId: s.levelId, time: s.time, slams: s.slam && s.slam.count, fps: s.fps, audio: e.audio && e.audio.debug ? { state: e.audio.debug.stats().state, bankQueue: e.audio.debug.stats().bankQueue } : null }; })()`);
  f.simAdvanced = +(f.play.time - t0).toFixed(2);
  f.playWallMs = Date.now() - w0;
  // main-thread split while playing (ms per rendered frame / per sim step) + sound bank render cost
  f.perf = await js(`(() => { const e = window.__edc; const p = e.perf ? e.perf() : null; const a = e.audio && e.audio.debug ? e.audio.debug.stats() : {};
    return p && { frames: p.frames, steps: p.steps, simPerStep: +(p.sim / Math.max(1, p.steps)).toFixed(2), viewPerFrame: +(p.view / Math.max(1, p.frames)).toFixed(1), uiPerFrame: +(p.ui / Math.max(1, p.frames)).toFixed(2), audioPerFrame: +(p.audio / Math.max(1, p.frames)).toFixed(2), maxFrame: +p.maxFrame.toFixed(0), bankRenderMs: Math.round(a.bankRenderMs || 0), bankMaxRenderMs: Math.round(a.bankMaxRenderMs || 0) }; })()`);
  f.drumTurned = +Math.abs((await js('window.__edc.sim.state.drum.theta')) - th0).toFixed(3);
  await key('Escape'); f.paused = await waitScreen('paused', 4000);
  await key('Escape'); f.resumed = await waitScreen('playing', 4000);
  f.fsOn = await js('window.__edc.ui.systems.setFullscreen(true)'); await sleep(800); f.fsOnWin = win.isFullScreen();
  f.fsOff = await js('window.__edc.ui.systems.setFullscreen(false)'); await sleep(800); f.fsOffWin = win.isFullScreen();
  await js(`window.__edc.bus.emit('achievement', { id: 'FIRST_SHIFT' }), true`);  // persisted + forwarded to Steam
  if (!f.saveAtBoot || !(f.saveAtBoot.best || []).length) {
    f.fastForward = await js(`(async () => { const e = window.__edc;
      for (let i = 0; i < 90 && e.sim.state.status !== 'ended'; i++) { e.setInput({ rotate: Math.sin(i * 0.9) > 0 ? 1 : -1, brake: false, slam: i % 4 === 0 }); e.step(120, false); await new Promise((r) => setTimeout(r, 0)); }
      e.setInput(null); return { status: e.sim.state.status, time: +e.sim.state.time.toFixed(1), liters: +e.getState().liters.toFixed(1) }; })()`);
    f.results = await waitScreen('results', 40000);
  }
  f.saveNow = await js(SAVE_SUMMARY);
  f.errors = await js('window.__edc.errors.slice(0, 20).map(String)');
  await js('window.__edc.ui.debug.toTitle(), true'); await sleep(500);
  await key('Escape');                                  // title: Back = Quit (desktop) -> confirm dialog
  f.quitDialog = await js('(() => { const t = window.__edc.ui.nav.top; return t ? t.name : null; })()');
  return f;
}

async function runSmoke() {
  const waitMs = Number(process.env.EDC_SMOKE_WAIT_MS || 3000);
  await new Promise((r) => setTimeout(r, waitMs));
  if (!win || win.isDestroyed()) return smokeFail('window gone');
  const probe = await win.webContents.executeJavaScript(PROBE, true);
  let gameFlow = null;
  if (probe && probe.game && probe.game.ready) {
    try { gameFlow = await runGameFlow(); } catch (e) { gameFlow = { error: String(e && e.stack) }; }
  }
  // Keyboard fullscreen toggles (synthetic key events go through before-input-event).
  const keyToggle = {};
  try {
    const press = async (keyCode, modifiers = []) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await new Promise((r) => setTimeout(r, 700));
      return win.isFullScreen();
    };
    keyToggle.before = win.isFullScreen();
    keyToggle.afterF11 = await press('F11');
    keyToggle.afterAltEnter = await press('Enter', ['alt']);
  } catch (e) { keyToggle.error = String(e); }
  const img = await win.webContents.capturePage();
  const size = img.getSize();
  const bmp = img.toBitmap();
  const colors = new Set();
  for (let i = 0; i < bmp.length; i += 4 * 97) colors.add((bmp[i] << 16) | (bmp[i + 1] << 8) | bmp[i + 2]);
  smokeWrite('screenshot.png', img.toPNG());
  const report = {
    ok: true,
    app: { name: PRODUCT_NAME, version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
      platform: process.platform, arch: process.arch, packaged: app.isPackaged, execPath: process.execPath, appPath: APP_PATH,
      chromiumSandbox: !app.commandLine.hasSwitch('no-sandbox') },
    userData: USER_DATA, defaultUserData, gameRoot: GAME_ROOT, buildInfo: BUILD_INFO,
    window: { visible: win.isVisible(), fullscreen: win.isFullScreen(), bounds: win.getBounds(), title: win.getTitle() },
    gpu: { featureStatus: app.getGPUFeatureStatus() },
    keyToggle,
    steam: steam.publicState(STEAM),
    screenshot: { width: size.width, height: size.height, distinctSampledColors: colors.size },
    probe,
    gameFlow,
    consoleErrors: smokeState.consoleErrors,
  };
  smokeWrite('report.json', JSON.stringify(report, null, 2));
  const holdMs = Number(process.env.EDC_SMOKE_HOLD_MS || 0);   // lets the runner grab an X11 screenshot
  if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
  if (gameFlow && gameFlow.quitDialog === 'confirm') {
    // the game's own Quit: confirm dialog (focus starts on "No") -> Right -> Enter -> edcDesktop.quit()
    log('[smoke] probe done; quitting through the game UI (Quit -> Yes)');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await sleep(300);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  } else {
    log('[smoke] probe done; asking the page to call edcDesktop.quit()');
    // Fire and forget: the frame is torn down by the quit, so this promise may reject - that is success.
    win.webContents.executeJavaScript('setTimeout(() => window.edcDesktop && window.edcDesktop.quit(), 0); true', true).catch(() => {});
  }
  setTimeout(() => smokeFail('edcDesktop.quit() did not quit within 10 s'), 10000).unref();
}

// ------------------------------------------------------------------------------------------------
// App lifecycle
// ------------------------------------------------------------------------------------------------
Menu.setApplicationMenu(null);
if (process.platform === 'win32') app.setAppUserModelId('com.everydropcounts.game');

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.on('child-process-gone', (_e, details) => {
  log('[main] child-process-gone', details);
});

app.on('before-quit', () => flushStorage('before-quit'));
app.on('will-quit', () => {
  log(`[main] quitting (via ${quitVia || 'window/os'})`);
  if (SMOKE_DIR && !smokeState.failed) smokeWrite('exit.json', JSON.stringify({ via: quitVia || 'window/os', at: new Date().toISOString() }));
});
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  const ses = session.defaultSession;
  hardenSession(ses);
  registerGameProtocol(ses);
  const state = loadWindowState();
  preferHighPerformanceGpuOnWindows(state);
  createWindow();
}).catch((e) => {
  log('[main] startup failed', e && e.stack ? e.stack : String(e));
  app.exit(1);
});
