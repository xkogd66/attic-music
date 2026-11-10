import { defineStore } from 'pinia'
import { ref } from 'vue'

// Desktop UI prefs that aren't about playback or server config.
export const useUiStore = defineStore('ui', () => {
  const MINIMAL_KEY = 'attic_ui_minimal'

  // Mini-player mode: App.vue unmounts the sidebar + views and MiniWindow fills
  // the window. Persisted so the choice survives a reload — except in the
  // Electron wrapper (window.attic, see electron/preload.js), which always
  // starts in full mode: it resizes/floats the window itself, so restoring the
  // flag would reopen the app as a tiny window.
  const minimal = ref(!window.attic && localStorage.getItem(MINIMAL_KEY) === '1')

  // Undefined in a browser/PWA, where you shrink the window by hand.
  const syncWindow = () => window.attic?.setMini?.(minimal.value)

  function setMinimal(value) {
    minimal.value = value
    syncWindow()
    try { localStorage.setItem(MINIMAL_KEY, value ? '1' : '0') } catch (_) {}
  }

  function toggleMinimal() {
    setMinimal(!minimal.value)
  }

  return { minimal, setMinimal, toggleMinimal }
})
