// Tag persistence via the artist-images sidecar.
// The Subsonic API has no tag-write endpoint, so edits are written directly to
// the mp3 files on the NFS share by the sidecar; callers should follow a
// successful save with subsonic.startScan() to have Gonic re-index the changes.

// Writes album-level frames to every track in the album:
//   title       → TALB
//   artist      → TPE1 (bulk, applied to all tracks)
//   albumArtist → TPE2
//   year        → TDRC/TYER
//   genre       → TCON
// `dirArtist`/`dirAlbum` must match the album's CURRENT on-disk identity
// (album artist + album name) so the sidecar finds the folder.
export async function saveAlbumTags(dirArtist, dirAlbum, { title, artist, albumArtist, year, genre } = {}) {
  const form = new FormData()
  if (title)       form.append('title', title)
  if (artist)      form.append('artist', artist)
  if (albumArtist) form.append('albumArtist', albumArtist)
  if (year)        form.append('year', String(year))
  if (genre)       form.append('genre', genre)
  const res = await fetch(
    `/artist-images/album-tags?artist=${encodeURIComponent(dirArtist)}&album=${encodeURIComponent(dirAlbum)}`,
    { method: 'POST', body: form }
  )
  if (!res.ok) throw new Error(`album-tags failed: ${res.status}`)
}

// Writes track-level frames (title, artist, track number) to a single file.
// `file` is the track's filename (basename of the Subsonic song path).
export async function saveTrackTags(artist, album, file, { title, artist: trackArtist, track } = {}) {
  const form = new FormData()
  form.append('file', file)
  if (title)       form.append('title', title)
  if (trackArtist) form.append('artist', trackArtist)
  if (track)       form.append('track', String(track))
  const res = await fetch(
    `/artist-images/track-tags?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`,
    { method: 'POST', body: form }
  )
  if (!res.ok) throw new Error(`track-tags failed: ${res.status}`)
}
