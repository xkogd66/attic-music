import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useConfigStore = defineStore('config', () => {
  const server     = ref('')
  const username   = ref('')
  const password   = ref('')
  const isAdmin    = ref(false)
  const loggedIn   = ref(false)

  async function load() {
    // Fetch server-side config first (from k8s configmap/secret)
    try {
      const res = await fetch('/config.json')
      const cfg = await res.json()
      if (cfg.server)     server.value     = cfg.server
      if (cfg.username)   username.value   = cfg.username
    } catch(e) {}

    // No session is restored: credentials live in memory only, so a reload or a
    // new tab always requires logging in again. Clear any entry written by an
    // older build so a plaintext password doesn't linger on disk.
    try { localStorage.removeItem('attic_cfg') } catch(e) {}
  }

  // admin = gonic's adminRole for this user. Only hides UI; the sidecar and
  // chat-server enforce it themselves.
  function saveSession(admin) {
    isAdmin.value  = !!admin
    loggedIn.value = true
  }

  function logout() {
    password.value = ''
    isAdmin.value  = false
    loggedIn.value = false
    // Electron only: forget the remembered login so we don't silently log back in.
    window.attic?.clearCredentials?.()
  }

  return { server, username, password, isAdmin, loggedIn, load, saveSession, logout }
})
