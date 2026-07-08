<template>
  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">

    <!-- ALBUM LIST -->
    <template v-if="!currentAlbum">
      <div class="px-4 md:px-6 py-3 md:py-6 border-b border-stone-200 bg-white flex-shrink-0">
        <h1 class="font-serif hidden md:block text-3xl font-semibold mb-3">Albums</h1>
        <div v-if="albums.length" class="flex items-center gap-2 flex-wrap">
          <input
            v-model="albumQuery"
            type="search"
            placeholder="Search albums…"
            class="flex-1 min-w-0 text-sm bg-stone-100 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-amber-700 md:hidden"
          />

          <!-- Genre -->
          <div v-if="distinctGenres.length" class="relative">
            <div v-if="showGenreDropdown" class="fixed inset-0 z-10" @click="showGenreDropdown = false"></div>
            <button
              class="relative z-20 text-xs border px-2.5 py-1.5 rounded transition-all"
              :class="filterGenre ? 'border-amber-700 text-amber-700 bg-amber-50' : 'border-stone-200 text-stone-400 hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50'"
              @click="showGenreDropdown = !showGenreDropdown; showYearDropdown = false"
            >{{ filterGenre || 'Genre' }} ▾</button>
            <div v-if="showGenreDropdown" class="absolute top-full left-0 mt-1 bg-white border border-stone-200 shadow-md rounded z-20 min-w-[130px] max-h-60 overflow-y-auto">
              <button
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="!filterGenre ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="filterGenre = null; showGenreDropdown = false"
              >All genres</button>
              <button
                v-for="g in distinctGenres" :key="g"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="filterGenre === g ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="filterGenre = g; showGenreDropdown = false"
              >{{ g }}</button>
            </div>
          </div>

          <!-- Year -->
          <div v-if="distinctYears.length" class="relative">
            <div v-if="showYearDropdown" class="fixed inset-0 z-10" @click="showYearDropdown = false"></div>
            <button
              class="relative z-20 text-xs border px-2.5 py-1.5 rounded transition-all"
              :class="filterYear ? 'border-amber-700 text-amber-700 bg-amber-50' : 'border-stone-200 text-stone-400 hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50'"
              @click="showYearDropdown = !showYearDropdown; showGenreDropdown = false"
            >{{ filterYear || 'Year' }} ▾</button>
            <div v-if="showYearDropdown" class="absolute top-full left-0 mt-1 bg-white border border-stone-200 shadow-md rounded z-20 min-w-[80px] max-h-60 overflow-y-auto">
              <button
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="!filterYear ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="filterYear = null; showYearDropdown = false"
              >All years</button>
              <button
                v-for="y in distinctYears" :key="y"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="filterYear === y ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="filterYear = y; showYearDropdown = false"
              >{{ y }}</button>
            </div>
          </div>

          <button
            v-if="filterGenre || filterYear || albumQuery"
            class="text-xs text-stone-400 hover:text-amber-700 transition-colors"
            @click="filterGenre = null; filterYear = null; albumQuery = ''"
          >Clear</button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto pb-40 md:pb-24">

        <!-- RECENTLY ADDED CAROUSEL -->
        <div v-if="recentAlbums.length" class="px-4 pt-5 pb-4 border-b border-stone-100"
          :class="{ 'hidden md:block': albumQuery || filterGenre || filterYear }">
          <div class="text-xs font-medium uppercase tracking-widest text-stone-400 mb-3">Recently Added</div>
          <div class="relative">
            <button
              v-if="canScrollLeft"
              class="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 z-10 w-7 h-7 rounded-full bg-white shadow-md border border-stone-200 items-center justify-center text-stone-500 hover:text-amber-700 transition-colors"
              @click="scrollCarousel(-1)"
            >‹</button>
            <div ref="carousel" class="w-full flex gap-3 overflow-x-auto scroll-smooth" style="scrollbar-width:none;-ms-overflow-style:none" @scroll="onCarouselScroll">
              <div
                v-for="album in recentAlbums" :key="album.id"
                class="flex-shrink-0 cursor-pointer group [width:calc(100%/3-8px)] md:w-36"
                @click="openAlbum(album)"
              >
                <div class="aspect-square bg-amber-50 mb-1.5 overflow-hidden relative rounded-lg">
                  <div class="w-full h-full flex items-center justify-center text-3xl">💿</div>
                  <img :src="coverUrl(album.coverArt || album.id)" :alt="album.name" class="absolute inset-0 w-full h-full object-cover" @error="onAlbumCoverError($event, album)" />
                  <div class="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                    <button class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-sm pl-0.5" @click.stop="playAlbum(album)">▶</button>
                  </div>
                </div>
                <div class="text-xs font-medium truncate leading-tight">{{ album.name }}</div>
                <div class="text-xs text-stone-400 truncate mt-0.5">{{ album.artist }}</div>
              </div>
            </div>
            <button
              v-if="canScrollRight"
              class="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 w-7 h-7 rounded-full bg-white shadow-md border border-stone-200 items-center justify-center text-stone-500 hover:text-amber-700 transition-colors"
              @click="scrollCarousel(1)"
            >›</button>
          </div>
        </div>

        <!-- DISCOVER -->
        <div v-if="discoverAlbums.length" class="px-4 pt-5 pb-4 border-b border-stone-100"
          :class="{ 'hidden md:block': albumQuery || filterGenre || filterYear }">
          <div class="text-xs font-medium uppercase tracking-widest text-stone-400 mb-3">Discover</div>
          <div class="w-full flex gap-3 overflow-x-auto" style="scrollbar-width:none;-ms-overflow-style:none">
            <div
              v-for="album in discoverAlbums" :key="album.id"
              class="flex-shrink-0 cursor-pointer group [width:calc(100%/3-8px)] md:w-36"
              @click="openAlbum(album)"
            >
              <div class="aspect-square bg-amber-50 mb-1.5 overflow-hidden relative rounded-lg">
                <div class="w-full h-full flex items-center justify-center text-3xl">💿</div>
                <img :src="coverUrl(album.coverArt || album.id)" :alt="album.name" class="absolute inset-0 w-full h-full object-cover" @error="onAlbumCoverError($event, album)" />
                <div class="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                  <button class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-sm pl-0.5" @click.stop="playAlbum(album)">▶</button>
                </div>
              </div>
              <div class="text-xs font-medium truncate leading-tight">{{ album.name }}</div>
              <div class="text-xs text-stone-400 truncate mt-0.5">{{ album.albumArtist || album.artist }}</div>
            </div>
          </div>
        </div>

        <!-- ALL ALBUMS GRID -->
        <div class="px-4 py-4"
          :class="{ 'hidden md:block': !albumQuery && !filterGenre && !filterYear }">
          <div v-if="loading && !albums.length" class="flex items-center justify-center py-24 text-stone-400 text-sm">Loading…</div>
          <div v-else-if="!albums.length" class="flex flex-col items-center justify-center py-24 text-stone-400 gap-2">
            <span class="text-4xl">💿</span>
            <span class="font-serif text-lg">No albums found</span>
          </div>
          <div v-else-if="!filteredAlbums.length" class="flex items-center justify-center py-24 text-stone-400 text-sm">No albums match the filter.</div>
          <div v-else class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(100px, 1fr))">
            <div
              v-for="album in filteredAlbums" :key="album.id"
              class="cursor-pointer group"
              @click="openAlbum(album)"
            >
              <div class="aspect-square bg-amber-50 mb-1.5 overflow-hidden relative rounded-lg">
                <div class="w-full h-full flex items-center justify-center text-3xl">💿</div>
                <img :src="coverUrl(album.coverArt || album.id)" :alt="album.name" class="absolute inset-0 w-full h-full object-cover" @error="onAlbumCoverError($event, album)" />
                <div class="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                  <button
                    class="w-9 h-9 rounded-full bg-white flex items-center justify-center text-sm pl-0.5"
                    @click.stop="playAlbum(album)"
                  >▶</button>
                </div>
              </div>
              <div class="text-xs font-medium truncate leading-tight">{{ album.name }}</div>
              <div class="text-xs text-stone-400 truncate mt-0.5">
                <button class="text-stone-400 hover:text-amber-700" @click.stop="openArtistByName(album.artist, $event)">{{ album.artist }}</button>
              </div>
            </div>
          </div>
          <div ref="sentinel" class="h-8"></div>
          <div v-if="loading && albums.length" class="flex items-center justify-center py-4 text-stone-400 text-sm">Loading…</div>
        </div>


      </div>
    </template>

    <!-- ALBUM DETAIL -->
    <template v-else>
      <div class="px-6 py-6 border-b border-stone-200 bg-white flex-shrink-0">
        <div class="flex items-center gap-1.5 text-xs text-stone-400 mb-1">
          <span class="cursor-pointer hover:text-amber-700 transition-colors" @click="closeAlbum">Albums</span>
          <span class="opacity-40">›</span>
          <span class="truncate">{{ displayTitle }}</span>
        </div>
        <div class="flex items-center gap-2">
          <h1 class="font-serif text-3xl font-semibold">{{ displayTitle }}</h1>
          <button class="flex-shrink-0 inline-flex items-center gap-1 border border-stone-300 text-stone-600 text-xs px-2.5 py-1 rounded-full hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50 transition-colors" title="Edit album tags" @click="openTagEditor">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z" /></svg>
            Edit
          </button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-40 md:pb-24">
        <div v-if="loading" class="flex items-center justify-center py-24 text-stone-400 text-sm">Loading…</div>
        <div v-else>
          <div class="flex gap-4 mb-6 items-end">
            <div class="w-28 h-28 flex-shrink-0 bg-amber-50 overflow-hidden rounded-lg shadow-md relative">
              <div class="w-full h-full flex items-center justify-center text-4xl">💿</div>
              <img v-if="albumDetailCoverSrc && albumDetailCoverState !== 'failed'"
                :src="albumDetailCoverSrc"
                :alt="currentAlbum.name"
                class="absolute inset-0 w-full h-full object-cover"
                @error="onAlbumDetailCoverError"
              />
              <button v-if="albumDetailCoverState === 'failed'"
                class="absolute inset-0 flex flex-col items-center justify-center cursor-pointer gap-1"
                title="Search web for cover art"
                @click="openCoverSearch"
              >
                <span class="text-xs text-stone-400 font-medium">Add cover</span>
              </button>
            </div>
            <div class="flex-1 overflow-hidden">
              <div class="text-xs uppercase tracking-widest text-stone-400 mb-1">
                {{ ['Album', displayYear].filter(Boolean).join(' · ') }}<span v-if="displayGenre"> · {{ displayGenre }}</span>
              </div>
              <div class="font-serif text-xl font-semibold leading-tight mb-0.5">{{ displayTitle }}</div>
              <div class="text-sm text-stone-400 mb-3 truncate">
                <button class="hover:text-amber-700 transition-colors" @click="openArtistByName(displayArtist, $event)">{{ displayArtist }}</button>
              </div>
              <div class="flex gap-2">
                <button class="bg-stone-900 text-white text-xs font-medium px-4 py-2 rounded-full hover:bg-amber-700 transition-colors" @click="playAlbumTracks">▶ Play</button>
                <button class="border border-stone-200 text-xs px-4 py-2 rounded-full hover:border-amber-700 hover:text-amber-700 transition-colors" @click="queueAlbumTracks">+ Queue</button>
              </div>
            </div>
          </div>
          <div class="grid gap-2 text-xs uppercase tracking-widest text-stone-400 px-3 pb-2 border-b border-stone-200 mb-1"
            style="grid-template-columns: 28px 1fr 44px 56px">
            <span class="text-center">#</span><span>Title</span><span>Time</span><span></span>
          </div>
          <TrackItem
            v-for="(track, i) in albumTracks" :key="track.id"
            :track="track"
            :index="i"
            editable
            @play="player.playTrack(track, albumTracks, i)"
            @queue="player.addToQueue(track)"
            @edit="openTrackEditor"
          />
        </div>
      </div>
    </template>

    <!-- Tag edit modal -->
    <Teleport to="body">
      <div v-if="editTagsOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="closeTagEditor">
        <div class="bg-white w-full max-w-sm mx-4 shadow-xl">
          <div class="px-6 py-4 border-b border-stone-200">
            <h2 class="font-serif text-lg font-semibold">Edit Album Tags</h2>
          </div>
          <div class="px-6 py-5 space-y-4">
            <div>
              <label class="block text-xs uppercase tracking-widest text-stone-400 mb-1.5">Title</label>
              <input v-model="tagEdits.title" class="w-full border-b border-stone-300 py-1 text-sm bg-transparent outline-none focus:border-amber-700 transition-colors" placeholder="Album title…" />
            </div>
            <div>
              <label class="block text-xs uppercase tracking-widest text-stone-400 mb-1.5">Artist</label>
              <input v-model="tagEdits.artist" class="w-full border-b border-stone-300 py-1 text-sm bg-transparent outline-none focus:border-amber-700 transition-colors" placeholder="Artist…" />
            </div>
            <div>
              <label class="block text-xs uppercase tracking-widest text-stone-400 mb-1.5">Album Artist</label>
              <input v-model="tagEdits.albumArtist" class="w-full border-b border-stone-300 py-1 text-sm bg-transparent outline-none focus:border-amber-700 transition-colors" placeholder="Album artist…" />
            </div>
            <div>
              <label class="block text-xs uppercase tracking-widest text-stone-400 mb-1.5">Year</label>
              <input v-model="tagEdits.year" type="text" inputmode="numeric" maxlength="4" class="w-full border-b border-stone-300 py-1 text-sm bg-transparent outline-none focus:border-amber-700 transition-colors" placeholder="e.g. 1994" />
            </div>
            <div class="relative">
              <label class="block text-xs uppercase tracking-widest text-stone-400 mb-1.5">Genre</label>
              <input v-model="tagEdits.genre"
                class="w-full border-b border-stone-300 py-1 text-sm bg-transparent outline-none focus:border-amber-700 transition-colors"
                placeholder="Genre…"
                @focus="showTagGenreList = true"
                @input="showTagGenreList = true"
                @keydown.escape="showTagGenreList = false"
              />
              <div v-if="showTagGenreList && filteredTagGenreList.length" class="absolute top-full left-0 mt-1 bg-white border border-stone-200 shadow-lg z-20 w-full max-h-40 overflow-y-auto">
                <button v-for="g in filteredTagGenreList" :key="g"
                  class="block w-full text-left px-3 py-1.5 text-xs text-stone-600 hover:bg-amber-50 hover:text-amber-700"
                  @mousedown.prevent="tagEdits.genre = g; showTagGenreList = false">{{ g }}</button>
              </div>
            </div>
          </div>
          <div class="px-6 py-4 border-t border-stone-200 flex justify-end items-center gap-3">
            <span v-if="tagSaveError" class="text-xs text-red-500 mr-auto">{{ tagSaveError }}</span>
            <button class="text-sm text-stone-400 hover:text-stone-600 transition-colors disabled:opacity-50" :disabled="tagSaving" @click="closeTagEditor">Cancel</button>
            <button class="bg-stone-900 text-white text-sm px-5 py-1.5 hover:bg-amber-700 transition-colors disabled:opacity-50" :disabled="tagSaving" @click="saveTagEdits">{{ tagSaving ? 'Saving…' : 'Save' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Track tag edit modal -->
    <Teleport to="body">
      <div v-if="editTrackOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="closeTrackEditor">
        <div class="bg-white w-full max-w-sm mx-4 shadow-xl">
          <div class="px-6 py-4 border-b border-stone-200">
            <h2 class="font-serif text-lg font-semibold">Edit Track Tags</h2>
          </div>
          <div class="px-6 py-5 space-y-4">
            <div>
              <label class="block text-xs uppercase tracking-widest text-stone-400 mb-1.5">Title</label>
              <input v-model="trackEdits.title" class="w-full border-b border-stone-300 py-1 text-sm bg-transparent outline-none focus:border-amber-700 transition-colors" placeholder="Track title…" />
            </div>
            <div>
              <label class="block text-xs uppercase tracking-widest text-stone-400 mb-1.5">Artist</label>
              <input v-model="trackEdits.artist" class="w-full border-b border-stone-300 py-1 text-sm bg-transparent outline-none focus:border-amber-700 transition-colors" placeholder="Track artist…" />
            </div>
            <div>
              <label class="block text-xs uppercase tracking-widest text-stone-400 mb-1.5">Track #</label>
              <input v-model="trackEdits.track" type="number" class="w-full border-b border-stone-300 py-1 text-sm bg-transparent outline-none focus:border-amber-700 transition-colors" placeholder="e.g. 3" />
            </div>
          </div>
          <div class="px-6 py-4 border-t border-stone-200 flex justify-end items-center gap-3">
            <span v-if="trackSaveError" class="text-xs text-red-500 mr-auto">{{ trackSaveError }}</span>
            <button class="text-sm text-stone-400 hover:text-stone-600 transition-colors disabled:opacity-50" :disabled="trackSaving" @click="closeTrackEditor">Cancel</button>
            <button class="bg-stone-900 text-white text-sm px-5 py-1.5 hover:bg-amber-700 transition-colors disabled:opacity-50" :disabled="trackSaving" @click="saveTrackEdits">{{ trackSaving ? 'Saving…' : 'Save' }}</button>
          </div>
        </div>
      </div>

      <!-- Cover search modal -->
      <div v-if="coverSearchOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="closeCoverSearch">
        <div class="bg-white w-full max-w-md shadow-xl rounded-xl flex flex-col max-h-[80vh]">
          <div class="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
            <h3 class="font-serif text-lg font-semibold">Pick a cover</h3>
            <button class="text-stone-400 hover:text-stone-700" @click="closeCoverSearch">✕</button>
          </div>
          <div class="px-5 py-4 overflow-y-auto">
            <div v-if="coverSearchLoading" class="py-10 text-center text-stone-400 text-sm">Searching…</div>
            <div v-else-if="!coverCandidates.length" class="py-10 text-center text-stone-400 text-sm">No covers found.</div>
            <div v-else class="grid grid-cols-3 gap-3">
              <button v-for="(c, i) in coverCandidates" :key="i"
                class="relative aspect-square rounded-lg overflow-hidden border border-stone-200 hover:border-amber-600 focus:border-amber-600 disabled:opacity-40 transition-colors"
                :disabled="coverSaving"
                @click="chooseCover(c)"
              >
                <img :src="c.url" class="absolute inset-0 w-full h-full object-cover" loading="lazy" @error="$event.target.closest('button').style.display='none'" />
                <span class="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] py-0.5 text-center">{{ c.source }}</span>
              </button>
            </div>
          </div>
          <div class="px-5 py-3 border-t border-stone-100 flex items-center justify-between">
            <label class="text-xs text-stone-500 hover:text-amber-700 cursor-pointer">
              Upload from device
              <input type="file" accept="image/*" class="hidden" @change="uploadAlbumCover" />
            </label>
            <button class="text-xs px-4 py-2 rounded-full border border-stone-200 hover:border-stone-400 transition-colors" @click="closeCoverSearch">Cancel</button>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../stores/player'
import { getAlbumPage, getNewestAlbums, getRandomAlbums, getAlbum, coverUrl, getArtists, startScan } from '../api/subsonic'
import { saveAlbumTags, saveTrackTags } from '../api/tags'
import { searchAlbumCovers } from '../api/covers'
import { GENRES } from '../api/genres'
import TrackItem from '../components/TrackItem.vue'

const route  = useRoute()
const router = useRouter()
const player = usePlayerStore()


const loading        = ref(false)
const albums         = ref([])
const recentAlbums   = ref([])
const discoverAlbums = ref([])
const currentAlbum = ref(null)
const albumTracks  = ref([])
const albumDetailCoverSrc   = ref(null)
const albumDetailCoverState = ref('loading') // 'loading' | 'sidecar' | 'failed'

const coverSearchOpen    = ref(false)
const coverSearchLoading = ref(false)
const coverCandidates    = ref([])
const coverSaving        = ref(false)

const TAGS_PREFIX  = 'attic_tags_'
const GENRE_PREFIX = 'attic_genre_'
const tagsVersion  = ref(0)

const editTagsOpen     = ref(false)
const showTagGenreList = ref(false)
const tagEdits = reactive({ title: '', artist: '', albumArtist: '', year: '', genre: '' })
const tagSaving    = ref(false)
const tagSaveError = ref('')

const editTrackOpen  = ref(false)
const trackEdits     = reactive({ title: '', artist: '', track: '' })
const trackSaving    = ref(false)
const trackSaveError = ref('')
let   editingTrack   = null

function readAlbumTags(id) {
  try { const raw = localStorage.getItem(TAGS_PREFIX + id); return raw ? JSON.parse(raw) : {} } catch { return {} }
}

const albumTags = computed(() => {
  tagsVersion.value
  return currentAlbum.value?.id ? readAlbumTags(currentAlbum.value.id) : {}
})

const displayTitle  = computed(() => albumTags.value.title  || currentAlbum.value?.name   || '')
const displayArtist = computed(() => albumTags.value.artist || currentAlbum.value?.artist  || '')
const displayYear   = computed(() => albumTags.value.year   || currentAlbum.value?.year    || null)
const displayGenre  = computed(() => {
  if (albumTags.value.genre) return albumTags.value.genre
  try { const g = localStorage.getItem(GENRE_PREFIX + currentAlbum.value?.id); if (g) return g } catch {}
  return currentAlbum.value?.genre || null
})

const filteredTagGenreList = computed(() => {
  const q = tagEdits.genre.toLowerCase().trim()
  return q ? GENRES.filter(g => g.toLowerCase().includes(q)) : GENRES
})

// The on-disk folder identity (album artist + album name as indexed). The sidecar
// locates the folder by this, and it does NOT change when tags are edited.
function albumDiskIdentity() {
  const al = currentAlbum.value
  const tags = readAlbumTags(al.id)
  return {
    artist: tags._diskArtist || al.albumArtist || al.artist || '',
    album:  tags._diskAlbum  || al.name || '',
  }
}

function openTagEditor() {
  if (!currentAlbum.value) return
  tagEdits.title       = displayTitle.value
  tagEdits.artist      = albumTags.value.artist || currentAlbum.value.artist || ''
  tagEdits.albumArtist = albumTags.value.albumArtist || currentAlbum.value.albumArtist || currentAlbum.value.artist || ''
  tagEdits.year        = displayYear.value ? String(displayYear.value) : ''
  tagEdits.genre       = displayGenre.value || ''
  tagSaveError.value = ''
  showTagGenreList.value = false
  editTagsOpen.value = true
}

function closeTagEditor() {
  editTagsOpen.value = false
  showTagGenreList.value = false
}

async function saveTagEdits() {
  if (!currentAlbum.value || tagSaving.value) return
  const al = currentAlbum.value
  const id = al.id
  const title       = tagEdits.title.trim()
  const artist      = tagEdits.artist.trim()
  const albumArtist = tagEdits.albumArtist.trim()
  const year        = parseInt(tagEdits.year) || null
  let   genre       = tagEdits.genre.trim()
  // Restrict genre to the curated list — no free-text "bullshit genres".
  if (genre) {
    const canon = GENRES.find(g => g.toLowerCase() === genre.toLowerCase())
    if (!canon) { tagSaveError.value = 'Pick a genre from the list.'; return }
    genre = canon
  }
  const { artist: diskArtist, album: diskAlbum } = albumDiskIdentity()

  tagSaveError.value = ''
  tagSaving.value = true
  try {
    await saveAlbumTags(diskArtist, diskAlbum, {
      title:       title       || undefined,
      artist:      artist      || undefined,
      albumArtist: albumArtist || undefined,
      year:        year        || undefined,
      genre:       genre       || undefined,
    })
    await startScan().catch(() => {})
  } catch (e) {
    tagSaveError.value = 'Save failed — ' + (e?.message || 'server unreachable')
    tagSaving.value = false
    return
  }

  // Local override for instant feedback until Gonic finishes re-indexing.
  const updated = { ...readAlbumTags(id) }
  if (title  && title  !== al.name)   updated.title  = title;  else delete updated.title
  if (artist && artist !== al.artist) updated.artist = artist; else delete updated.artist
  if (albumArtist && albumArtist !== (al.albumArtist || al.artist)) updated.albumArtist = albumArtist; else delete updated.albumArtist
  if (year   && year   !== al.year)   updated.year   = year;   else delete updated.year
  if (genre) updated.genre = genre; else delete updated.genre
  updated._diskArtist = diskArtist
  updated._diskAlbum  = diskAlbum
  try { localStorage.setItem(TAGS_PREFIX + id, JSON.stringify(updated)) } catch {}
  tagsVersion.value++
  tagSaving.value = false
  closeTagEditor()
}

function openTrackEditor(track) {
  editingTrack = track
  trackEdits.title  = track.title  || ''
  trackEdits.artist = track.artist || ''
  trackEdits.track  = track.track ? String(track.track) : ''
  trackSaveError.value = ''
  editTrackOpen.value = true
}

function closeTrackEditor() {
  editTrackOpen.value = false
  editingTrack = null
}

async function saveTrackEdits() {
  if (!editingTrack || !currentAlbum.value || trackSaving.value) return
  const track  = editingTrack
  const title  = trackEdits.title.trim()
  const artist = trackEdits.artist.trim()
  const num    = parseInt(trackEdits.track) || null
  const file   = (track.path || '').split('/').pop()
  if (!file) { trackSaveError.value = 'Track file path unavailable.'; return }
  const { artist: diskArtist, album: diskAlbum } = albumDiskIdentity()

  trackSaveError.value = ''
  trackSaving.value = true
  try {
    await saveTrackTags(diskArtist, diskAlbum, file, {
      title:  title  || undefined,
      artist: artist || undefined,
      track:  num    || undefined,
    })
    await startScan().catch(() => {})
  } catch (e) {
    trackSaveError.value = 'Save failed — ' + (e?.message || 'server unreachable')
    trackSaving.value = false
    return
  }

  if (title)  track.title  = title
  if (artist) track.artist = artist
  if (num)    track.track  = num
  trackSaving.value = false
  closeTrackEditor()
}

const filterGenre       = ref(null)
const filterYear        = ref(null)
const albumQuery        = ref('')
const showGenreDropdown = ref(false)
const showYearDropdown  = ref(false)

const distinctGenres = computed(() => {
  const genres = [...new Set(albums.value.map(a => a.genre).filter(Boolean))]
  return genres.sort()
})

const distinctYears = computed(() => {
  const years = [...new Set(albums.value.map(a => a.year).filter(Boolean))]
  return years.sort((a, b) => b - a)
})

const filteredAlbums = computed(() => {
  return albums.value.filter(a => {
    if (filterGenre.value && a.genre !== filterGenre.value) return false
    if (filterYear.value  && a.year  !== filterYear.value)  return false
    if (albumQuery.value  && !a.name.toLowerCase().includes(albumQuery.value.toLowerCase())) return false
    return true
  })
})

const sentinel   = ref(null)
const allLoaded  = ref(false)
const pageSize   = 100
let   pageOffset = 0
let   observer   = null

const carousel      = ref(null)
const canScrollLeft  = ref(false)
const canScrollRight = ref(false)

function onCarouselScroll() {
  if (!carousel.value) return
  canScrollLeft.value  = carousel.value.scrollLeft > 0
  canScrollRight.value = carousel.value.scrollLeft + carousel.value.clientWidth < carousel.value.scrollWidth - 1
}

function scrollCarousel(dir) {
  if (!carousel.value) return
  carousel.value.scrollBy({ left: dir * 320, behavior: 'smooth' })
}

async function loadRecent() {
  const [recent, random] = await Promise.all([getNewestAlbums(20), getRandomAlbums(20)])
  recentAlbums.value   = recent
  discoverAlbums.value = random
  await nextTick()
  onCarouselScroll()
}

async function loadAlbums() {
  albums.value = []
  allLoaded.value = false
  pageOffset = 0
  await loadMore()
  await nextTick()
  setupObserver()
}

async function loadMore() {
  if (loading.value || allLoaded.value) return
  loading.value = true
  try {
    const page = await getAlbumPage(pageSize, pageOffset)
    albums.value.push(...page)
    if (page.length < pageSize) allLoaded.value = true
    else pageOffset += pageSize
  } finally {
    loading.value = false
  }
}

function setupObserver() {
  if (observer) observer.disconnect()
  if (!sentinel.value) return
  observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadMore()
  }, { threshold: 0.1 })
  observer.observe(sentinel.value)
}

