<template>
  <div class="border-t border-stone-200 flex flex-col min-h-0" :class="open ? 'flex-1' : 'flex-shrink-0'">
    <div
      class="flex items-center justify-between px-4 py-3 cursor-pointer select-none flex-shrink-0"
      @click="open = !open"
    >
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium uppercase tracking-widest text-stone-600">Recent plays</span>
        <span class="text-xs text-amber-700 font-medium">last.fm</span>
      </div>
      <span
        class="text-stone-500 text-sm transition-transform duration-200 inline-block leading-none"
        :class="{ 'rotate-90': open }"
      >›</span>
    </div>
    <div v-if="open" class="overflow-y-auto flex-1 space-y-1 px-2 pb-4">
      <div v-if="!scrobbles.length" class="text-xs text-stone-600 px-2">Nothing yet…</div>
      <!-- Rows are buttons: a scrobble is text only, so a click looks the song
           up in the library first (findLibrarySong) and then plays it. -->
      <button
        v-for="(s, i) in scrobbles"
        :key="i"
        type="button"
        class="w-full text-left px-2 py-1.5 rounded border-b border-stone-100 last:border-0 transition-colors disabled:cursor-default"
        :class="[
          s.id === player.currentTrack?.id ? 'bg-amber-50' : 'hover:bg-stone-50',
          busyIndex === i ? 'opacity-60' : '',
        ]"
        :disabled="busyIndex !== null"
        :title="s.missing ? 'Not in your library' : `Play ${s.track}`"
        @click="resume(i, s)"
      >
        <div class="text-xs font-medium truncate" :class="s.nowplaying || s.id === player.currentTrack?.id ? 'text-amber-700' : 'text-stone-800'">
          <span v-if="s.nowplaying" class="inline-block w-1.5 h-1.5 rounded-full bg-amber-700 mr-1 mb-0.5 animate-pulse"></span>
          <span v-else-if="s.id === player.currentTrack?.id" class="mr-1">♪</span>
          {{ s.track }}
        </div>
        <div class="text-xs text-stone-600 truncate">{{ s.artist }}</div>
        <div v-if="s.missing" class="text-xs text-stone-400 mt-0.5 italic">not in library</div>
        <div v-else-if="!s.nowplaying" class="text-xs text-stone-500 mt-0.5">{{ s.when }}</div>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { getRecentTracks, findLibrarySong } from '../api/lastfm'
import { usePlayerStore } from '../stores/player'

const player = usePlayerStore()

const open = ref(true)
const scrobbles = ref([])
const busyIndex = ref(null)
let timer = null

async function fetchScrobbles() {
  try {
    const fresh = await getRecentTracks(5)
    // Carry over ids/misses already resolved so the highlight doesn't flicker
    // and answered lookups aren't dropped on every poll.
    const prev = new Map(scrobbles.value.map(s => [`${s.artist}\n${s.track}`, s]))
    scrobbles.value = fresh.map(s => {
      const old = prev.get(`${s.artist}\n${s.track}`)
      return old ? { ...s, id: old.id, missing: old.missing } : s
    })
  } catch (e) {
    if (e.permanent) {
      clearInterval(timer)
      timer = null
    }
    // transient errors (network etc.) — keep polling
  }
}

// Resume a play: resolve the scrobble to a library song, then play it.
// Single-track queue, same as a sidebar search result.
async function resume(index, s) {
  if (busyIndex.value !== null) return
  busyIndex.value = index
  try {
    const song = s.id ? { id: s.id, title: s.track, artist: s.artist } : await findLibrarySong(s)
    if (!song) { s.missing = true; return }
    s.missing = false
    s.id = song.id
    player.playTrack(song, [song], 0)
  } catch (_) {
    // library unreachable — leave the row as it was, a later click retries
  } finally {
    busyIndex.value = null
  }
}

onMounted(() => {
  fetchScrobbles()
  timer = setInterval(fetchScrobbles, 30000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>
