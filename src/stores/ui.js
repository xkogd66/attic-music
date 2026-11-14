import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

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

  // Dark mode: toggles the `.dark` class on <html> (palette in style.css).
  // The choice is saved once made; until then it follows the system setting
  // at startup.
  const THEME_KEY = 'attic_ui_theme'
  let savedTheme = null
  try { savedTheme = localStorage.getItem(THEME_KEY) } catch (_) {}
  const dark = ref(savedTheme
    ? savedTheme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches)
  watch(dark, v => document.documentElement.classList.toggle('dark', v), { immediate: true })

  function toggleDark() {
    dark.value = !dark.value
    try { localStorage.setItem(THEME_KEY, dark.value ? 'dark' : 'light') } catch (_) {}
  }

  return { minimal, setMinimal, toggleMinimal, dark, toggleDark }
})
