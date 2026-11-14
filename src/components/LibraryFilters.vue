<template>
  <div class="px-4 pb-2 flex-shrink-0">
    <!-- Mobile: each view puts its own compact dropdowns in its header
         (Artists.vue / Albums.vue), right next to the grid they filter. -->
    <div class="hidden md:block">
      <div class="flex items-center justify-between px-2 pb-1.5">
        <span class="text-xs font-medium uppercase tracking-widest text-stone-600">Filter</span>
        <button
          v-if="f.genre || f.year"
          type="button"
          class="text-xs text-stone-600 hover:text-amber-700 transition-colors"
          @click="f.clear()"
        >Clear</button>
      </div>

      <!-- No options yet: say so instead of hiding the section, which would
           look like the filter simply vanished. -->
      <div v-if="!options.genres.length && !options.years.length" class="px-2 pb-2 text-xs text-stone-500">
        Filters load with the library…
      </div>

      <template v-else>
        <!-- Genre / Year dropdowns (open upward: the sidebar is taller than
             the room below this block once scrobbles are showing) -->
        <div class="flex gap-1.5">
          <div v-if="options.genres.length" class="relative flex-1 min-w-0">
            <div v-if="openGenre" class="fixed inset-0 z-30" @click="openGenre = false"></div>
            <button
              type="button"
              class="relative z-40 w-full text-left text-xs border px-2.5 py-1.5 rounded transition-all truncate"
              :class="f.genre ? 'border-amber-700 text-amber-700 bg-amber-50' : 'border-stone-200 text-stone-600 hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50'"
              @click="openGenre = !openGenre; openYear = false"
            >{{ f.genre || 'Genre' }} ▾</button>
            <div v-if="openGenre" class="absolute bottom-full left-0 mb-1 bg-white border border-stone-200 shadow-md rounded z-40 w-44 max-h-60 overflow-y-auto">
              <button
                v-for="g in options.genres" :key="g"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors truncate"
                :class="f.genre === g ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="f.setGenre(g); openGenre = false"
              >{{ g }}</button>
            </div>
          </div>

          <div v-if="options.years.length" class="relative flex-1 min-w-0">
            <div v-if="openYear" class="fixed inset-0 z-30" @click="openYear = false"></div>
            <button
              type="button"
              class="relative z-40 w-full text-left text-xs border px-2.5 py-1.5 rounded transition-all truncate"
              :class="f.year ? 'border-amber-700 text-amber-700 bg-amber-50' : 'border-stone-200 text-stone-600 hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50'"
              @click="openYear = !openYear; openGenre = false"
            >{{ f.year || 'Year' }} ▾</button>
            <div v-if="openYear" class="absolute bottom-full right-0 mb-1 bg-white border border-stone-200 shadow-md rounded z-40 w-32 max-h-60 overflow-y-auto">
              <button
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="!f.year ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="f.clearYear(); openYear = false"
              >All years</button>
              <button
                v-for="y in options.years" :key="y"
                class="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors"
                :class="f.year === y ? 'text-amber-700 font-medium' : 'text-stone-600'"
                @click="f.setYear(y); openYear = false"
              >{{ y }}</button>
            </div>
          </div>
        </div>

        <!-- Say what is being filtered, so an emptier-than-expected library
             never looks like a bug. -->
        <div v-if="f.genre || f.year" class="mt-1.5 px-1 text-[11px] text-stone-500 leading-snug flex flex-wrap items-center gap-x-1">
          <span>{{ f.scope === 'albums' ? 'Albums' : 'Artists' }}<template v-if="f.genre"> in {{ f.genre }}</template><template v-if="f.year"> from {{ f.year }}</template></span>
          <button type="button" class="text-amber-700 hover:underline" @click="f.clear()">Clear</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useFiltersStore } from '../stores/filters'

const f = useFiltersStore()

// Dropdown state is local: it is UI, not a filter.
const openGenre = ref(false)
const openYear  = ref(false)

const EMPTY = { scope: null, genres: [], years: [] }

// Only show options once the active scope has published its own lists —
// otherwise the previous scope's genres would linger on this page for the
// moment before the new view's album scan finishes.
const options = computed(() => (f.isPublished(f.scope) ? f.opts : EMPTY))
</script>

