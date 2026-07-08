<template>
  <div class="flex flex-col h-full overflow-hidden">

    <!-- PLAYLIST LIST -->
    <template v-if="!currentPlaylist">
      <div class="px-4 md:px-6 py-3 md:py-6 border-b border-stone-200 bg-white flex-shrink-0 flex items-center justify-between gap-4">
        <h1 class="font-serif text-sm font-semibold md:text-3xl">Playlists</h1>
        <div v-if="creating" class="flex items-center gap-2">
          <input
            ref="newNameInput"
            v-model="newName"
            class="text-xs border border-stone-200 rounded px-2 py-1.5 w-36 outline-none focus:border-amber-700"
            placeholder="Playlist name…"
            @keydown.enter="createNew"
            @keydown.esc="creating = false"
          />
          <button class="text-xs text-amber-700 hover:text-amber-800 font-medium transition-colors" @click="createNew">Create</button>
          <button class="text-xs text-stone-400 hover:text-stone-600 transition-colors" @click="creating = false">✕</button>
        </div>
        <button
          v-else
          class="text-xs border border-stone-200 px-2.5 py-1.5 rounded text-stone-400 hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50 transition-all flex-shrink-0"
          @click="startCreating"
        >+ New</button>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4 pb-40 md:pb-24">
        <div v-if="loading" class="flex items-center justify-center py-24 text-stone-400 text-sm">Loading…</div>
        <div v-else-if="!playlists.length" class="flex flex-col items-center justify-center py-24 text-stone-400 gap-2">
          <span class="text-4xl">📋</span>
          <span class="font-serif text-lg">No playlists yet</span>
          <span class="text-sm">Save your queue as a playlist from the player</span>
        </div>
        <div v-else class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))">
          <div
            v-for="pl in playlists" :key="pl.id"
            class="cursor-pointer group"
            @click="openPlaylist(pl)"
          >
            <div class="aspect-square bg-amber-50 mb-1.5 overflow-hidden relative rounded-lg">
              <img v-if="pl.coverArt" :src="coverUrl(pl.coverArt)" :alt="pl.name" class="w-full h-full object-cover" @error="onImgError" />
              <div v-else class="w-full h-full flex items-center justify-center text-4xl">📋</div>
              <div class="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                <button
                  class="w-9 h-9 rounded-full bg-white flex items-center justify-center text-sm pl-0.5"
                  @click.stop="playPlaylist(pl)"
                >▶</button>
              </div>
            </div>
            <div class="text-xs font-medium truncate leading-tight">{{ pl.name }}</div>
            <div class="text-xs text-stone-400 mt-0.5">{{ pl.songCount }} track{{ pl.songCount !== 1 ? 's' : '' }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- PLAYLIST DETAIL -->
    <template v-else>
      <div class="px-6 py-6 border-b border-stone-200 bg-white flex-shrink-0">
        <div class="flex items-center gap-1.5 text-xs text-stone-400 mb-1">
          <span class="cursor-pointer hover:text-amber-700 transition-colors" @click="closePlaylist">Playlists</span>
          <span class="opacity-40">›</span>
          <span class="truncate">{{ currentPlaylist.name }}</span>
        </div>
        <h1 class="font-serif text-3xl font-semibold">{{ currentPlaylist.name }}</h1>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-4 pb-40 md:pb-24">
        <div v-if="loading" class="flex items-center justify-center py-24 text-stone-400 text-sm">Loading…</div>
        <div v-else>
          <div class="flex gap-4 mb-6 items-end">
            <div class="w-28 h-28 flex-shrink-0 bg-amber-50 overflow-hidden rounded-lg shadow-md">
              <img v-if="currentPlaylist.coverArt" :src="coverUrl(currentPlaylist.coverArt)" :alt="currentPlaylist.name" class="w-full h-full object-cover" @error="onImgError" />
              <div v-else class="w-full h-full flex items-center justify-center text-4xl">📋</div>
            </div>
            <div class="flex-1 overflow-hidden">
              <div class="text-xs uppercase tracking-widest text-stone-400 mb-1">
                Playlist · {{ playlistTracks.length }} tracks
              </div>
              <div class="font-serif text-xl font-semibold leading-tight mb-3">{{ currentPlaylist.name }}</div>
              <div class="flex gap-2 flex-wrap">
                <button class="bg-stone-900 text-white text-xs font-medium px-4 py-2 rounded-full hover:bg-amber-700 transition-colors" @click="playTracks">▶ Play</button>
                <button class="border border-stone-200 text-xs px-4 py-2 rounded-full hover:border-amber-700 hover:text-amber-700 transition-colors" @click="queueTracks">+ Queue</button>
                <button class="border border-red-200 text-xs px-4 py-2 rounded-full text-red-400 hover:border-red-400 hover:text-red-600 transition-colors" @click="confirmDelete">Delete</button>
              </div>
            </div>
          </div>

          <div v-if="!playlistTracks.length" class="text-sm text-stone-400 py-8 text-center">This playlist is empty</div>
          <template v-else>
            <div class="grid gap-2 text-xs uppercase tracking-widest text-stone-400 px-3 pb-2 border-b border-stone-200 mb-1 [grid-template-columns:28px_1fr_44px_28px] md:[grid-template-columns:28px_1fr_1fr_44px_28px]">
              <span class="text-center">#</span><span>Title</span><span class="hidden md:block">Artist</span><span>Time</span><span></span>
            </div>
            <TrackItem
              v-for="(track, i) in playlistTracks" :key="track.id"
              :track="track"
              :index="i"
              :removable="true"
              @play="player.playTrack(track, playlistTracks, i)"
              @queue="player.addToQueue(track)"
              @remove="removeTrack"
            />
          </template>
        </div>
      </div>
    </template>

  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../stores/player'
import { usePlaylistStore } from '../stores/playlist'
import { getPlaylists, getPlaylist, createPlaylist, deletePlaylist, updatePlaylist, coverUrl } from '../api/subsonic'
import TrackItem from '../components/TrackItem.vue'

const route          = useRoute()
const router         = useRouter()
const player         = usePlayerStore()
const playlistStore  = usePlaylistStore()

const loading         = ref(false)
const playlists       = ref([])
const currentPlaylist = ref(null)
const playlistTracks  = ref([])

const creating    = ref(false)
const newName     = ref('')
const newNameInput = ref(null)

async function startCreating() {
  creating.value = true
  newName.value  = ''
  await nextTick()
  newNameInput.value?.focus()
}

async function createNew() {
  const name = newName.value.trim()
  if (!name) return
  await createPlaylist(name)
  creating.value = false
  newName.value  = ''
  await loadPlaylists()
  playlistStore.load()
}

async function loadPlaylists() {
  loading.value = true
  try { playlists.value = await getPlaylists() }
  finally { loading.value = false }
}

async function openPlaylist(pl) {
  loading.value = true
  router.push({ name: 'playlist-detail', params: { id: pl.id } })
  try {
    const data = await getPlaylist(pl.id)
    currentPlaylist.value = { ...pl, ...data.info }
    playlistTracks.value  = data.tracks
  } finally { loading.value = false }
}

async function playPlaylist(pl) {
  await openPlaylist(pl)
  playTracks()
}

function playTracks() {
  if (!playlistTracks.value.length) return
  player.playTrack(playlistTracks.value[0], playlistTracks.value, 0)
}

function queueTracks() {
  player.queue.push(...playlistTracks.value)
}

async function removeTrack(index) {
  await updatePlaylist(currentPlaylist.value.id, { songIndexesToRemove: [index] })
  playlistTracks.value.splice(index, 1)
}

async function confirmDelete() {
  if (!confirm(`Delete playlist "${currentPlaylist.value.name}"?`)) return
  await deletePlaylist(currentPlaylist.value.id)
  closePlaylist()
  await loadPlaylists()
}

function closePlaylist() {
  currentPlaylist.value = null
  router.push({ name: 'playlists' })
}

function onImgError(e) {
  try { if (e?.target) e.target.style.display = 'none' } catch (_) {}
}

onMounted(async () => {
  await loadPlaylists()
  if (route.params.id) {
    const pl = playlists.value.find(p => p.id === route.params.id)
    if (pl) openPlaylist(pl)
  }
})

watch(() => route.params.id, (id) => {
  if (!id) currentPlaylist.value = null
  else {
    const pl = playlists.value.find(p => p.id === id)
    if (pl) openPlaylist(pl)
  }
})
</script>
