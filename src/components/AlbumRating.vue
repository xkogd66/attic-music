<template>
  <!-- detail header: rating line (font set by the parent) -->
  <div v-if="full && album" class="flex items-center gap-2 flex-wrap">
    <a v-if="r?.rating" :href="r.url" target="_blank" rel="noopener" class="hover:text-amber-700 transition-colors" :title="title">
      <span class="text-amber-700">★ {{ r.rating.toFixed(1) }}</span> · {{ r.votes.toLocaleString() }} votes on Discogs
    </a>
    <span v-else-if="r" class="text-stone-500" :title="r.matched">No ratings on Discogs</span>
  </div>
  <!-- fix metadata button, sized like the Play / Queue / Download pills -->
  <div v-else-if="fix && album" class="flex items-center gap-2 flex-wrap">
    <button
      class="bg-amber-700 text-white text-xs font-medium px-4 py-2 rounded-full hover:bg-amber-800 transition-colors disabled:opacity-50"
      :disabled="busy"
      title="Overwrite genre (Discogs style), Discogs rating and earliest release year (MusicBrainz)"
      @click="fetchAll"
    >{{ busy ? 'Fetching…' : 'fix metadata' }}</button>
    <span v-for="m in msgs" :key="m.text" class="text-xs" :class="m.error ? 'text-red-600' : 'text-stone-500'">{{ m.text }}</span>
  </div>
  <!-- cards and lists -->
  <span v-else-if="!full && r?.rating" class="text-amber-700" :title="title">{{ (bare ? '★ ' : ' · ★ ') + r.rating.toFixed(1) }}</span>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRatingsStore } from '../stores/ratings'
import { fetchRating, fetchStyle } from '../api/chat'
import { startEnrich, getJob } from '../api/maintenance'

// The stored Discogs rating for a subsonic album object. Compact " · ★ 4.3" for
// cards and lists (`bare` drops the leading dot, for a line of its own); `full`
// is the detail-header rating line; `fix` is the "fix metadata" button alone.
// saveGenre(genre): the album view's writer (tags to disk + local override); required with `fix`.
const props = defineProps({ album: { type: Object, default: null }, full: Boolean, bare: Boolean, fix: Boolean, saveGenre: Function })

const ratings = useRatingsStore()
ratings.load()

const r = computed(() => ratings.of(props.album))
const title = computed(() =>
  (r.value?.releases ?? [])
    .map(x => `${[x.format, x.year, x.country].filter(Boolean).join(' · ')}: ${x.avg.toFixed(2)} (${x.votes})`)
    .join('\n'))

// One button: re-fetch the Discogs rating (force), overwrite the year with the
// earliest MusicBrainz release year (sidecar enrich job), then write the Discogs
// style as the genre. Year and genre both rewrite the album's mp3s, so the genre
// write waits for the enrich job to finish; the rating runs alongside.
const busy = ref(false)
const msgs = ref([]) // [{ text, error }]
const fail = (what, e) => msgs.value.push({ text: `${what} failed — ${e.message || e}`, error: true })

async function yearThenGenre(artist, album) {
  try {
    let job = await startEnrich(artist, album, { fields: 'year', overwriteYear: true, apply: true })
    while (job.status !== 'done' && job.status !== 'error') {
      await new Promise(res => setTimeout(res, 1500))
      job = await getJob(job.id)
    }
    if (job.status === 'error') throw new Error(job.error)
  } catch (e) { fail('Year', e) }
  try {
    const style = await fetchStyle(artist, album)
    if (style) await props.saveGenre(style)
    else msgs.value.push({ text: 'No style on Discogs' })
  } catch (e) { fail('Style', e) }
}

async function fetchAll() {
  const a = props.album
  const artist = a.albumArtist || a.artist
  busy.value = true
  msgs.value = []
  await Promise.all([
    fetchRating(artist, a.name, true).then(() => ratings.load(true)).catch(e => fail('Rating', e)),
    yearThenGenre(artist, a.name),
  ])
  busy.value = false
}
</script>
