<template>
  <!-- MINI-PLAYER MODE — replaces the whole app, not just the footer. Fills the
       window at any size (no md: gating), so shrink the PWA window by hand and
       it behaves like iTunes' MiniPlayer / minimized Winamp. -->
  <div class="flex-1 min-h-0 flex items-stretch gap-3 p-3 bg-white">

    <!-- ALBUM ART -->
    <div class="aspect-square max-w-[45%] bg-amber-50 rounded overflow-hidden flex items-center justify-center text-3xl flex-shrink-0 self-center max-h-full">
      <img v-if="player.currentTrack?.coverArt" :src="coverUrl(player.currentTrack.coverArt)" class="w-full h-full object-cover" @error="onImgError" />
      <span v-else>🎵</span>
    </div>

    <div class="flex-1 min-w-0 flex flex-col justify-center gap-2">

      <!-- TITLE + EXIT -->
      <div class="flex items-start gap-2">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">{{ player.currentTrack?.title || '—' }}</div>
          <div class="text-xs text-stone-600 truncate">{{ player.currentTrack?.artist || '' }}</div>
        </div>
        <button class="ctrl flex-shrink-0" title="Exit mini player" @click="ui.setMinimal(false)">
          <PanelLeftOpen :size="15" />
        </button>
      </div>

      <!-- SCRUBBER -->
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-stone-600 tabular-nums flex-shrink-0">{{ player.fmt(player.currentTime) }}</span>
        <div ref="progressEl" class="flex-1 h-1 bg-stone-200 rounded cursor-pointer group" @click="handleSeek">
          <div class="h-full bg-stone-900 rounded group-hover:bg-amber-700 transition-colors" :style="{ width: player.progressPct + '%' }"></div>
        </div>
        <span class="text-[11px] text-stone-600 tabular-nums flex-shrink-0">{{ player.fmt(player.duration) }}</span>
      </div>

      <!-- TRANSPORT -->
      <div class="flex items-center justify-center gap-2">
        <button class="ctrl" title="Previous" @click="player.prevTrack()"><SkipBack :size="16" /></button>
        <button
          class="w-8 h-8 rounded-full bg-stone-900 text-white flex items-center justify-center hover:bg-amber-700 transition-colors flex-shrink-0"
          :title="player.isPlaying ? 'Pause' : 'Play'"
          @click="player.togglePlay()"
        >
          <Pause v-if="player.isPlaying" :size="14" />
          <Play v-else :size="14" class="translate-x-px" />
        </button>
        <button class="ctrl" title="Next" @click="player.nextTrack()"><SkipForward :size="16" /></button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Play, Pause, SkipBack, SkipForward, PanelLeftOpen } from 'lucide-vue-next'
import { usePlayerStore } from '../stores/player'
import { useUiStore } from '../stores/ui'
import { coverUrl } from '../api/subsonic'

const player     = usePlayerStore()
const ui         = useUiStore()
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