async function openAlbum(album) {
  loading.value = true
  albumDetailCoverState.value = 'loading'
  router.push({ name: 'album-detail', params: { id: album.id } })
  try {
    const data = await getAlbum(album.id)
    currentAlbum.value = { ...album, ...data.info }
    albumTracks.value  = data.tracks
    albumDetailCoverSrc.value = coverUrl(currentAlbum.value.coverArt || currentAlbum.value.id)
  } finally { loading.value = false }
}

async function playAlbum(album) {
  await openAlbum(album)
  playAlbumTracks()
}

function playAlbumTracks() {
  if (!albumTracks.value.length) return
  player.playTrack(albumTracks.value[0], albumTracks.value, 0)
}

function queueAlbumTracks() {
  player.queue.push(...albumTracks.value)
}

async function openArtistByName(name, e) {
  if (e && e.stopPropagation) e.stopPropagation()
  try {
    const idx = await getArtists()
    for (const g of idx) {
      for (const a of g.artist) {
        if (a.name === name) {
          router.push({ name: 'artist-detail', params: { id: a.id } })
          return
        }
      }
    }
  } catch (err) {
    // ignore
  }
  router.push({ name: 'artists' })
}

function closeAlbum() {
  currentAlbum.value = null
  router.push({ name: 'albums' })
}

