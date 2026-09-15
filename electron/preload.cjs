const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('norae', {
  snapshot: () => ipcRenderer.invoke('room:snapshot'),
  add: (input) => ipcRenderer.invoke('room:add', input),
  demo: () => ipcRenderer.invoke('room:demo'),
  remove: (id) => ipcRenderer.invoke('room:remove', id),
  move: (id, direction) => ipcRenderer.invoke('room:move', id, direction),
  retry: (id) => ipcRenderer.invoke('room:retry', id),
  selectLyrics: (id, candidateId) => ipcRenderer.invoke('room:lyrics', id, candidateId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  check: () => ipcRenderer.invoke('settings:check'),
  chooseModel: () => ipcRenderer.invoke('settings:model'),
  fullscreen: (enabled) => ipcRenderer.invoke('window:fullscreen', enabled),
  onChange: (callback) => { const listener = (_event, tracks) => callback(tracks); ipcRenderer.on('room:changed', listener); return () => ipcRenderer.removeListener('room:changed', listener); },
});
