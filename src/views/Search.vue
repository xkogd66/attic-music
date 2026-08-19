<template>
  <div class="flex flex-col h-full overflow-hidden">

    <div class="px-4 pt-5 pb-3 border-b border-stone-200 bg-white flex-shrink-0">
      <div class="flex items-center justify-between mb-3">
        <h1 class="font-serif text-2xl font-semibold">Search</h1>
        <button
          class="text-xs font-medium px-2.5 py-1 rounded-full border transition-colors"
          :class="aiMode ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-stone-200 text-stone-600'"
          @click="toggleAiMode"
        >✨ Ask AI</button>
      </div>
      <form class="flex gap-2" @submit.prevent="onEnter">
        <div class="relative flex-1">
          <input
            ref="inputEl"
            v-model="query"
            type="search"
            :placeholder="aiMode ? 'Ask about your library…' : 'Artists, albums…'"
            class="w-full text-sm px-3 py-2.5 rounded-lg border border-stone-200 bg-stone-50 placeholder-stone-400 focus:outline-none focus:border-amber-400 transition-colors"
            @input="onInput"
            @keydown.escape="clear"
          />
          <button
            v-if="query"
            type="button"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-stone-600 text-xs"
            @click="clear"
          >✕</button>
        </div>
        <button
          v-if="aiMode"
          type="submit"
          class="flex-shrink-0 px-4 rounded-lg bg-amber-500 text-white text-sm font-medium active:bg-amber-600 transition-colors"
        >Send</button>
      </form>
    </div>

    <div class="flex-1 overflow-y-auto pb-40">

      <div v-if="searching" class="flex justify-center py-12 text-stone-600 text-sm">
        {{ aiMode ? 'Thinking…' : 'Searching…' }}
      </div>

      <template v-else-if="aiMode">
        <div v-if="aiReply" class="px-4 py-3 text-sm text-stone-700 border-b border-stone-100 bg-amber-50/50">{{ aiReply }}</div>
        <div v-if="aiReply && !aiSongs.length" class="flex justify-center py-12 text-stone-600 text-sm">No songs found</div>
        <TrackItem
          v-for="(track, i) in aiSongs"
          :key="track.id"
          :track="track"
          :index="i"
          @play="player.playTrack(track, aiSongs, i)"
          @queue="player.addToQueue(track)"
        />
        <div v-if="!aiReply" class="flex flex-col items-center justify-center py-20 text-stone-500 gap-2">
          <span class="text-5xl">✨</span>
          <span class="text-sm text-stone-600 mt-2">Ask about your library, e.g. "all versions of Let's Dance by David Bowie"</span>
        </div>
      </template>

      <div v-else-if="query && results && !results.artists.length && !results.albums.length"
        class="flex justify-center py-12 text-stone-600 text-sm">No results for "{{ query }}"</div>

      <template v-else-if="results">
        <template v-if="results.artists.length">
          <div class="px-4 py-2 text-xs font-medium uppercase tracking-widest text-stone-600 border-b border-stone-100">Artists</div>
          <button
            v-for="artist in results.artists"
            :key="artist.id"
            class="w-full text-left px-4 py-3 text-sm border-b border-stone-100 active:bg-amber-50 active:text-amber-700 transition-colors"
            @click="goArtist(artist)"
          >
            <div class="font-medium">{{ artist.name }}</div>
          </button>
        </template>
        <template v-if="results.albums.length">
          <div class="px-4 py-2 text-xs font-medium uppercase tracking-widest text-stone-600 border-b border-stone-100">Albums</div>
          <button
            v-for="album in results.albums"
            :key="album.id"
            class="w-full text-left px-4 py-3 border-b border-stone-100 active:bg-amber-50 transition-colors"
            @click="goAlbum(album)"
          >
            <div class="text-sm font-medium">{{ album.name }}</div>
            <div class="text-xs text-stone-600 mt-0.5">{{ album.artist }}</div>
          </button>
        </template>
      </template>

      <div v-else class="flex flex-col items-center justify-center py-20 text-stone-500 gap-2">
        <span class="text-5xl">🔍</span>
        <span class="text-sm text-stone-600 mt-2">Search your library</span>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { search } from '../api/subsonic'
import { askAI } from '../api/chat'
import { usePlayerStore } from '../stores/player'
import TrackItem from '../components/TrackItem.vue'

const router  = useRouter()
const player  = usePlayerStore()
const inputEl = ref(null)
const query   = ref('')
const results = ref(null)
const searching = ref(false)
let debounceTimer = null

const aiMode  = ref(false)
const aiReply = ref('')
const aiSongs = ref([])

onMounted(() => inputEl.value?.focus())

function toggleAiMode() {
  aiMode.value = !aiMode.value
  clear()
}

function onInput() {
  if (aiMode.value) return // AI mode submits on Enter, not live
  clearTimeout(debounceTimer)
  if (!query.value.trim()) { results.value = null; return }
  searching.value = true
  debounceTimer = setTimeout(async () => {
    results.value = await search(query.value.trim())
    searching.value = false
  }, 300)
}

async function onEnter() {
  if (!aiMode.value || !query.value.trim()) return
  searching.value = true
  try {
    const res = await askAI(query.value.trim())
    aiReply.value = res.reply || ''
    aiSongs.value = res.songs || []
  } catch (err) {
    aiReply.value = `Something went wrong: ${err.message}`
    aiSongs.value = []
  } finally {
    searching.value = false
  }
}

function clear() {
  query.value   = ''
  results.value = null
  searching.value = false
  aiReply.value = ''
  aiSongs.value = []
  clearTimeout(debounceTimer)
}

function goArtist(artist) {
  router.push({ name: 'artist-detail', params: { id: artist.id } })
}

function goAlbum(album) {
  router.push({ name: 'album-detail', params: { id: album.id } })
}
</script>