function onAlbumCoverError(e, album) {
  const img = e.target
  if (!img.dataset.triedSidecar) {
    img.dataset.triedSidecar = '1'
    const artist = album.albumArtist || album.artist
    img.src = `/artist-images/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album.name)}`
  } else {
    img.style.display = 'none'
  }
}

onMounted(async () => {
  loadRecent()
  await loadAlbums()
  if (route.params.id) {
    const album = albums.value.find(a => a.id === route.params.id)
    if (album) openAlbum(album)
    else openAlbumById(route.params.id)
  }
})

onUnmounted(() => {
  if (observer) observer.disconnect()
})

async function openAlbumById(id) {
  loading.value = true
  albumDetailCoverState.value = 'loading'
  router.push({ name: 'album-detail', params: { id } })
  try {
    const data = await getAlbum(id)
    currentAlbum.value = data.info
    albumTracks.value  = data.tracks
    albumDetailCoverSrc.value = coverUrl(currentAlbum.value.coverArt || currentAlbum.value.id)
  } finally { loading.value = false }
}

function onAlbumDetailCoverError() {
  if (albumDetailCoverState.value === 'loading') {
    const artist = currentAlbum.value.albumArtist || currentAlbum.value.artist
    albumDetailCoverSrc.value = `/artist-images/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(currentAlbum.value.name)}`
    albumDetailCoverState.value = 'sidecar'
  } else {
    albumDetailCoverState.value = 'failed'
  }
}

