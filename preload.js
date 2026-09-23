'use strict';
/** contextIsolation köprüsü: renderer'a yalnızca gerekli, güvenli API'ler açılır. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mesoft', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('app:info'),
  openBackups: () => ipcRenderer.invoke('app:openBackups'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  pickFolder: () => ipcRenderer.invoke('app:pickFolder'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (handler) => {
    for (const ch of ['update:available', 'update:not-available', 'update:progress', 'update:downloaded', 'update:error'])
      ipcRenderer.on(ch, (_e, payload) => handler(ch.split(':')[1], payload));
  }
});
