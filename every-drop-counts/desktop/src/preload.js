'use strict';
// Sandboxed preload. Exposes EXACTLY the locked desktop bridge contract (docs/ARCHITECTURE.md):
//   edcDesktop.isDesktop, .platform, .version, .quit(), .setFullscreen(bool), .isFullscreen(),
//   .unlockAchievement(id)
// Nothing else from Electron/Node is reachable from the page.
const { contextBridge, ipcRenderer } = require('electron');

let info = { platform: process.platform, version: '0.0.0' };
try {
  info = ipcRenderer.sendSync('edc:info') || info;
} catch {
  /* keep defaults */
}

contextBridge.exposeInMainWorld('edcDesktop', {
  isDesktop: true,
  platform: String(info.platform),
  version: String(info.version),
  /** Quit the game (flushes localStorage first). */
  quit: () => {
    ipcRenderer.send('edc:quit');
  },
  /** @param {boolean} on  @returns {Promise<boolean>} resulting fullscreen state */
  setFullscreen: (on) => ipcRenderer.invoke('edc:setFullscreen', !!on),
  /** @returns {Promise<boolean>} */
  isFullscreen: () => ipcRenderer.invoke('edc:isFullscreen'),
  /** @param {string} id Steam achievement API name. @returns {Promise<boolean>} false without Steam */
  unlockAchievement: (id) => ipcRenderer.invoke('edc:unlockAchievement', String(id)).catch(() => false),
});
