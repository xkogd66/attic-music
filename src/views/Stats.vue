<template>
  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">

    <div class="px-4 md:px-6 py-3 md:py-6 border-b border-stone-200 bg-white flex-shrink-0">
      <h1 class="font-serif text-3xl font-semibold">Stats</h1>
      <p class="text-sm text-stone-500 mt-1">{{ totalPlays.toLocaleString() }} plays</p>
    </div>

    <div class="flex-1 overflow-y-auto px-4 md:px-6 py-4 pb-40 md:pb-24 space-y-4">

      <div v-if="error" class="text-sm text-red-700">{{ error }}</div>

      <!-- YEARS: plays per year; click one to filter the list below -->
      <section class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Year</h2>
        <div class="flex flex-wrap gap-2">
          <button
            class="text-xs border rounded-full px-3 py-1.5 transition-colors"
            :class="year === null ? 'border-amber-700 text-amber-700' : 'border-stone-200 text-stone-600 hover:border-amber-700'"
            @click="year = null"
          >All time</button>
          <button
            v-for="y in years" :key="y.year"
            class="text-xs border rounded-full px-3 py-1.5 transition-colors"
            :class="year === y.year ? 'border-amber-700 text-amber-700' : 'border-stone-200 text-stone-600 hover:border-amber-700'"
            @click="year = y.year"
          >{{ y.year }} <span class="text-stone-400">· {{ y.plays.toLocaleString() }}</span></button>
        </div>
      </section>

      <!-- TOP LIST -->
      <section class="bg-white rounded-xl border border-stone-200 p-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600">
            Top {{ by }}s · {{ year ?? 'all time' }}
          </h2>
          <div class="flex gap-2">
            <button
              v-for="b in ['artist', 'album', 'track']" :key="b"
              class="text-xs border rounded-full px-3 py-1 transition-colors capitalize"
              :class="by === b ? 'border-amber-700 text-amber-700' : 'border-stone-200 text-stone-600 hover:border-amber-700'"
              @click="by = b"
            >{{ b }}s</button>
          </div>
        </div>
        <div v-if="loading" class="text-sm text-stone-600 py-4">Loading…</div>
        <ol v-else>
          <li
            v-for="(r, i) in rows" :key="i"
            class="grid items-center gap-3 py-1.5 border-b border-stone-100 last:border-0 text-sm"
            style="grid-template-columns: 2rem 1fr auto"
          >
            <span class="text-stone-400 text-xs text-right">{{ i + 1 }}</span>
            <span class="truncate">
              <span v-if="by === 'artist'">{{ r.artist }}</span>
              <template v-else>
                {{ r[by] }} <span class="text-stone-500">· {{ r.artist }}</span>
              </template>
            </span>
            <span class="text-xs text-stone-600">{{ r.plays.toLocaleString() }}</span>
          </li>
        </ol>
      </section>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { getScrobbleStats } from '../api/scrobbles'

const years   = ref([])
const year    = ref(null)
const by      = ref('artist')
const rows    = ref([])
const loading = ref(false)
const error   = ref('')

const totalPlays = computed(() => years.value.reduce((n, y) => n + y.plays, 0))

async function loadTop() {
  loading.value = true
  error.value   = ''
  try {
    rows.value = await getScrobbleStats({ by: by.value, year: year.value, limit: 50 })
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch([by, year], loadTop)

onMounted(async () => {
  try {
    years.value = await getScrobbleStats({ by: 'year', limit: 200 })
  } catch (e) {
    error.value = e.message
  }
  loadTop()
})
</script>
