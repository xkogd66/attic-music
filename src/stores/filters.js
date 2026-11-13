import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

// Genre/year filters for the Artists and Albums lists.
//
// They live in a store (not in the views) because on desktop the dropdowns are
// in SideBar.vue while the grids belong to the views — same state, two places
// to render it. On mobile each view still renders its own compact dropdowns.
//
// Kept in memory only: a reload starts unfiltered. App.vue only mounts SideBar
// while logged in, so a sign-out + sign-in pair starts clean too.
export const useFiltersStore = defineStore('filters', () => {
  // `null` / '' = no filter. A year is stored as a number, like album.year.
  const genre = ref(null)
  const year  = ref(null)

  // Which list the sidebar dropdowns apply their picks to. Derived from the
  // route by App.vue — the sidebar itself has no view state of its own.
  const scope = ref('artists')

  // Option lists of the *active* scope, published by Artists.vue / Albums.vue
  // once they know them. That is what lets the sidebar hide a filter the
  // current view has no data for yet (see App.vue: no ghost filter can then
  // empty a grid whose filter lists are still loading).
  const opts = ref({ scope: null, genres: [], years: [] })

  // The year filter doubles as a list of years to browse (newest first). It
  // starts with the newest few; "More years" reveals the rest.
  const yearsExpanded = ref(false)
  const YEARS_PREF    = 5

  function setGenre(value) { genre.value = value || null }
  function setYear(value) {
    const n = Number(value)
    year.value = value !== null && value !== '' && Number.isFinite(n) ? n : null
  }
  function clearGenre() { genre.value = null }
  function clearYear()  { year.value  = null }
  function clear()      { genre.value = null; year.value = null }
  function publish(key, genres, years) {
    opts.value = {
      scope:  key,
      genres: [...genres].sort((a, b) => a.localeCompare(b)),
      years:  [...years].sort((a, b) => b - a),
    }
    // A fresh snapshot means a fresh set of choices: collapse the year list
    // back to the recent few.
    yearsExpanded.value = false
  }

  function isPublished(key) {
    return opts.value.scope === key
  }

  // A new scope starts from this view's own lists, not the previous view's.
  // Clearing the snapshot makes the sidebar show its "loading" placeholder
  // until the new view pages in its albums and publishes again.
  function setScope(value) {
    if (scope.value === value) return
    scope.value = value
    yearsExpanded.value = false
    opts.value = { scope: value, genres: [], years: [] }
    clear()
  }

  // Drop a filter the active scope cannot honour: the store may hold a genre
  // picked while the filter lists were still loading, and a filter with no
  // options must never hide the whole grid.
  watch([opts, genre], ([o, g]) => {
    if (g && !o.genres.includes(g)) genre.value = null
  })
  watch([opts, year], ([o, y]) => {
    if (y && !o.years.includes(y)) year.value = null
  })

  return {
    genre, year, scope, opts, yearsExpanded, YEARS_PREF,
    setGenre, setYear, clearGenre, clearYear, clear, setScope, publish, isPublished,
  }
})
