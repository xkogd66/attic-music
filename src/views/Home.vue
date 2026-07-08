<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div class="px-4 py-3 border-b border-stone-200 bg-white flex-shrink-0 md:hidden">
      <span class="text-sm font-semibold">Home</span>
    </div>
    <div class="flex-1 overflow-y-auto pb-40 md:pb-6">
      <div v-if="loading" class="flex items-center justify-center py-24 text-stone-400 text-sm">Loading…</div>
      <template v-else>

        <!-- Recently Added Artists -->
        <div v-if="recentArtists.length" class="pt-5 mb-6">
          <div class="px-4 text-xs font-medium uppercase tracking-widest text-stone-400 mb-3">Recently Added</div>
          <div class="w-full flex gap-3 overflow-x-auto px-4 pb-1" style="scrollbar-width:none;-ms-overflow-style:none">
            <div
              v-for="artist in recentArtists" :key="artist.id"
              class="flex-none cursor-pointer [width:calc(100%/3-8px)] md:w-36"
              @click="goToArtist(artist)"
            >
              <div class="aspect-square bg-stone-100 rounded-xl overflow-hidden mb-1.5 relative">
                <div class="w-full h-full flex items-center justify-center font-serif text-3xl font-semibold text-stone-300 select-none">{{ artist.name[0]?.toUpperCase() }}</div>
                <img :src="`/artist-images/avatar?name=${encodeURIComponent(artist.name)}`" :alt="artist.name" class="absolute inset-0 w-full h-full object-cover" @error="e => e.target.style.display='none'" />
              </div>
              <div class="text-xs font-medium truncate leading-tight text-center">{{ artist.name }}</div>
            </div>
          </div>
        </div>

        <!-- Discover Artists -->
        <div v-if="discoverArtists.length" class="mb-6">
          <div class="px-4 text-xs font-medium uppercase tracking-widest text-stone-400 mb-3">Discover Artists</div>
          <div class="w-full flex gap-3 overflow-x-auto px-4 pb-1" style="scrollbar-width:none;-ms-overflow-style:none">
            <div
              v-for="artist in discoverArtists" :key="artist.id"
              class="flex-none cursor-pointer [width:calc(100%/3-8px)] md:w-36"
              @click="goToArtist(artist)"
            >
              <div class="aspect-square bg-stone-100 rounded-xl overflow-hidden mb-1.5 relative">
                <div class="w-full h-full flex items-center justify-center font-serif text-3xl font-semibold text-stone-300 select-none">{{ artist.name[0]?.toUpperCase() }}</div>
                <img :src="`/artist-images/avatar?name=${encodeURIComponent(artist.name)}`" :alt="artist.name" class="absolute inset-0 w-full h-full object-cover" @error="e => e.target.style.display='none'" />
              </div>
              <div class="text-xs font-medium truncate leading-tight text-center">{{ artist.name }}</div>
            </div>
          </div>
        </div>

        <!-- Discover Albums -->
        <div v-if="discoverAlbums.length" class="mb-6">
          <div class="px-4 text-xs font-medium uppercase tracking-widest text-stone-400 mb-3">Discover Albums</div>
          <div class="w-full flex gap-3 overflow-x-auto px-4 pb-1" style="scrollbar-width:none;-ms-overflow-style:none">
            <div
              v-for="album in discoverAlbums" :key="album.id"
              class="flex-none cursor-pointer [width:calc(100%/3-8px)] md:w-36"
              @click="goToAlbum(album)"
            >
              <div class="aspect-square bg-amber-50 rounded-xl overflow-hidden mb-1.5 relative">
                <div class="w-full h-full flex items-center justify-center text-3xl">💿</div>
                <img :src="coverUrl(album.coverArt || album.id)" :alt="album.name" class="absolute inset-0 w-full h-full object-cover" @error="e => e.target.style.display='none'" />
              </div>
              <div class="text-xs font-medium truncate leading-tight">{{ album.name }}</div>
              <div class="text-xs text-stone-400 truncate">{{ album.albumArtist || album.artist }}</div>
            </div>
          </div>
        </div>

      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getArtists, getNewestAlbums, getRandomAlbums, coverUrl } from '../api/subsonic'

const router = useRouter()

const loading         = ref(true)
const recentArtists   = ref([])
const discoverArtists = ref([])
const discoverAlbums  = ref([])

function goToArtist(artist) {
  router.push({ name: 'artist-detail', params: { id: artist.id } })
}

function goToAlbum(album) {
  router.push({ name: 'album-detail', params: { id: album.id } })
}

onMounted(async () => {
  try {
    const [index, newestAlbums, randomAlbums] = await Promise.all([
      getArtists(),
      getNewestAlbums(100),
      getRandomAlbums(20).catch(() => []),
    ])

    const all = index.flatMap(g => g.artist)
    discoverArtists.value = [...all].sort(() => Math.random() - 0.5).slice(0, 20)

    const seen = new Set()
    const artists = []
    for (const album of newestAlbums) {
      if (album.artistId && !seen.has(album.artistId)) {
        seen.add(album.artistId)
        artists.push({ id: album.artistId, name: album.albumArtist || album.artist })
        if (artists.length >= 20) break
      }
    }
    recentArtists.value  = artists
    discoverAlbums.value = randomAlbums
  } finally {
    loading.value = false
  }
})
</script>
