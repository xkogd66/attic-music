<template>
  <div v-if="ready" class="h-[100dvh] md:h-full flex flex-col bg-stone-50 text-stone-900 overflow-hidden">

    <!-- Logged out: the login screen is all that exists. The library layout is
         not rendered at all, so nothing behind it can mount or fetch. -->
    <template v-if="config.loggedIn">

      <!-- DESKTOP: sidebar + content (not mounted in mini-player mode) -->
      <div v-if="!ui.minimal" class="hidden md:flex flex-1 overflow-hidden">
        <SideBar :show-filters="!!filterScope" />
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

      <!-- TEMP DEBUG: remove once the filter bug is found -->
      <div class="fixed top-0 left-0 z-[9999] max-w-[100vw] px-1 py-0.5 text-[10px] leading-tight bg-yellow-300 text-black font-mono break-all">
        DBG route={{ route.name }} filterScope={{ filterScope }} showFilters={{ !!filterScope }}
        | filters.scope={{ filters.scope }} opts.scope={{ filters.opts.scope }}
        g={{ filters.opts.genres.length }} y={{ filters.opts.years.length }}
        | v{{ buildTag }}
      </div>


    </template>

    <RouterView v-else />

  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConfigStore } from './stores/config'
import { useFiltersStore } from './stores/filters'
import SideBar from './components/SideBar.vue'
import Player  from './components/Player.vue'
import { useUiStore } from './stores/ui'
import { ping } from './api/subsonic'

const config = useConfigStore()
const ui     = useUiStore()
const filters = useFiltersStore()
const route  = useRoute()
const router = useRouter()
const ready  = ref(false)

// TEMP DEBUG: bump on every deploy so the on-screen line proves which build is
// running. Remove with the debug overlays.
const buildTag = 'DEBUG-1'

// What the sidebar's genre/year dropdowns filter. They are hidden everywhere
// else (Sidebar Home/Playlists/Tools/Search have nothing to filter).
const FILTER_SCOPES = {
  artists:     'artists',
  'artist-detail': 'artists',
  albums:      'albums',
  'album-detail':  'albums',
}
const filterScope = ref(null)
watch(
  () => route.name,
  (name) => {
    filterScope.value = FILTER_SCOPES[name] ?? null
    if (filterScope.value) filters.setScope(filterScope.value)
  },
  { immediate: true }
)


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