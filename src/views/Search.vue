<template>
  <div class="flex flex-col h-full overflow-hidden">

    <div class="px-4 pt-5 pb-3 border-b border-stone-200 bg-white flex-shrink-0">
      <h1 class="font-serif text-2xl font-semibold mb-3">Search</h1>
      <div class="relative">
        <input
          ref="inputEl"
          v-model="query"
          type="search"
          placeholder="Artists, albums…"
          class="w-full text-sm px-3 py-2.5 rounded-lg border border-stone-200 bg-stone-50 placeholder-stone-400 focus:outline-none focus:border-amber-400 transition-colors"
          @input="onInput"
          @keydown.escape="clear"
        />
        <button
          v-if="query"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 text-xs"
          @click="clear"
        >✕</button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto pb-40">

      <div v-if="searching" class="flex justify-center py-12 text-stone-400 text-sm">Searching…</div>

      <div v-else-if="query && results && !results.artists.length && !results.albums.length"
        class="flex justify-center py-12 text-stone-400 text-sm">No results for "{{ query }}"</div>

      <template v-else-if="results">
        <template v-if="results.artists.length">
          <div class="px-4 py-2 text-xs font-medium uppercase tracking-widest text-stone-400 border-b border-stone-100">Artists</div>
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
          <div class="px-4 py-2 text-xs font-medium uppercase tracking-widest text-stone-400 border-b border-stone-100">Albums</div>
          <button
            v-for="album in results.albums"
            :key="album.id"
            class="w-full text-left px-4 py-3 border-b border-stone-100 active:bg-amber-50 transition-colors"
            @click="goAlbum(album)"
          >
            <div class="text-sm font-medium">{{ album.name }}</div>
            <div class="text-xs text-stone-400 mt-0.5">{{ album.artist }}</div>
          </button>
        </template>
      </template>

      <div v-else class="flex flex-col items-center justify-center py-20 text-stone-300 gap-2">
        <span class="text-5xl">🔍</span>
        <span class="text-sm text-stone-400 mt-2">Search your library</span>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { search } from '../api/subsonic'

const router  = useRouter()
const inputEl = ref(null)
const query   = ref('')
const results = ref(null)
const searching = ref(false)
let debounceTimer = null

onMounted(() => inputEl.value?.focus())

function onInput() {
  clearTimeout(debounceTimer)
  if (!query.value.trim()) { results.value = null; return }
  searching.value = true
  debounceTimer = setTimeout(async () => {
    results.value = await search(query.value.trim())
    searching.value = false
  }, 300)
}

function clear() {
  query.value   = ''
  results.value = null
  searching.value = false
  clearTimeout(debounceTimer)
}

function goArtist(artist) {
  router.push({ name: 'artist-detail', params: { id: artist.id } })
}

function goAlbum(album) {
  router.push({ name: 'album-detail', params: { id: album.id } })
}
</script>
