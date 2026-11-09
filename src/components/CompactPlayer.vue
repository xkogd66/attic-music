<template>
  <!-- DESKTOP COMPACT PLAYER — the "minimized" footer, after iTunes' MiniPlayer:
       a single short strip with tiny art, marquee-ish truncated title, the
       thumbnail scrubber, transport buttons and an expand handle. -->
  <footer class="hidden md:flex h-12 bg-white border-t border-stone-200 items-center px-3 gap-3 z-50 flex-shrink-0">

    <!-- ALBUM ART (click = expand) -->
    <button
      class="w-8 h-8 bg-amber-50 flex-shrink-0 overflow-hidden flex items-center justify-center text-sm rounded cursor-pointer border-0 p-0"
      title="Expand player"
      @click="emit('expand')"
    >
      <img v-if="player.currentTrack?.coverArt" :src="coverUrl(player.currentTrack.coverArt)" class="w-full h-full object-cover" @error="onImgError" />
      <span v-else>🎵</span>
    </button>

    <!-- TRACK INFO -->
    <div class="w-40 lg:w-52 flex-shrink-0 overflow-hidden">
      <div class="text-xs font-medium truncate leading-tight">{{ player.currentTrack?.title || '—' }}</div>
      <div class="text-[11px] text-stone-600 truncate leading-tight">{{ player.currentTrack?.artist || '' }}</div>
    </div>

    <!-- TRANSPORT -->
    <div class="flex items-center gap-0.5 flex-shrink-0">
      <button class="ctrl" title="Previous" @click="player.prevTrack()"><SkipBack :size="14" /></button>
      <button
        class="w-7 h-7 rounded-full bg-stone-900 text-white flex items-center justify-center hover:bg-amber-700 transition-colors flex-shrink-0"
        :title="player.isPlaying ? 'Pause' : 'Play'"
        @click="player.togglePlay()"
      >
        <Pause v-if="player.isPlaying" :size="12" />
        <Play v-else :size="12" class="translate-x-px" />
      </button>
      <button class="ctrl" title="Next" @click="player.nextTrack()"><SkipForward :size="14" /></button>
    </div>

    <!-- THUMBNAIL SCRUBBER -->
    <div class="flex-1 min-w-0 flex items-center gap-2">
      <span class="text-[11px] text-stone-600 w-8 flex-shrink-0 tabular-nums hidden lg:block">{{ player.fmt(player.currentTime) }}</span>
      <div
        ref="progressEl"
        class="flex-1 h-0.5 bg-stone-200 rounded cursor-pointer group"
        @click="handleSeek"
      >
        <div class="h-full bg-stone-900 rounded group-hover:bg-amber-700 transition-colors" :style="{ width: player.progressPct + '%' }"></div>
      </div>
      <span class="text-[11px] text-stone-600 w-8 flex-shrink-0 text-right tabular-nums hidden lg:block">{{ player.fmt(player.duration) }}</span>
    </div>

    <!-- EXPAND -->
    <button
      class="ctrl flex-shrink-0"
      title="Expand player"
      @click="emit('expand')"
    >
      <ChevronsUp :size="15" />
    </button>
  </footer>
</template>

<script setup>
import { ref } from 'vue'
import { Play, Pause, SkipBack, SkipForward, ChevronsUp } from 'lucide-vue-next'
import { usePlayerStore } from '../stores/player'
import { coverUrl } from '../api/subsonic'

const player     = usePlayerStore()
const emit       = defineEmits(['expand'])
const progressEl = ref(null)

function handleSeek(event) {
  player.seek(event, progressEl.value)
}

function onImgError(e) {
  try { if (e?.target) e.target.style.display = 'none' } catch(_) {}
}
</script>

<style scoped>
@reference "../style.css";

.ctrl {
  @apply text-stone-600 hover:text-stone-900 transition-colors cursor-pointer bg-transparent border-none text-base leading-none p-1;
}
</style>
