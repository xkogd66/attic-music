// Thin Electron shell: loads the live site, so web deploys update the app with
// no rebuild. The only native feature is the mini-player window (see preload.js).
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')

const APP_URL    = process.env.ATTIC_URL || 'https://music.ekskog.me'
const APP_ORIGIN = new URL(APP_URL).origin
const FULL_SIZE  = { width: 1200, height: 800 }
const MINI_SIZE  = { width: 380, height: 160 } // outer size: includes the ~28px title bar

let win
let fullBounds = null // window bounds to restore when leaving mini mode

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

function createWindow() {
  win = new BrowserWindow({
    ...FULL_SIZE,
    backgroundColor: '#fafaf9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', // resume playback after reload/mini toggle
    },
  })
  win.loadURL(APP_URL)

  // Anything that isn't the app itself opens in the default browser.
  const external = (url) => {
    if (new URL(url).origin === APP_ORIGIN) return false
    shell.openExternal(url)
    return true
  }
  win.webContents.setWindowOpenHandler(({ url }) => ({ action: external(url) ? 'deny' : 'allow' }))
  win.webContents.on('will-navigate', (e, url) => { if (external(url)) e.preventDefault() })
}

// Called from the web app via preload.js when mini-player mode toggles (and on
// load, if it was left on). Only our own origin may call it.
ipcMain.on('attic:set-mini', (event, on) => {
  if (!win || new URL(event.senderFrame.url).origin !== APP_ORIGIN) return
  if (on === true) {
    if (!fullBounds) fullBounds = win.getBounds()
    win.setAlwaysOnTop(true, 'floating')
    win.setBounds({ ...win.getBounds(), ...MINI_SIZE }, true)
  } else {
    win.setAlwaysOnTop(false)
    win.setBounds(fullBounds ? { ...fullBounds } : { ...win.getBounds(), ...FULL_SIZE }, true)
    fullBounds = null
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