async function uploadAlbumCover(e) {
  const file = e.target.files[0]
  if (!file || !currentAlbum.value) return
  const artist = currentAlbum.value.albumArtist || currentAlbum.value.artist
  const album  = currentAlbum.value.name
  const form = new FormData()
  form.append('cover', file)
  const res = await fetch(
    `/artist-images/upload?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`,
    { method: 'POST', body: form }
  )
  if (res.ok) {
    albumDetailCoverSrc.value = `/artist-images/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&t=${Date.now()}`
    albumDetailCoverState.value = 'sidecar'
    coverSearchOpen.value = false
  }
}

// Save a chosen remote cover: pull its bytes (both CDNs allow CORS) and re-POST
// to the sidecar /upload, same as a device upload.
async function chooseCover(c) {
  if (!currentAlbum.value || coverSaving.value) return
  coverSaving.value = true
  const artist = currentAlbum.value.albumArtist || currentAlbum.value.artist
  const album  = currentAlbum.value.name
  try {
    const blob = await (await fetch(c.url)).blob()
    const form = new FormData()
    form.append('cover', blob, 'cover.jpg')
    const res = await fetch(
      `/artist-images/upload?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`,
      { method: 'POST', body: form }
    )
    if (res.ok) {
      albumDetailCoverSrc.value = `/artist-images/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&t=${Date.now()}`
      albumDetailCoverState.value = 'sidecar'
      coverSearchOpen.value = false
    }
  } catch (_) {
    /* leave modal open so the user can pick another */
  } finally {
    coverSaving.value = false
  }
}

async function openCoverSearch() {
  if (!currentAlbum.value) return
  coverSearchOpen.value = true
  coverSearchLoading.value = true
  coverCandidates.value = []
  const artist = currentAlbum.value.albumArtist || currentAlbum.value.artist
  const album  = currentAlbum.value.name
  try {
    coverCandidates.value = await searchAlbumCovers(artist, album)
  } finally {
    coverSearchLoading.value = false
  }
}

function closeCoverSearch() {
  coverSearchOpen.value = false
}

watch(() => route.params.id, (id) => {
  if (!id) {
    currentAlbum.value = null
  } else {
    const album = albums.value.find(a => a.id === id)
    if (album) openAlbum(album)
    else openAlbumById(id)
  }
})
</script>