import { defineStore } from 'pinia'
import { ref } from 'vue'

// Desktop UI prefs that aren't about playback or server config.
export const useUiStore = defineStore('ui', () => {
  const MINIMAL_KEY = 'attic_ui_minimal'

  // Mini-player mode: App.vue unmounts the sidebar + views and MiniWindow fills
  // the window. Persisted so the choice survives a reload.
  const minimal = ref(localStorage.getItem(MINIMAL_KEY) === '1')

  function setMinimal(value) {
    minimal.value = value
    try { localStorage.setItem(MINIMAL_KEY, value ? '1' : '0') } catch (_) {}
  }

  function toggleMinimal() {
    setMinimal(!minimal.value)
  }

  return { minimal, setMinimal, toggleMinimal }
})
