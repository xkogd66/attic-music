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
    <span v-if="error" class="text-red-600">{{ error }}</span>
  </div>
  <!-- cards and lists -->
  <span v-else-if="!full && r?.rating" class="text-amber-700" :title="title">{{ (bare ? '★ ' : ' · ★ ') + r.rating.toFixed(1) }}</span>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRatingsStore } from '../stores/ratings'
import { fetchRating } from '../api/chat'

// The stored Discogs rating for a subsonic album object. Compact " · ★ 4.3" for
// cards and lists (`bare` drops the leading dot, for a line of its own); `full`
// is the detail-header line, which also has the button that fetches it.
const props = defineProps({ album: { type: Object, default: null }, full: Boolean, bare: Boolean })

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
</script>
