// Discogs ratings, loaded once and shared by every view that shows an album.
// Tools.vue calls load(true) after fetching new ones so they appear everywhere.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchRatings, ratingKey } from '../api/chat'

export const useRatingsStore = defineStore('ratings', () => {
  const byKey = ref({})
  let loading = null

  const load = (force = false) =>
    (loading = (!force && loading) || fetchRatings().then(r => { byKey.value = r }))

  // a: any subsonic album object ({ name, artist, albumArtist? })
  const of = a => a && byKey.value[ratingKey(a.albumArtist || a.artist, a.name)]

  return { byKey, load, of }
})
