<template>
  <div v-if="ready" class="h-[100dvh] md:h-full flex flex-col bg-stone-50 text-stone-900 overflow-hidden">

    <!-- Logged out: the login screen is all that exists. The library layout is
         not rendered at all, so nothing behind it can mount or fetch. -->
    <template v-if="config.loggedIn">

      <!-- DESKTOP: sidebar + content (not mounted in mini-player mode) -->
      <div v-if="!ui.minimal" class="hidden md:flex flex-1 overflow-hidden">
        <SideBar />
        <main class="flex-1 flex flex-col overflow-hidden">
          <RouterView />
        </main>
      </div>

      <!-- MOBILE: full width content -->
      <div v-if="!ui.minimal" class="flex md:hidden flex-1 flex-col overflow-hidden">
        <RouterView />
      </div>

      <!-- PLAYER (handles desktop footer + mobile mini/full/bottomnav internally) -->
      <Player />

    </template>

    <RouterView v-else />

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from './stores/config'
import SideBar from './components/SideBar.vue'
import Player  from './components/Player.vue'
import { useUiStore } from './stores/ui'
import { ping } from './api/subsonic'

const config = useConfigStore()
const ui     = useUiStore()
const router = useRouter()
const ready  = ref(false)

// Electron only: log in silently from the credentials remembered in the
// Keychain-backed store. Nothing remembered, or the ping fails (offline, changed
// password) → fall through to the login form, pre-filled.
async function autoLogin() {
  const creds = await window.attic?.getCredentials?.()
  if (!creds) return
  config.server   = creds.server
  config.username = creds.username
  config.password = creds.password
  try {
    await ping()
    config.saveSession()
    await router.isReady() // the first navigation may already have bounced to /login
    if (router.currentRoute.value.name === 'login') router.replace('/home')
  } catch (_) {}
}

onMounted(async () => {
  await config.load()
  await autoLogin()
  ready.value = true
})
</script>