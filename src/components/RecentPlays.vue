<template>
  <div class="border-t border-stone-200 flex flex-col min-h-0" :class="open ? 'flex-1' : 'flex-shrink-0'">
    <div
      class="flex items-center justify-between px-4 py-3 cursor-pointer select-none flex-shrink-0"
      @click="open = !open"
    >
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium uppercase tracking-widest text-stone-400">Recent plays</span>
        <span class="text-xs text-amber-700 font-medium">last.fm</span>
      </div>
      <span
        class="text-stone-500 text-sm transition-transform duration-200 inline-block leading-none"
        :class="{ 'rotate-90': open }"
      >›</span>
    </div>
    <div v-if="open" class="overflow-y-auto flex-1 space-y-2 px-4 pb-4">
      <div v-if="!scrobbles.length" class="text-xs text-stone-400">Nothing yet…</div>
      <div v-for="(s, i) in scrobbles" :key="i" class="pb-2 border-b border-stone-100 last:border-0">
        <div class="text-xs font-medium truncate" :class="s.nowplaying ? 'text-amber-700' : 'text-stone-800'">
          <span v-if="s.nowplaying" class="inline-block w-1.5 h-1.5 rounded-full bg-amber-700 mr-1 mb-0.5 animate-pulse"></span>
          {{ s.track }}
        </div>
        <div class="text-xs text-stone-400 truncate">{{ s.artist }}</div>
        <div v-if="!s.nowplaying" class="text-xs text-stone-300 mt-0.5">{{ s.when }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { getRecentTracks } from '../api/lastfm'

const open = ref(true)
const scrobbles = ref([])
let timer = null

async function fetchScrobbles() {
  try {
    scrobbles.value = await getRecentTracks(5)
  } catch (e) {
    if (e.permanent) {
      clearInterval(timer)
      timer = null
    }
    // transient errors (network etc.) — keep polling
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
