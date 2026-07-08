<template>
  <Transition name="slide-up">
    <div v-if="show" class="fixed inset-0 bg-stone-50 z-50 flex flex-col md:hidden">

      <!-- HEADER -->
      <div class="flex items-center justify-between px-6 pt-12 pb-4 flex-shrink-0">
        <button class="text-stone-400 active:text-amber-700 p-2 -ml-2" @click="emit('collapse')">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <span class="text-xs font-medium uppercase tracking-widest text-stone-400">Now Playing</span>
        <button class="text-stone-400 active:text-amber-700 p-2 -mr-2" @click="showQueue = !showQueue">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </button>
      </div>

      <!-- MAIN CONTENT -->
      <div class="flex-1 flex flex-col px-8 overflow-hidden">

        <!-- QUEUE VIEW -->
        <div v-if="showQueue" class="flex-1 overflow-y-auto">
          <div class="text-xs font-medium uppercase tracking-widest text-stone-400 mb-4">Queue ({{ player.queue.length }})</div>
          <div
            v-for="(track, i) in player.queue" :key="i"
            class="flex items-center gap-3 py-3 border-b border-stone-100 last:border-0 cursor-pointer active:bg-stone-100 rounded px-2 -mx-2"
            :class="{ 'text-amber-700': i === player.currentIndex }"
            @click="player.jumpToQueue(i)"
          >
            <span class="text-xs text-stone-300 w-5 text-right flex-shrink-0">{{ i + 1 }}</span>
            <div class="flex-1 overflow-hidden">
              <div class="text-sm font-medium truncate">{{ track.title }}</div>
              <div class="text-xs text-stone-400 truncate">{{ track.artist }}</div>
            </div>
            <span class="text-xs text-stone-300 flex-shrink-0">{{ player.fmt(track.duration) }}</span>
          </div>
        </div>

        <!-- PLAYER VIEW -->
        <template v-else>

          <!-- ALBUM ART -->
          <div v-if="!lyricsView" class="flex-1 min-h-0 flex items-center justify-center py-2">
            <div class="w-full aspect-square max-h-full bg-amber-50 overflow-hidden shadow-2xl rounded-2xl">
              <img
                v-if="player.currentTrack?.coverArt"
                :src="coverUrl(player.currentTrack.coverArt, 600)"
                class="w-full h-full object-cover"
                @error="onImgError"
              />
              <div v-else class="w-full h-full flex items-center justify-center text-8xl">🎵</div>
            </div>
          </div>

          <!-- ART / LYRICS TOGGLE -->
          <div class="flex justify-center gap-1 mt-2 mb-1 flex-shrink-0">
            <button
              class="px-4 py-1 rounded-full text-xs font-medium transition-colors"
              :class="lyricsView ? 'bg-stone-100 text-stone-400' : 'bg-stone-900 text-white'"
              @click="lyricsView = false"
            >Art</button>
            <button
              class="px-4 py-1 rounded-full text-xs font-medium transition-colors"
              :class="lyricsView ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-400'"
              @click="openLyrics"
            >Lyrics</button>
          </div>

          <!-- LYRICS PANEL -->
          <div v-if="lyricsView" class="flex-1 overflow-y-auto py-2" ref="lyricsEl">
            <div v-if="lyricsLoading" class="flex items-center justify-center h-full text-stone-300 text-sm">Loading…</div>
            <template v-else-if="!lyrics">
              <div class="text-stone-300 text-sm text-center pt-12 pb-4">No lyrics found</div>
              <template v-if="addingLyrics">
                <textarea
                  v-model="manualLyricsText"
                  class="w-full text-sm text-stone-700 border border-stone-200 rounded p-3 outline-none focus:border-amber-700 resize-none leading-relaxed bg-white"
                  rows="10"
                  placeholder="Paste lyrics here…"
                ></textarea>
                <div class="flex gap-4 mt-3">
                  <button class="text-sm text-amber-700 font-medium" @click="saveLyricsManually">Save</button>
                  <button class="text-sm text-stone-400" @click="addingLyrics = false; manualLyricsText = ''">Cancel</button>
                </div>
              </template>
              <div v-else class="text-center">
                <button class="text-sm text-stone-400 hover:text-amber-700 transition-colors" @click="addingLyrics = true">+ Add lyrics manually</button>
              </div>
            </template>
            <template v-else-if="lyrics.synced">
              <p
                v-for="(line, i) in lyrics.synced"
                :key="i"
                :ref="el => { if (el) lineEls[i] = el }"
                class="text-center py-1 text-sm leading-relaxed transition-all duration-300"
                :class="i === activeLine ? 'text-stone-900 font-semibold text-base' : 'text-stone-300'"
              >{{ line.text }}</p>
            </template>
            <p v-else class="text-sm text-stone-500 leading-relaxed whitespace-pre-wrap text-center">{{ lyrics.plain }}</p>
          </div>

          <!-- TRACK INFO -->
          <div class="flex-shrink-0 mb-3">
            <div class="text-2xl font-semibold truncate">{{ player.currentTrack?.title }}</div>
            <div class="text-base text-stone-400 truncate mt-0.5">{{ player.currentTrack?.artist }}</div>
          </div>

          <!-- PROGRESS -->
          <div class="flex-shrink-0 mb-4">
            <div
              ref="progressEl"
              class="w-full h-1 bg-stone-200 rounded-full cursor-pointer mb-2"
              @click="handleSeek"
            >
              <div class="h-full bg-stone-900 rounded-full" :style="{ width: player.progressPct + '%' }"></div>
            </div>
            <div class="flex justify-between text-xs text-stone-400 tabular-nums">
              <span>{{ player.fmt(player.currentTime) }}</span>
              <span>{{ player.fmt(player.duration) }}</span>
            </div>
          </div>

          <!-- VOLUME -->
          <div class="flex-shrink-0 flex items-center gap-3 mb-4">
            <button class="text-stone-400 active:text-amber-700 p-1" @click="player.toggleMute()">
              <VolumeX v-if="player.volume === 0" :size="20" />
              <Volume1 v-else-if="player.volume < 0.5" :size="20" />
              <Volume2 v-else :size="20" />
            </button>
            <input
              type="range" min="0" max="1" step="0.01"
              :value="player.volume"
              @input="player.setVolume(+$event.target.value)"
              class="flex-1 cursor-pointer [accent-color:var(--accent)]"
            />
          </div>

          <!-- CONTROLS -->
          <div class="flex-shrink-0 mb-8">
            <div class="flex items-center justify-between mb-6">
              <div class="flex flex-col items-center gap-1">
                <button
                  class="p-2 transition-colors"
                  :class="player.shuffle ? 'text-amber-700' : 'text-stone-300'"
                  @click="player.shuffle = !player.shuffle"
                ><Shuffle :size="22" /></button>
                <span class="text-[10px] uppercase tracking-wide" :class="player.shuffle ? 'text-amber-700' : 'text-stone-300'">shuffle</span>
              </div>
              <button class="p-2 text-stone-700 active:text-amber-700" @click="player.prevTrack()">
                <SkipBack :size="32" />
              </button>
              <button
                class="w-20 h-20 rounded-full bg-stone-900 text-white flex items-center justify-center active:bg-amber-700 transition-colors shadow-lg"
                @click="player.togglePlay()"
              >
                <Pause v-if="player.isPlaying" :size="32" />
                <Play v-else :size="32" class="translate-x-0.5" />
              </button>
              <button class="p-2 text-stone-700 active:text-amber-700" @click="player.nextTrack()">
                <SkipForward :size="32" />
              </button>
              <div class="flex flex-col items-center gap-1">
                <button
                  class="p-2 transition-colors"
                  :class="player.repeat ? 'text-amber-700' : 'text-stone-300'"
                  @click="player.repeat = !player.repeat"
                ><Repeat :size="22" /></button>
                <span class="text-[10px] uppercase tracking-wide" :class="player.repeat ? 'text-amber-700' : 'text-stone-300'">repeat</span>
              </div>
            </div>
          </div>

        </template>
      </div>

    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { Shuffle, Repeat, Play, Pause, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-vue-next'
import { usePlayerStore } from '../stores/player'
import { coverUrl } from '../api/subsonic'
import { fetchLyrics, saveManualLyrics } from '../api/lyrics'

const props = defineProps({
  show: { type: Boolean, required: true }
})

const emit = defineEmits(['collapse'])

const player     = usePlayerStore()
const progressEl = ref(null)
const showQueue  = ref(false)
const lyricsView     = ref(false)
const lyrics         = ref(null)
const lyricsLoading  = ref(false)
const lyricsEl       = ref(null)
const lineEls        = ref([])
const addingLyrics   = ref(false)
const manualLyricsText = ref('')

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
  lyrics.value           = null
  lineEls.value          = []
  addingLyrics.value     = false
  manualLyricsText.value = ''
  if (lyricsView.value) loadLyrics()
})

async function openLyrics() {
  lyricsView.value = true
  if (!lyrics.value && player.currentTrack) await loadLyrics()
}

async function saveLyricsManually() {
  if (!player.currentTrack || !manualLyricsText.value.trim()) return
  saveManualLyrics(player.currentTrack.id, manualLyricsText.value)
  addingLyrics.value     = false
  manualLyricsText.value = ''
  await loadLyrics()
}

async function loadLyrics() {
  lyricsLoading.value = true
  lineEls.value = []
  try { lyrics.value = await fetchLyrics(player.currentTrack) }
  finally { lyricsLoading.value = false }
}

function handleSeek(event) {
  player.seek(event, progressEl.value)
}

function onImgError(e) {
  try { if (e?.target) e.target.style.display = 'none' } catch(_) {}
}
</script>

<style scoped>
.slide-up-enter-active, .slide-up-leave-active { transition: transform 0.3s ease; }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); }
</style>
