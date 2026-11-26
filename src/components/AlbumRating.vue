<template>
  <!-- detail header: rating link (or a fetch button when none is stored yet) -->
  <div v-if="full && album" class="text-xs text-stone-600 mb-1 flex items-center gap-2 flex-wrap">
    <a v-if="r?.rating" :href="r.url" target="_blank" rel="noopener" class="hover:text-amber-700 transition-colors" :title="title">
      <span class="text-amber-700">★ {{ r.rating.toFixed(1) }}</span> · {{ r.votes.toLocaleString() }} votes on Discogs
    </a>
    <span v-else-if="r" class="text-stone-500" :title="r.matched">No ratings on Discogs</span>
    <button
      class="border border-stone-300 text-stone-600 px-2.5 py-0.5 rounded-full hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
      :disabled="busy"
      :title="r ? 'Re-fetch from Discogs' : 'Fetch the Discogs rating'"
      @click="fetchIt(!!r)"
    >{{ busy ? 'Fetching…' : r ? '↻' : 'Fetch Discogs rating' }}</button>
    <button
      class="border border-stone-300 text-stone-600 px-2.5 py-0.5 rounded-full hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
      :disabled="genreBusy"
      title="Look up the album's style on Discogs and write it to the files as the genre"
      @click="fetchGenre"
    >{{ genreBusy ? 'Fetching…' : 'Fetch Discogs style' }}</button>
    <span v-if="error" class="text-red-600">{{ error }}</span>
    <span v-if="genreMsg" :class="genreMsg.error ? 'text-red-600' : 'text-stone-500'">{{ genreMsg.text }}</span>
  </div>
  <!-- cards and lists -->
  <span v-else-if="!full && r?.rating" class="text-amber-700" :title="title">{{ (bare ? '★ ' : ' · ★ ') + r.rating.toFixed(1) }}</span>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRatingsStore } from '../stores/ratings'
import { fetchRating, fetchStyle } from '../api/chat'

// The stored Discogs rating for a subsonic album object. Compact " · ★ 4.3" for
// cards and lists (`bare` drops the leading dot, for a line of its own); `full`
// is the detail-header line, which also has the button that fetches it.
// saveGenre(genre): the album view's writer (tags to disk + local override); only used with `full`.
const props = defineProps({ album: { type: Object, default: null }, full: Boolean, bare: Boolean, saveGenre: Function })

const ratings = useRatingsStore()
ratings.load()

const r = computed(() => ratings.of(props.album))
const title = computed(() =>
  (r.value?.releases ?? [])
    .map(x => `${[x.format, x.year, x.country].filter(Boolean).join(' · ')}: ${x.avg.toFixed(2)} (${x.votes})`)
    .join('\n'))

// Explicit, one album, ~7 Discogs calls. force re-fetches an already stored one.
const busy = ref(false)
const error = ref('')
async function fetchIt(force) {
  const a = props.album
  busy.value = true
  error.value = ''
  try {
    await fetchRating(a.albumArtist || a.artist, a.name, force)
    await ratings.load(true)
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    busy.value = false
  }
}

// Discogs style (chat-server /style) → written as the album genre by the view.
const genreBusy = ref(false)
const genreMsg = ref(null) // { text, error }
async function fetchGenre() {
  const a = props.album
  genreBusy.value = true
  genreMsg.value = null
  try {
    const style = await fetchStyle(a.albumArtist || a.artist, a.name)
    if (style) await props.saveGenre(style)
    else genreMsg.value = { text: 'No style on Discogs' }
  } catch (e) {
    genreMsg.value = { text: `Style lookup failed — ${e.message || e}`, error: true }
  } finally {
    genreBusy.value = false
  }
}
</script>
