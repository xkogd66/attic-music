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

    // No session is restored: credentials live in memory only, so a reload or a
    // new tab always requires logging in again. Clear any entry written by an
    // older build so a plaintext password doesn't linger on disk.
    try { localStorage.removeItem('attic_cfg') } catch(e) {}
  }

  function saveSession() {
    loggedIn.value = true
  }

  function logout() {
    password.value = ''
    loggedIn.value = false
  }

  return { server, username, password, lastfmUser, lastfmKey, turnstileSiteKey, loggedIn, load, saveSession, logout }
})