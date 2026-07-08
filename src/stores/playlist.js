import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getPlaylists, updatePlaylist } from '../api/subsonic'

export const usePlaylistStore = defineStore('playlist', () => {
  const playlists = ref([])

  async function load() {
    playlists.value = await getPlaylists()
  }

  async function addTrack(playlistId, trackId) {
    await updatePlaylist(playlistId, { songIdsToAdd: [trackId] })
  }

  return { playlists, load, addTrack }
})
