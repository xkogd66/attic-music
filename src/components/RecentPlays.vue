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
      <!-- Only the album is clickable: a scrobble is text only, so a click looks
           the album up in the library first (findLibraryAlbum), then opens it. -->
      <div
        v-for="(s, i) in scrobbles"
        :key="i"
        class="px-2 py-1.5 border-b border-stone-100 last:border-0"
      >
        <div class="text-xs font-medium truncate" :class="s.nowplaying ? 'text-amber-700' : 'text-stone-800'">
          <span v-if="s.nowplaying" class="inline-block w-1.5 h-1.5 rounded-full bg-amber-700 mr-1 mb-0.5 animate-pulse"></span>
          {{ s.track }}
        </div>
        <div class="text-xs text-stone-600 truncate">{{ s.artist }}</div>
        <button
          v-if="s.album"
          type="button"
          class="block max-w-full text-left text-xs text-stone-600 hover:text-amber-700 truncate transition-colors disabled:cursor-default"
          :class="busyIndex === i ? 'opacity-60' : ''"
          :disabled="busyIndex !== null"
          :title="s.missing ? 'Not in your library' : `Open ${s.album}`"
          @click="openAlbum(i, s)"
        >{{ s.album }}</button>
        <div v-if="s.missing" class="text-xs text-stone-400 mt-0.5 italic">not in library</div>
        <div v-else-if="!s.nowplaying" class="text-xs text-stone-500 mt-0.5">{{ s.when }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { getRecentTracks, findLibraryAlbum } from '../api/lastfm'

const router = useRouter()

const open = ref(true)
const scrobbles = ref([])
const busyIndex = ref(null)
let timer = null

async function fetchScrobbles() {
  try {
    const fresh = await getRecentTracks(5)
    // Carry over misses already resolved so answered lookups aren't dropped
    // on every poll.
    const prev = new Map(scrobbles.value.map(s => [`${s.artist}\n${s.track}`, s]))
    scrobbles.value = fresh.map(s => {
      const old = prev.get(`${s.artist}\n${s.track}`)
      return old ? { ...s, missing: old.missing } : s
    })
  } catch (e) {
    if (e.permanent) {
      clearInterval(timer)
      timer = null
    }
    // transient errors (network etc.) — keep polling
  }
}

// Resolve the scrobble's album to a library album, then open its page.
async function openAlbum(index, s) {
  if (busyIndex.value !== null) return
  busyIndex.value = index
  try {
    const album = await findLibraryAlbum(s)
    if (!album) { s.missing = true; return }
    s.missing = false
    router.push({ name: 'album-detail', params: { id: album.id } })
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
