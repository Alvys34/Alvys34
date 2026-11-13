'use strict';
// Optional Steamworks integration (steamworks.js). Everything here is defensive: the game must run
// identically when the library is missing, fails to load, Steam is not running, or no app id is set.

const fs = require('node:fs');
const path = require('node:path');

const ACHIEVEMENT_ID = /^[A-Za-z0-9_.-]{1,128}$/;

function parseAppId(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

function readAppIdFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return parseAppId(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0]);
  } catch {
    return null;
  }
}

/**
 * App id resolution order (first hit wins):
 *   1. EDC_STEAM_APPID env var          (manual testing, e.g. EDC_STEAM_APPID=480)
 *   2. SteamAppId env var               (set by the Steam client when it launches the game)
 *   3. steam_appid.txt next to the executable, then in the working directory (Valve's dev convention)
 *   4. steamAppId baked into build-info.json at build time (from desktop/steam_appid.txt)
 * Returns { appId, source } or { appId: null }.
 */
function resolveAppId({ bakedAppId, exeDir }) {
  const candidates = [
    ['env:EDC_STEAM_APPID', () => parseAppId(process.env.EDC_STEAM_APPID)],
    ['env:SteamAppId', () => parseAppId(process.env.SteamAppId)],
    ['file:exe-dir', () => readAppIdFile(path.join(exeDir, 'steam_appid.txt'))],
    ['file:cwd', () => readAppIdFile(path.join(process.cwd(), 'steam_appid.txt'))],
    ['build-info', () => parseAppId(bakedAppId)],
  ];
  if (process.env.EDC_STEAM_APPID !== undefined && parseAppId(process.env.EDC_STEAM_APPID) === null) {
    // EDC_STEAM_APPID=0 / =off explicitly disables Steam.
    return { appId: null, source: 'env:EDC_STEAM_APPID (disabled)' };
  }
  for (const [source, get] of candidates) {
    const appId = get();
    if (appId) return { appId, source };
  }
  return { appId: null, source: null };
}

/**
 * Must be called synchronously BEFORE app 'ready' (the overlay needs command-line switches).
 * Never throws.
 */
function initSteam({ log, bakedAppId, exeDir, enableOverlay }) {
  const state = { loaded: false, initialised: false, overlay: false, appId: null, appIdSource: null, reason: null, client: null };
  try {
    const { appId, source } = resolveAppId({ bakedAppId, exeDir });
    state.appId = appId;
    state.appIdSource = source;
    if (!appId) {
      state.reason = 'no app id configured';
      log(`[steam] disabled: ${state.reason}`);
      return state;
    }
    let steamworks;
    try {
      steamworks = require('steamworks.js');
      state.loaded = true;
    } catch (e) {
      state.reason = `steamworks.js failed to load: ${e && e.message}`;
      log(`[steam] disabled: ${state.reason}`);
      return state;
    }
    try {
      state.client = steamworks.init(appId);
      state.initialised = true;
    } catch (e) {
      state.reason = `SteamAPI init failed (is Steam running and does this account own app ${appId}?): ${e && e.message}`;
      log(`[steam] disabled: ${state.reason}`);
      return state;
    }
    log(`[steam] initialised, app id ${appId} (${source})`);
    if (enableOverlay) {
      try {
        steamworks.electronEnableSteamOverlay();
        state.overlay = true;
        log('[steam] overlay hook enabled (in-process-gpu, disable-direct-composition, frame invalidation)');
      } catch (e) {
        log(`[steam] overlay hook failed: ${e && e.message}`);
      }
    }
  } catch (e) {
    state.reason = `unexpected: ${e && e.message}`;
    log(`[steam] disabled: ${state.reason}`);
  }
  return state;
}

/** Resolves true only if Steam accepted the achievement. Never throws. */
function unlockAchievement(state, id, log) {
  if (typeof id !== 'string' || !ACHIEVEMENT_ID.test(id)) return false;
  if (!state || !state.initialised || !state.client) return false;
  try {
    const ok = !!state.client.achievement.activate(id);
    try { state.client.stats.store(); } catch { /* activate already stores in steamworks.js; best effort */ }
    log(`[steam] achievement ${id}: ${ok ? 'unlocked' : 'rejected (unknown API name or stats not ready)'}`);
    return ok;
  } catch (e) {
    log(`[steam] achievement ${id} failed: ${e && e.message}`);
    return false;
  }
}

function publicState(state) {
  if (!state) return null;
  const { client, ...rest } = state;
  return rest;
}

module.exports = { initSteam, unlockAchievement, resolveAppId, parseAppId, publicState };
