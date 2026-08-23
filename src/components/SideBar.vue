<template>
  <aside class="w-56 bg-white border-r border-stone-200 flex flex-col h-screen flex-shrink-0">

    <!-- HEADER -->
    <div class="px-6 py-7 border-b border-stone-200 flex-shrink-0">
      <div class="font-serif text-2xl font-semibold">attic player</div>
      <div class="text-xs text-stone-600 mt-0.5 truncate">{{ config.server }}</div>
    </div>

    <!-- NAV -->
    <nav class="p-4 flex-shrink-0">
      <div class="flex items-center justify-between px-2 py-2">
        <span class="text-xs font-medium uppercase tracking-widest text-stone-600">Library</span>
        <button
          type="button"
          class="text-stone-600 hover:text-amber-700 transition-colors disabled:opacity-40"
          :title="scanning ? 'Scan requested…' : 'Rescan library'"
          :disabled="scanning"
          @click="rescan"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': scanning }" />
        </button>
      </div>
      <div v-if="scanning" class="px-2 pb-2 text-xs text-stone-500">scanning…</div>
      <RouterLink
        v-for="item in navItems" :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ active: isActive(item.to) }"
      >
        <component :is="item.icon" :size="16" />
        {{ item.label }}
      </RouterLink>
    </nav>

    <!-- SEARCH -->
    <div class="px-4 pb-4 flex-shrink-0 relative" ref="searchContainer">
      <form class="relative" @submit.prevent>
        <input
          v-model="query"
          type="text"
          placeholder="Search…"
          class="w-full text-sm px-3 py-1.5 rounded border border-stone-200 bg-stone-50 placeholder-stone-400 focus:outline-none focus:border-amber-400 transition-colors"
          @input="onInput"
          @keydown.escape="clear"
        />
        <button
          v-if="query"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-stone-600 hover:text-stone-800 text-xs leading-none"
          @click="clear"
        >✕</button>
      </form>

      <button
        class="w-full mt-1.5 flex items-center justify-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
        @click="askOpen = true"
      >
        <span aria-hidden="true">✨</span> Ask AI
      </button>

      <div
        v-if="results && (results.artists.length || results.albums.length || results.songs.length)"
        class="absolute left-4 right-4 z-50 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
      >
        <template v-if="results.artists.length">
          <div class="px-3 py-1.5 text-xs text-stone-600 uppercase tracking-wider border-b border-stone-100">Artists</div>
          <button
            v-for="artist in results.artists"
            :key="artist.id"
            class="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 hover:text-amber-700 transition-colors truncate"
            @click="goArtist(artist)"
          >{{ artist.name }}</button>
        </template>
        <template v-if="results.albums.length">
          <div
            class="px-3 py-1.5 text-xs text-stone-600 uppercase tracking-wider border-b border-stone-100"
            :class="{ 'border-t border-stone-100': results.artists.length }"
          >Albums</div>
          <button
            v-for="album in results.albums"
            :key="album.id"
            class="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 hover:text-amber-700 transition-colors"
            @click="goAlbum(album)"
          >
            <div class="truncate">{{ album.name }}</div>
            <div class="text-xs text-stone-600 truncate">{{ album.artist }}</div>
          </button>
        </template>
        <template v-if="results.songs.length">
          <div
            class="px-3 py-1.5 text-xs text-stone-600 uppercase tracking-wider border-b border-stone-100"
            :class="{ 'border-t border-stone-100': results.artists.length || results.albums.length }"
          >Tracks</div>
          <button
            v-for="song in results.songs"
            :key="song.id"
            class="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 hover:text-amber-700 transition-colors"
            @click="playSong(song)"
          >
            <div class="truncate">{{ song.title }}</div>
            <div class="text-xs text-stone-600 truncate">{{ song.artist }} · {{ song.album }}</div>
          </button>
        </template>
      </div>

      <div
        v-else-if="query && results"
        class="absolute left-4 right-4 z-50 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg px-3 py-3 text-sm text-stone-600"
      >No results</div>
    </div>

    <!-- SCROBBLES -->
    <RecentPlays v-if="config.lastfmUser && config.lastfmKey" />

    <!-- FOOTER -->
    <div class="px-6 py-4 border-t border-stone-200 flex-shrink-0">
      <button class="text-xs text-stone-600 hover:text-amber-700 transition-colors" @click="logout">
        Sign out
      </button>
    </div>

    <AskAiModal :open="askOpen" @close="askOpen = false" />

  </aside>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConfigStore } from '../stores/config'
import { usePlayerStore } from '../stores/player'
import { search, startScan, getScanStatus } from '../api/subsonic'
import RecentPlays from './RecentPlays.vue'
import AskAiModal from './AskAiModal.vue'
import { House, Mic2, Disc3, ListMusic, RefreshCw } from 'lucide-vue-next'

const config = useConfigStore()
const player = usePlayerStore()
const route  = useRoute()
const router = useRouter()

const navItems = [
  { to: '/home',      icon: House,     label: 'Home'      },
  { to: '/artists',   icon: Mic2,      label: 'Artists'   },
  { to: '/albums',    icon: Disc3,     label: 'Albums'    },
  { to: '/playlists', icon: ListMusic, label: 'Playlists' },
]

function isActive(path) {
  return route.path.startsWith(path)
}

// Manual library rescan — gonic is never scanned automatically.
const scanning = ref(false)
let scanPoll   = null

async function rescan() {
  if (scanning.value) return
  scanning.value = true
  try {
    await startScan()
    scanPoll = setInterval(async () => {
      try {
        const data = await getScanStatus()
        if (!data.scanStatus?.scanning) {
          clearInterval(scanPoll)
          scanPoll = null
          scanning.value = false
        }
      } catch (_) {
        clearInterval(scanPoll)
        scanPoll = null
        scanning.value = false
      }
    }, 30000)
  } catch (_) {
    /* gonic unreachable — nothing useful to show here */
    scanning.value = false
  }
}

function logout() {
  config.logout()
  router.push('/login')
}

// ── SEARCH ────────────────────────────────────────────
const query           = ref('')
const results         = ref(null)
const searchContainer = ref(null)
const askOpen         = ref(false)
let debounceTimer     = null

function onInput() {
  clearTimeout(debounceTimer)
  if (!query.value.trim()) { results.value = null; return }
  debounceTimer = setTimeout(async () => {
    results.value = await search(query.value.trim())
  }, 300)
}

function clear() {
  query.value   = ''
  results.value = null
  clearTimeout(debounceTimer)
}

function goArtist(artist) {
  router.push({ name: 'artist-detail', params: { id: artist.id } })
  clear()
}

function goAlbum(album) {
  router.push({ name: 'album-detail', params: { id: album.id } })
  clear()
}

function playSong(song) {
  player.playTrack(song, [song], 0)
  clear()
}

function onDocClick(e) {
  if (searchContainer.value && !searchContainer.value.contains(e.target)) {
    results.value = null
  }
}

document.addEventListener('click', onDocClick)
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  if (scanPoll) clearInterval(scanPoll)
})
</script>

<style scoped>
@reference "../style.css";

.nav-item {
  @apply flex items-center gap-2.5 px-2 py-2 rounded text-sm text-stone-700 transition-all cursor-pointer no-underline;
}
.nav-item:hover {
  @apply bg-stone-50;
}
.nav-item.active {
  @apply bg-amber-50 text-amber-700 font-medium;
}
</style>
