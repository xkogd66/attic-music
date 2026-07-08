<template>
  <div class="flex flex-col h-full overflow-hidden">

    <!-- ARTISTS GRID -->
    <template v-if="view === 'grid'">

      <!-- ── DESKTOP HEADER (letter nav + filters) ── -->
      <div class="hidden md:block border-b border-stone-200 bg-white flex-shrink-0">
        <div class="px-8 pt-7 pb-3">
          <h1 class="font-serif text-4xl font-semibold mb-3">Artists</h1>
          <div v-if="!loading" class="flex items-center gap-2 flex-wrap">
            <!-- Genre -->
            <div v-if="distinctGenres.length" class="relative">
              <div v-if="showGenreDropdown" class="fixed inset-0 z-10" @click="showGenreDropdown = false"></div>
              <button
                class="relative z-20 text-xs border px-2.5 py-1.5 rounded transition-all"
                :class="filterGenre ? 'border-amber-700 text-amber-700 bg-amber-50' : 'border-stone-200 text-stone-400 hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50'"
                @click="showGenreDropdown = !showGenreDropdown; showYearDropdown = false"
              >{{ filterGenre || 'Genre' }} ▾</button>
              <div v-if="showGenreDropdown" class="absolute top-full left-0 mt-1 bg-white border border-stone-200 shadow-md rounded z-20 min-w-[130px] max-h-60 overflow-y-auto">
                <button class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                  :class="!filterGenre ? 'text-amber-700 font-medium' : 'text-stone-600'"
                  @click="filterGenre = null; showGenreDropdown = false">All genres</button>
                <button v-for="g in distinctGenres" :key="g"
                  class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                  :class="filterGenre === g ? 'text-amber-700 font-medium' : 'text-stone-600'"
                  @click="filterGenre = g; showGenreDropdown = false">{{ g }}</button>
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
                <button class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                  :class="!filterYear ? 'text-amber-700 font-medium' : 'text-stone-600'"
                  @click="filterYear = null; showYearDropdown = false">All years</button>
                <button v-for="y in distinctYears" :key="y"
                  class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                  :class="filterYear === y ? 'text-amber-700 font-medium' : 'text-stone-600'"
                  @click="filterYear = y; showYearDropdown = false">{{ y }}</button>
              </div>
            </div>
            <button v-if="filterGenre || filterYear"
              class="text-xs text-stone-400 hover:text-amber-700 transition-colors"
              @click="filterGenre = null; filterYear = null">Clear</button>
          </div>
        </div>
        <div class="px-6 pb-2 flex flex-wrap gap-0.5">
          <button
            v-for="letter in LETTERS" :key="letter"
            type="button" tabindex="-1"
            class="min-w-[1.75rem] h-7 px-1 text-xs font-medium rounded transition-colors select-none"
            :class="expandedGroups[letter] ? 'bg-amber-700 text-white' : 'text-stone-500 hover:text-amber-700 hover:bg-amber-50'"
            @click="toggleAndScroll(letter)"
          >{{ letter }}</button>
        </div>
      </div>

      <!-- ── MOBILE HEADER (search + filters in one row) ── -->
      <div class="md:hidden border-b border-stone-200 bg-white flex-shrink-0 px-4 py-3">
        <div class="flex items-center gap-2">
          <!-- Search -->
          <div class="relative flex-1 min-w-0">
            <input
              v-model="mobileQuery"
              type="search"
              placeholder="Search artists…"
              class="w-full text-sm px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 placeholder-stone-400 focus:outline-none focus:border-amber-400 transition-colors pr-6"
            />
            <button v-if="mobileQuery" class="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 text-xs" @click="mobileQuery = ''">✕</button>
          </div>
          <!-- Genre filter -->
          <div class="relative flex-shrink-0">
            <div v-if="showGenreDropdown" class="fixed inset-0 z-10" @click="showGenreDropdown = false"></div>
            <button
              class="relative z-20 text-xs border px-2 py-2 rounded transition-all whitespace-nowrap"
              :class="filterGenre ? 'border-amber-700 text-amber-700 bg-amber-50' : 'border-stone-200 text-stone-400'"
              @click="showGenreDropdown = !showGenreDropdown; showYearDropdown = false"
            >{{ filterGenre ? (filterGenre.length > 7 ? filterGenre.slice(0, 7) + '…' : filterGenre) : 'Genre' }} ▾</button>
            <div v-if="showGenreDropdown" class="absolute top-full right-0 mt-1 bg-white border border-stone-200 shadow-md rounded z-20 min-w-[130px] max-h-60 overflow-y-auto">
              <button class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="!filterGenre ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="filterGenre = null; showGenreDropdown = false">All genres</button>
              <button v-for="g in distinctGenres" :key="g"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="filterGenre === g ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="filterGenre = g; showGenreDropdown = false">{{ g }}</button>
            </div>
          </div>
          <!-- Year filter -->
          <div class="relative flex-shrink-0">
            <div v-if="showYearDropdown" class="fixed inset-0 z-10" @click="showYearDropdown = false"></div>
            <button
              class="relative z-20 text-xs border px-2 py-2 rounded transition-all"
              :class="filterYear ? 'border-amber-700 text-amber-700 bg-amber-50' : 'border-stone-200 text-stone-400'"
              @click="showYearDropdown = !showYearDropdown; showGenreDropdown = false"
            >{{ filterYear || 'Year' }} ▾</button>
            <div v-if="showYearDropdown" class="absolute top-full right-0 mt-1 bg-white border border-stone-200 shadow-md rounded z-20 min-w-[80px] max-h-60 overflow-y-auto">
              <button class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="!filterYear ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="filterYear = null; showYearDropdown = false">All years</button>
              <button v-for="y in distinctYears" :key="y"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="filterYear === y ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="filterYear = y; showYearDropdown = false">{{ y }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── DESKTOP CONTENT ── -->
      <div ref="scrollContainer" class="hidden md:block flex-1 overflow-y-auto px-6 py-4 pb-24">
        <!-- Recently Added -->
        <div v-if="recentArtists.length" class="mb-8">
          <h2 class="font-serif text-xl font-semibold mb-3">Recently Added</h2>
          <div class="flex gap-3 overflow-x-auto pb-2" style="scrollbar-width:none;-ms-overflow-style:none">
            <div v-for="artist in recentArtists" :key="artist.id" class="flex-none w-24 cursor-pointer group" @click="openArtist(artist)">
              <div class="aspect-square bg-stone-100 rounded-xl overflow-hidden mb-2 transition-transform duration-200 group-hover:scale-[1.03] relative">
                <div class="w-full h-full flex items-center justify-center font-serif text-3xl font-semibold text-stone-300 select-none">{{ artist.name[0]?.toUpperCase() }}</div>
                <img :src="`/artist-images/avatar?name=${encodeURIComponent(artist.name)}`" :alt="artist.name" class="absolute inset-0 w-full h-full object-cover" @error="e => e.target.style.display='none'" />
              </div>
              <div class="text-sm font-medium truncate leading-tight">{{ artist.name }}</div>
            </div>
          </div>
        </div>
        <!-- Discover Artists -->
        <div v-if="discoverArtists.length" class="mb-8">
          <h2 class="font-serif text-xl font-semibold mb-3">Discover Artists</h2>
          <div class="flex gap-3 overflow-x-auto pb-2" style="scrollbar-width:none;-ms-overflow-style:none">
            <div v-for="artist in discoverArtists" :key="artist.id" class="flex-none w-24 cursor-pointer group" @click="openArtist(artist)">
              <div class="aspect-square bg-stone-100 rounded-xl overflow-hidden mb-2 transition-transform duration-200 group-hover:scale-[1.03] relative">
                <div class="w-full h-full flex items-center justify-center font-serif text-3xl font-semibold text-stone-300 select-none">{{ artist.name[0]?.toUpperCase() }}</div>
                <img :src="`/artist-images/avatar?name=${encodeURIComponent(artist.name)}`" :alt="artist.name" class="absolute inset-0 w-full h-full object-cover" @error="e => e.target.style.display='none'" />
              </div>
              <div class="text-sm font-medium truncate leading-tight">{{ artist.name }}</div>
            </div>
          </div>
        </div>
        <div v-if="recentArtists.length || discoverArtists.length" class="border-b border-stone-200 mb-6"></div>
        <div v-if="loading" class="flex items-center justify-center py-24 text-stone-400 text-sm">Loading…</div>
        <div v-else-if="(filterGenre || filterYear) && !filteredArtists.length" class="flex items-center justify-center py-24 text-stone-400 text-sm">No artists match the filter.</div>
        <template v-else>
          <template v-for="group in filteredArtistIndex" :key="group.name">
            <div v-if="expandedGroups[group.name]" :ref="el => setGroupRef(group.name, el)" class="mb-6">
              <div class="font-serif text-xl font-semibold text-amber-700 border-b border-stone-200 pb-1 mb-3">{{ group.name }}</div>
              <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))">
                <ArtistCard v-for="artist in group.artist" :key="artist.id" :artist="artist" @click="openArtist(artist)" />
              </div>
            </div>
          </template>
        </template>
      </div>

      <!-- ── MOBILE CONTENT ── -->
      <div class="md:hidden flex-1 overflow-y-auto pb-40">
        <div v-if="loading" class="flex items-center justify-center py-24 text-stone-400 text-sm">Loading…</div>
        <template v-else>

          <!-- BROWSE MODE: 2 carousels (no search, no filter active) -->
          <template v-if="!mobileQuery && !filterGenre && !filterYear">
            <div v-if="recentArtists.length" class="pt-5 mb-6">
              <div class="px-4 text-xs font-medium uppercase tracking-widest text-stone-400 mb-3">Recently Added</div>
              <div class="w-full flex gap-3 overflow-x-auto px-4 pb-1" style="scrollbar-width:none;-ms-overflow-style:none">
                <div v-for="artist in recentArtists" :key="artist.id" class="flex-none cursor-pointer" style="width:calc(100% / 3 - 8px)" @click="openArtist(artist)">
                  <div class="aspect-square bg-stone-100 rounded-xl overflow-hidden mb-1.5 relative">
                    <div class="w-full h-full flex items-center justify-center font-serif text-3xl font-semibold text-stone-300 select-none">{{ artist.name[0]?.toUpperCase() }}</div>
                    <img :src="`/artist-images/avatar?name=${encodeURIComponent(artist.name)}`" :alt="artist.name" class="absolute inset-0 w-full h-full object-cover" @error="e => e.target.style.display='none'" />
                  </div>
                  <div class="text-xs font-medium truncate leading-tight text-center">{{ artist.name }}</div>
                </div>
              </div>
            </div>
            <div v-if="discoverArtists.length" class="mb-6">
              <div class="px-4 text-xs font-medium uppercase tracking-widest text-stone-400 mb-3">Discover Artists</div>
              <div class="w-full flex gap-3 overflow-x-auto px-4 pb-1" style="scrollbar-width:none;-ms-overflow-style:none">
                <div v-for="artist in discoverArtists" :key="artist.id" class="flex-none cursor-pointer" style="width:calc(100% / 3 - 8px)" @click="openArtist(artist)">
                  <div class="aspect-square bg-stone-100 rounded-xl overflow-hidden mb-1.5 relative">
                    <div class="w-full h-full flex items-center justify-center font-serif text-3xl font-semibold text-stone-300 select-none">{{ artist.name[0]?.toUpperCase() }}</div>
                    <img :src="`/artist-images/avatar?name=${encodeURIComponent(artist.name)}`" :alt="artist.name" class="absolute inset-0 w-full h-full object-cover" @error="e => e.target.style.display='none'" />
                  </div>
                  <div class="text-xs font-medium truncate leading-tight text-center">{{ artist.name }}</div>
                </div>
              </div>
            </div>
          </template>

          <!-- SEARCH / FILTER MODE: alphabetical contact list -->
          <template v-else>
            <div v-if="mobileFilteredIndex.length">
              <template v-for="group in mobileFilteredIndex" :key="group.name">
                <div class="px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-amber-700 bg-stone-50 border-b border-stone-100">{{ group.name }}</div>
                <div
                  v-for="artist in group.artist" :key="artist.id"
                  class="flex items-center gap-3 px-4 py-2 border-b border-stone-100 active:bg-stone-50 cursor-pointer"
                  @click="openArtist(artist)"
                >
                  <div class="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 bg-stone-100 relative">
                    <div class="w-full h-full flex items-center justify-center font-semibold text-stone-300 select-none">{{ artist.name[0]?.toUpperCase() }}</div>
                    <img :src="`/artist-images/avatar?name=${encodeURIComponent(artist.name)}`" :alt="artist.name" class="absolute inset-0 w-full h-full object-cover" @error="e => e.target.style.display='none'" />
                  </div>
                  <span class="text-sm font-medium truncate">{{ artist.name }}</span>
                </div>
              </template>
            </div>
            <div v-else class="flex items-center justify-center py-24 text-stone-400 text-sm">No artists found</div>
          </template>

        </template>
      </div>

    </template>

    <!-- ARTIST DETAIL -->
    <template v-else-if="view === 'artist'">
      <div class="px-4 md:px-8 py-5 md:py-7 border-b border-stone-200 bg-white flex-shrink-0">
        <div class="flex items-center gap-1.5 text-xs text-stone-400 mb-3">
          <span class="cursor-pointer hover:text-amber-700 transition-colors" @click="view = 'grid'">Artists</span>
          <span class="opacity-40">›</span>
          <span class="cursor-pointer hover:text-amber-700 transition-colors" @click="goToLetter(currentArtistLetter)">{{ currentArtistLetter }}</span>
          <span class="opacity-40">›</span>
          <span>{{ currentArtist.name }}</span>
        </div>
        <div class="flex items-center gap-4">
          <label class="w-12 h-12 md:w-14 md:h-14 rounded-xl overflow-hidden flex-shrink-0 bg-stone-100 relative cursor-pointer group/avatar" title="Upload artist photo">
            <img
              v-if="artistDetailImageUrl"
              :src="artistDetailImageUrl"
              :alt="currentArtist.name"
              class="w-full h-full object-cover"
              @error="onArtistDetailImgError"
            />
            <div v-else class="w-full h-full flex items-center justify-center font-serif text-2xl font-semibold text-stone-300 select-none">
              {{ currentArtist.name?.[0]?.toUpperCase() }}
            </div>
            <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity">
              <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <input type="file" accept="image/*" class="hidden" @change="uploadArtistAvatar" />
          </label>
          <h1 class="font-serif text-2xl md:text-4xl font-semibold">{{ currentArtist.name }}</h1>
        </div>

      </div>
      <div class="flex-1 overflow-y-auto px-6 py-4 pb-40 md:pb-24">
        <div v-if="loadingArtist" class="flex items-center justify-center py-24 text-stone-400 text-sm">Loading…</div>
        <div v-else class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(88px, 1fr))">
          <div
            v-for="album in currentArtistAlbums" :key="album.id"
            class="cursor-pointer group"
            @click="openAlbum(album)"
          >
            <div class="aspect-square bg-amber-50 mb-1 overflow-hidden relative rounded">
              <div class="w-full h-full flex items-center justify-center text-2xl">💿</div>
              <img :src="coverUrl(album.coverArt || album.id)" :alt="album.name" class="absolute inset-0 w-full h-full object-cover" @error="onAlbumCoverError($event, album)" />
              <div class="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded">
                <button class="w-7 h-7 rounded-full bg-white flex items-center justify-center text-xs pl-0.5" @click.stop="playAlbum(album)">▶</button>
              </div>
            </div>
            <div class="text-xs font-medium truncate leading-tight">{{ album.name }}</div>
            <div class="text-xs text-stone-400 mt-0.5 truncate">
              {{ [album.year, album.songCount ? album.songCount + ' tracks' : '', album.genre].filter(Boolean).join(' · ') }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ALBUM DETAIL -->
    <template v-else-if="view === 'album'">
      <div class="px-4 md:px-8 py-5 md:py-7 border-b border-stone-200 bg-white flex-shrink-0">
        <div class="flex items-center gap-1.5 text-xs text-stone-400 mb-2 flex-wrap">
          <span class="cursor-pointer hover:text-amber-700 transition-colors" @click="view = 'grid'">Artists</span>
          <span class="opacity-40">›</span>
          <span class="cursor-pointer hover:text-amber-700 transition-colors" @click="goToLetter(currentArtistLetter)">{{ currentArtistLetter }}</span>
          <span class="opacity-40">›</span>
          <span class="cursor-pointer hover:text-amber-700 transition-colors" @click="view = 'artist'">{{ currentArtist.name }}</span>
          <span class="opacity-40">›</span>
          <span>{{ displayTitle }}</span>
        </div>
        <div class="flex items-center gap-2">
          <h1 class="font-serif text-2xl md:text-4xl font-semibold truncate">{{ displayTitle }}</h1>
          <button class="flex-shrink-0 inline-flex items-center gap-1 border border-stone-300 text-stone-600 text-xs px-2.5 py-1 rounded-full hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50 transition-colors" title="Edit album tags" @click="openTagEditor">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z" /></svg>
            Edit
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto px-4 md:px-8 py-4 md:py-6 pb-40 md:pb-24">
        <div v-if="loading" class="flex items-center justify-center py-24 text-stone-400 text-sm">Loading…</div>
        <div v-else>
          <div class="flex gap-6 mb-8 items-end">
            <div class="w-40 h-40 flex-shrink-0 bg-amber-50 overflow-hidden relative">
              <div class="w-full h-full flex items-center justify-center text-5xl">💿</div>
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
            <div>
              <div class="text-xs uppercase tracking-widest text-stone-400 mb-2 flex items-center gap-1">
                <span>{{ ['Album', displayYear].filter(Boolean).join(' · ') }}</span>
                <span v-if="displayGenre">· {{ displayGenre }}</span>
              </div>
              <div class="font-serif text-3xl font-semibold mb-1.5">{{ displayTitle }}</div>
              <div class="text-sm text-stone-400 mb-4">{{ displayArtist }}</div>
              <div class="flex gap-2.5">
                <button class="bg-stone-900 text-white text-sm font-medium px-5 py-2 hover:bg-amber-700 transition-colors" @click="playAlbumTracks">▶ Play</button>
                <button class="border border-stone-200 text-sm px-4 py-2 hover:border-amber-700 hover:text-amber-700 transition-colors" @click="queueAlbumTracks">+ Queue</button>
              </div>
            </div>
          </div>

          <div class="grid gap-2 text-xs uppercase tracking-widest text-stone-400 px-3 pb-2 border-b border-stone-200 mb-1 [grid-template-columns:28px_1fr_44px_56px] md:[grid-template-columns:28px_1fr_1fr_44px_56px]">
            <span class="text-center">#</span><span>Title</span><span class="hidden md:block">Artist</span><span>Time</span><span></span>
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
    </Teleport>

    <!-- Cover search modal -->
    <Teleport to="body">
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
import { ref, reactive, computed, nextTick, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../stores/player'
import { getArtists, getArtist, getAlbum, coverUrl, getNewestAlbums, getArtistGenreMap, startScan } from '../api/subsonic'
import { saveAlbumTags, saveTrackTags } from '../api/tags'
import { searchAlbumCovers } from '../api/covers'
import { GENRES } from '../api/genres'
import TrackItem  from '../components/TrackItem.vue'
import ArtistCard from '../components/ArtistCard.vue'

const route  = useRoute()
const router = useRouter()
const player = usePlayerStore()

const LETTERS = ['#', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']

const view    = ref('grid')
const loading = ref(false)

const artistIndex    = ref([])
const expandedGroups = reactive({})
const scrollContainer = ref(null)
const groupRefs = {}

function setGroupRef(name, el) {
  if (el) groupRefs[name] = el
}

const currentArtist           = ref(null)
const currentArtistAlbums     = ref([])
const loadingArtist           = ref(false)
const artistDetailImageUrl    = ref(null)
const currentArtistLetter     = ref(null)

function getArtistLetter(name) {
  const stripped = name?.replace(/^(the|a|an)\s+/i, '') ?? name
  const first = stripped?.[0]?.toLowerCase()
  return (first && first >= 'a' && first <= 'z') ? first : '#'
}

function goToLetter(letter) {
  view.value = 'grid'
  nextTick(() => {
    expandedGroups[letter] = true
    nextTick(() => {
      const el = groupRefs[letter]
      const container = scrollContainer.value
      if (el && container) container.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' })
    })
  })
}

const recentArtists   = ref([])
const discoverArtists = ref([])
const mobileQuery     = ref('')

const mobileFilteredIndex = computed(() => {
  const q = mobileQuery.value.toLowerCase().trim()
  const base = filteredArtistIndex.value
  if (!q) return base
  return base
    .map(g => ({ ...g, artist: g.artist.filter(a => a.name.toLowerCase().includes(q)) }))
    .filter(g => g.artist.length)
})

const artistGenreMap    = ref({})  // artistId -> { genres: Set, years: Set }
const filterGenre       = ref(null)
const filterYear        = ref(null)
const showGenreDropdown = ref(false)
const showYearDropdown  = ref(false)

const distinctGenres = computed(() => {
  const seen = new Set()
  for (const meta of Object.values(artistGenreMap.value)) {
    for (const g of meta.genres) seen.add(g)
  }
  return [...seen].sort()
})

const distinctYears = computed(() => {
  const seen = new Set()
  for (const meta of Object.values(artistGenreMap.value)) {
    for (const y of meta.years) seen.add(y)
  }
  return [...seen].sort((a, b) => Number(b) - Number(a))
})

const filteredArtists = computed(() => {
  if (!filterGenre.value && !filterYear.value) return null
  return artistIndex.value.flatMap(g => g.artist).filter(a => {
    const meta = artistGenreMap.value[a.id]
    if (!meta) return false
    if (filterGenre.value && !meta.genres.includes(filterGenre.value)) return false
    if (filterYear.value  && !meta.years.includes(filterYear.value))   return false
    return true
  })
})

const filteredArtistIndex = computed(() => {
  if (!filteredArtists.value) return artistIndex.value
  const ids = new Set(filteredArtists.value.map(a => a.id))
  return artistIndex.value
    .map(g => ({ ...g, artist: g.artist.filter(a => ids.has(a.id)) }))
    .filter(g => g.artist.length)
})

const currentAlbum  = ref(null)
const albumTracks   = ref([])
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

// The on-disk folder identity (album artist + album name as they were when the
// files were indexed). The sidecar locates the album folder by this, and it does
// NOT change when tags are edited — so we remember it across edits.
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

  // Instant in-memory feedback until Gonic re-indexes.
  if (title)  track.title  = title
  if (artist) track.artist = artist
  if (num)    track.track  = num
  trackSaving.value = false
  closeTrackEditor()
}

async function loadArtists() {
  loading.value = true
  try {
    const index = await getArtists()
    for (const group of index) {
      expandedGroups[group.name] = false
      for (const artist of group.artist) artist._letter = group.name
    }
    artistIndex.value = index
    const all = index.flatMap(g => g.artist)
    discoverArtists.value = [...all].sort(() => Math.random() - 0.5).slice(0, 20)
  } finally {
    loading.value = false
  }
}

function toggleAndScroll(name) {
  const opening = !expandedGroups[name]
  expandedGroups[name] = opening
  if (opening) {
    nextTick(() => {
      const el = groupRefs[name]
      const container = scrollContainer.value
      if (el && container) {
        container.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' })
      }
    })
  }
}

async function openArtist(artist) {
  currentArtist.value = { ...artist }
  currentArtistLetter.value = artist._letter || getArtistLetter(artist.name)
  artistDetailImageUrl.value = null
  view.value = 'artist'
  loadingArtist.value = true
  try {
    const data = await getArtist(artist.id)
    currentArtistAlbums.value = data.albums
    artistDetailImageUrl.value = `/artist-images/avatar?name=${encodeURIComponent(artist.name)}`
  } finally { loadingArtist.value = false }
}

function onArtistDetailImgError() {
  artistDetailImageUrl.value = null
}

async function uploadArtistAvatar(e) {
  const file = e.target.files[0]
  if (!file || !currentArtist.value) return
  const name = currentArtist.value.name
  const form = new FormData()
  form.append('cover', file)
  try {
    const res = await fetch(
      `/artist-images/upload-avatar?name=${encodeURIComponent(name)}`,
      { method: 'POST', body: form }
    )
    if (res.ok) {
      // cache-bust so the new image is fetched immediately
      artistDetailImageUrl.value = `/artist-images/avatar?name=${encodeURIComponent(name)}&t=${Date.now()}`
    }
  } finally {
    e.target.value = ''
  }
}

async function openAlbum(album) {
  loading.value = true
  albumDetailCoverState.value = 'loading'
  try {
    const data = await getAlbum(album.id)
    currentAlbum.value = { ...album, ...data.info }
    albumTracks.value  = data.tracks
    albumDetailCoverSrc.value = coverUrl(currentAlbum.value.coverArt || currentAlbum.value.id)
    view.value = 'album'
  } finally { loading.value = false }
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

function onImgError(e) {
  try { if (e?.target) e.target.style.display = 'none' } catch (_) {}
}

async function openArtistById(id) {
  currentArtist.value         = { id, name: '' }
  artistDetailImageUrl.value  = null
  view.value                  = 'artist'
  loadingArtist.value         = true
  try {
    const data = await getArtist(id)
    currentArtist.value        = data.info
    currentArtistLetter.value  = getArtistLetter(data.info?.name)
    currentArtistAlbums.value  = data.albums
    artistDetailImageUrl.value = `/artist-images/avatar?name=${encodeURIComponent(data.info?.name)}`
  } finally { loadingArtist.value = false }
}

watch(() => route.params.id, (id) => {
  if (id) openArtistById(id)
  else view.value = 'grid'
})

onMounted(async () => {
  getArtistGenreMap().then(m => { artistGenreMap.value = m })
  const [, newestAlbums] = await Promise.all([loadArtists(), getNewestAlbums(100)])
  const seen = new Set()
  const artists = []
  for (const album of newestAlbums) {
    if (album.artistId && !seen.has(album.artistId)) {
      seen.add(album.artistId)
      artists.push({ id: album.artistId, name: album.albumArtist || album.artist })
      if (artists.length >= 20) break
    }
  }
  recentArtists.value = artists
  if (route.params.id) openArtistById(route.params.id)
})
</script>
