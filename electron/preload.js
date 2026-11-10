const { contextBridge, ipcRenderer } = require('electron')

// The web app feature-detects this (`window.attic?.setMini`); in a plain browser
// or the PWA it is undefined and mini mode just fills whatever window you have.
contextBridge.exposeInMainWorld('attic', {
  setMini: (on) => ipcRenderer.send('attic:set-mini', !!on),
  // Remembered login (encrypted in main.js). Each returns a Promise.
  getCredentials:   ()      => ipcRenderer.invoke('attic:get-credentials'),
  saveCredentials:  (creds) => ipcRenderer.invoke('attic:save-credentials', creds),
  clearCredentials: ()      => ipcRenderer.invoke('attic:clear-credentials'),
})
