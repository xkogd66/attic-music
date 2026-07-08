import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useConfigStore = defineStore('config', () => {
  const server     = ref('')
  const username   = ref('')
  const password   = ref('')
  const lastfmUser       = ref('')
  const lastfmKey        = ref('')
  const turnstileSiteKey = ref('')
  const loggedIn         = ref(false)

  async function load() {
    // Fetch server-side config first (from k8s configmap/secret)
    try {
      const res = await fetch('/config.json')
      const cfg = await res.json()
      if (cfg.server)     server.value     = cfg.server
      if (cfg.username)   username.value   = cfg.username
      if (cfg.lastfmUser) lastfmUser.value = cfg.lastfmUser
      if (cfg.lastfmKey)        lastfmKey.value        = cfg.lastfmKey
      if (cfg.turnstileSiteKey) turnstileSiteKey.value = cfg.turnstileSiteKey
    } catch(e) {}

    // Then overlay saved password from localStorage
    try {
      const saved = localStorage.getItem('attic_cfg')
      if (saved) {
        const c = JSON.parse(saved)
        if (c.password) password.value = c.password
        if (c.server)   server.value   = c.server
        loggedIn.value = true
      }
    } catch(e) {}
  }

  function saveSession() {
    localStorage.setItem('attic_cfg', JSON.stringify({
      server:   server.value,
      password: password.value,
    }))
    loggedIn.value = true
  }

  function logout() {
    localStorage.removeItem('attic_cfg')
    password.value = ''
    loggedIn.value = false
  }

  return { server, username, password, lastfmUser, lastfmKey, turnstileSiteKey, loggedIn, load, saveSession, logout }
})