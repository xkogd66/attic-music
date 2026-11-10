const { contextBridge, ipcRenderer } = require('electron')

// The web app feature-detects this (`window.attic?.setMini`); in a plain browser
// or the PWA it is undefined and mini mode just fills whatever window you have.
contextBridge.exposeInMainWorld('attic', {
  setMini: (on) => ipcRenderer.send('attic:set-mini', !!on),
})
