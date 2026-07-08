<template>
  <div
    v-if="player.currentTrack"
    class="fixed left-0 right-0 h-16 bg-white border-t border-stone-200 flex items-center px-4 gap-3 z-40 cursor-pointer md:hidden"
    :style="{ bottom: '64px' }"
    @click="emit('expand')"
  >
    <!-- PROGRESS BAR (top) -->
    <div class="absolute top-0 left-0 right-0 h-0.5 bg-stone-100">
      <div class="h-full bg-amber-700 transition-all" :style="{ width: player.progressPct + '%' }"></div>
    </div>

    <!-- COVER -->
    <div class="w-12 h-12 bg-amber-50 flex-shrink-0 overflow-hidden flex items-center justify-center text-xl rounded-lg">
      <img v-if="player.currentTrack.coverArt" :src="coverUrl(player.currentTrack.coverArt)" class="w-full h-full object-cover" @error="onImgError" />
      <span v-else>🎵</span>
    </div>

    <!-- TRACK INFO -->
    <div class="flex-1 overflow-hidden">
      <div class="text-sm font-medium truncate leading-tight">{{ player.currentTrack.title }}</div>
      <div class="text-xs text-stone-400 truncate mt-0.5">{{ player.currentTrack.artist }}</div>
    </div>

    <!-- CONTROLS -->
    <div class="flex items-center gap-1 flex-shrink-0">
      <button
        class="w-9 h-9 flex items-center justify-center text-stone-400 active:text-amber-700"
        @click.stop="player.prevTrack()"
      >
        <SkipBack :size="18" />
      </button>
      <button
        class="w-9 h-9 flex items-center justify-center text-stone-700 active:text-amber-700"
        @click.stop="player.togglePlay()"
      >
        <Pause v-if="player.isPlaying" :size="22" />
        <Play v-else :size="22" class="translate-x-px" />
      </button>
      <button
        class="w-9 h-9 flex items-center justify-center text-stone-400 active:text-amber-700"
        @click.stop="player.nextTrack()"
      >
        <SkipForward :size="18" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { Play, Pause, SkipBack, SkipForward } from 'lucide-vue-next'
import { usePlayerStore } from '../stores/player'
import { coverUrl } from '../api/subsonic'

const player = usePlayerStore()
const emit   = defineEmits(['expand'])

function onImgError(e) {
  try { if (e?.target) e.target.style.display = 'none' } catch(_) {}
}
</script>
