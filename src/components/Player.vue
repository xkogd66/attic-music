<template>
  <!-- DESKTOP PLAYER -->
  <footer class="hidden md:flex h-20 bg-white border-t border-stone-200 items-center px-6 gap-6 z-50 flex-shrink-0">

    <!-- TRACK INFO -->
    <div class="flex items-center gap-3 w-60 flex-shrink-0 overflow-hidden">
      <div class="w-11 h-11 bg-amber-50 flex-shrink-0 overflow-hidden flex items-center justify-center text-xl rounded">
        <img v-if="player.currentTrack?.coverArt" :src="coverUrl(player.currentTrack.coverArt)" class="w-full h-full object-cover" @error="onImgError" />
        <span v-else>🎵</span>
      </div>
      <div class="overflow-hidden">
        <div class="text-sm font-medium truncate">{{ player.currentTrack?.title || '—' }}</div>
        <div class="text-xs text-stone-400 truncate">
          {{ player.currentTrack?.artist || '' }}
          <span v-if="player.currentTrack?.album"> · {{ player.currentTrack.album }}</span>
        </div>
      </div>
    </div>

    <!-- CONTROLS -->
    <div class="flex-1 flex flex-col items-center gap-1.5">
      <div class="flex items-center gap-4">
        <div class="flex flex-col items-center gap-0.5">
          <button class="ctrl" :class="{ 'text-amber-700': player.shuffle }" @click="player.shuffle = !player.shuffle">
            <Shuffle :size="16" />
          </button>
          <span class="text-[9px] uppercase tracking-widest" :class="player.shuffle ? 'text-amber-700' : 'text-stone-300'">shuffle</span>
        </div>
        <button class="ctrl" @click="player.prevTrack()"><SkipBack :size="18" /></button>
        <button
          class="w-9 h-9 rounded-full bg-stone-900 text-white flex items-center justify-center hover:bg-amber-700 transition-colors"
          @click="player.togglePlay()"
        >
          <Pause v-if="player.isPlaying" :size="16" />
          <Play v-else :size="16" class="translate-x-px" />
        </button>
        <button class="ctrl" @click="player.nextTrack()"><SkipForward :size="18" /></button>
        <div class="flex flex-col items-center gap-0.5">
          <button class="ctrl" :class="{ 'text-amber-700': player.repeat }" @click="player.repeat = !player.repeat">
            <Repeat :size="16" />
          </button>
          <span class="text-[9px] uppercase tracking-widest" :class="player.repeat ? 'text-amber-700' : 'text-stone-300'">repeat</span>
        </div>
      </div>

      <!-- PROGRESS -->
      <div class="flex items-center gap-2 w-full max-w-lg">
        <span class="text-xs text-stone-400 w-9 flex-shrink-0 tabular-nums">{{ player.fmt(player.currentTime) }}</span>
        <div
          ref="progressEl"
          class="flex-1 h-0.5 bg-stone-200 rounded cursor-pointer group"
          @click="handleSeek"
        >
          <div class="h-full bg-stone-900 rounded group-hover:bg-amber-700 transition-colors" :style="{ width: player.progressPct + '%' }"></div>
        </div>
        <span class="text-xs text-stone-400 w-9 flex-shrink-0 text-right tabular-nums">{{ player.fmt(player.duration) }}</span>
      </div>
    </div>

    <!-- RIGHT -->
    <div class="flex items-center justify-end gap-2 flex-shrink-0">
      <!-- Volume -->
      <button class="ctrl" @click="player.toggleMute()">
        <VolumeX v-if="player.volume === 0" :size="16" />
        <Volume1 v-else-if="player.volume < 0.5" :size="16" />
        <Volume2 v-else :size="16" />
      </button>
      <input
        type="range" min="0" max="1" step="0.01"
        :value="player.volume"
        @input="player.setVolume(+$event.target.value)"
        class="w-20 cursor-pointer [accent-color:var(--accent)]"
      />
      <button
        class="text-xs border border-stone-200 px-2.5 py-1.5 rounded text-stone-400 hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50 transition-all"
        :class="{ 'border-amber-700 text-amber-700 bg-amber-50': showLyrics }"
        @click="toggleLyrics"
      >Lyrics</button>
      <button
        class="text-xs border border-stone-200 px-2.5 py-1.5 rounded text-stone-400 hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50 transition-all"
        :class="{ 'border-amber-700 text-amber-700 bg-amber-50': showQueue }"
        @click="showQueue = !showQueue; showLyrics = false"
      >
        Queue{{ player.queue.length ? ` (${player.queue.length})` : '' }}
      </button>
    </div>

    <!-- DESKTOP LYRICS PANEL -->
    <Transition name="queue">
      <div v-if="showLyrics && player.currentTrack" class="fixed bottom-20 right-0 w-72 max-h-96 bg-white border border-stone-200 border-b-0 flex flex-col shadow-lg z-40">
        <div class="px-4 py-3 border-b border-stone-200 flex-shrink-0">
          <span class="text-xs font-medium uppercase tracking-widest">Lyrics</span>
        </div>
        <div class="overflow-y-auto flex-1 px-4 py-3" ref="lyricsEl">
          <div v-if="lyricsLoading" class="text-xs text-stone-300 text-center py-8">Loading…</div>
          <template v-else-if="!lyrics">
            <div class="text-xs text-stone-300 text-center pt-8 pb-3">No lyrics found</div>
            <template v-if="addingLyrics">
              <textarea
                v-model="manualLyricsText"
                class="w-full text-xs text-stone-700 border border-stone-200 rounded p-2 outline-none focus:border-amber-700 resize-none leading-relaxed"
                rows="8"
                placeholder="Paste lyrics here…"
                autofocus
              ></textarea>
              <div class="flex gap-3 mt-2">
                <button class="text-xs text-amber-700 font-medium hover:text-amber-800 transition-colors" @click="saveLyricsManually">Save</button>
                <button class="text-xs text-stone-400 hover:text-stone-600 transition-colors" @click="addingLyrics = false; manualLyricsText = ''">Cancel</button>
              </div>
            </template>
            <div v-else class="text-center">
              <button class="text-xs text-stone-400 hover:text-amber-700 transition-colors" @click="addingLyrics = true">+ Add lyrics manually</button>
            </div>
          </template>
          <template v-else-if="lyrics.synced">
            <p
              v-for="(line, i) in lyrics.synced"
              :key="i"
              :ref="el => { if (el) lineEls[i] = el }"
              class="text-sm leading-relaxed py-0.5 transition-all duration-300"
              :class="i === activeLine ? 'text-stone-900 font-semibold' : 'text-stone-300'"
            >{{ line.text }}</p>
          </template>
          <p v-else class="text-sm text-stone-500 leading-relaxed whitespace-pre-wrap">{{ lyrics.plain }}</p>
        </div>
      </div>
    </Transition>

    <!-- DESKTOP QUEUE PANEL -->
    <Transition name="queue">
      <div v-if="showQueue && player.queue.length" class="fixed bottom-20 right-0 w-72 max-h-96 bg-white border border-stone-200 border-b-0 flex flex-col shadow-lg z-40">
        <div class="flex items-center justify-between px-4 py-3 border-b border-stone-200 flex-shrink-0">
          <span class="text-xs font-medium uppercase tracking-widest">Queue ({{ player.queue.length }})</span>
          <div class="flex items-center gap-2">
            <template v-if="savingPlaylist">
              <input
                ref="playlistNameInput"
                v-model="playlistName"
                class="text-xs border border-stone-200 rounded px-1.5 py-0.5 w-28 outline-none focus:border-amber-700"
                placeholder="Playlist name…"
                @keydown.enter="savePlaylist"
                @keydown.esc="savingPlaylist = false"
              />
              <button class="text-xs text-amber-700 hover:text-amber-800 transition-colors font-medium" @click="savePlaylist">Save</button>
              <button class="text-xs text-stone-400 hover:text-stone-600 transition-colors" @click="savingPlaylist = false">✕</button>
            </template>
            <template v-else>
              <button class="text-xs text-stone-400 hover:text-amber-700 transition-colors" @click="startSavePlaylist" title="Save queue as playlist">+ Playlist</button>
              <button class="text-xs text-stone-400 hover:text-amber-700 transition-colors" @click="player.clearQueue()">Clear</button>
            </template>
          </div>
        </div>
        <div class="overflow-y-auto flex-1">
          <div
            v-for="(track, i) in player.queue" :key="i"
            class="flex items-center gap-2.5 px-4 py-2.5 cursor-pointer hover:bg-stone-50 transition-colors"
            :class="{ 'text-amber-700': i === player.currentIndex }"
            @click="player.jumpToQueue(i)"
          >
            <span class="text-xs text-stone-400 w-4 text-right flex-shrink-0">{{ i + 1 }}</span>
            <div class="flex-1 overflow-hidden">
              <div class="text-xs font-medium truncate">{{ track.title }}</div>
              <div class="text-xs text-stone-400 truncate">{{ track.artist }}</div>
            </div>
            <span class="text-xs text-stone-300 flex-shrink-0">{{ player.fmt(track.duration) }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </footer>

  <!-- MOBILE MINI PLAYER -->
  <MiniPlayer @expand="fullPlayerOpen = true" />

  <!-- MOBILE FULL PLAYER -->
  <FullPlayer :show="fullPlayerOpen" @collapse="fullPlayerOpen = false" />

  <!-- MOBILE BOTTOM NAV -->
  <BottomNav />
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { Shuffle, Repeat, Play, Pause, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-vue-next'
import { usePlayerStore } from '../stores/player'
import { coverUrl, createPlaylist } from '../api/subsonic'
import { fetchLyrics, saveManualLyrics } from '../api/lyrics'
import MiniPlayer from './MiniPlayer.vue'
import FullPlayer from './FullPlayer.vue'
import BottomNav  from './BottomNav.vue'

const player         = usePlayerStore()
const showQueue      = ref(false)
const showLyrics     = ref(false)
const fullPlayerOpen = ref(false)
const progressEl     = ref(null)
const lyrics         = ref(null)
const lyricsLoading  = ref(false)
const lyricsEl       = ref(null)
const lineEls        = ref([])

const activeLine = computed(() => {
  if (!lyrics.value?.synced) return -1
  let idx = 0
  for (let i = 0; i < lyrics.value.synced.length; i++) {
    if (lyrics.value.synced[i].time <= player.currentTime) idx = i
  }
  return idx
})

watch(activeLine, async (idx) => {
  if (idx < 0) return
  await nextTick()
  lineEls.value[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

watch(() => player.currentTrack?.id, () => {
  lyrics.value       = null
  lineEls.value      = []
  addingLyrics.value     = false
  manualLyricsText.value = ''
  if (showLyrics.value) loadLyrics()
})

async function toggleLyrics() {
  showLyrics.value = !showLyrics.value
  showQueue.value = false
  if (showLyrics.value && !lyrics.value && player.currentTrack) await loadLyrics()
}

async function loadLyrics() {
  lyricsLoading.value = true
  lineEls.value = []
  try { lyrics.value = await fetchLyrics(player.currentTrack) }
  finally { lyricsLoading.value = false }
}

const addingLyrics     = ref(false)
const manualLyricsText = ref('')

async function saveLyricsManually() {
  if (!player.currentTrack || !manualLyricsText.value.trim()) return
  saveManualLyrics(player.currentTrack.id, manualLyricsText.value)
  addingLyrics.value     = false
  manualLyricsText.value = ''
  await loadLyrics()
}

const savingPlaylist    = ref(false)
const playlistName      = ref('')
const playlistNameInput = ref(null)

function handleSeek(event) {
  player.seek(event, progressEl.value)
}

function onImgError(e) {
  try { if (e?.target) e.target.style.display = 'none' } catch(_) {}
}

async function startSavePlaylist() {
  savingPlaylist.value = true
  playlistName.value   = ''
  await nextTick()
  playlistNameInput.value?.focus()
}

async function savePlaylist() {
  const name = playlistName.value.trim()
  if (!name || !player.queue.length) return
  await createPlaylist(name, player.queue.map(t => t.id))
  savingPlaylist.value = false
  playlistName.value   = ''
}
</script>

<style scoped>
@reference "../style.css";

.ctrl {
  @apply text-stone-400 hover:text-stone-900 transition-colors cursor-pointer bg-transparent border-none text-base leading-none p-1;
}
.queue-enter-active, .queue-leave-active { transition: opacity 0.15s, transform 0.15s; }
.queue-enter-from, .queue-leave-to { opacity: 0; transform: translateY(8px); }
</style>
