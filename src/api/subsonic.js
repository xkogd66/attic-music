import { useConfigStore } from '../stores/config'

function hexEncode(s) {
  return Array.from(s).map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join('')
}

function buildUrl(endpoint, params = {}) {
  const config = useConfigStore()
  const base   = config.server.replace(/\/$/, '')
  const auth   = `u=${encodeURIComponent(config.username)}&p=enc:${hexEncode(config.password)}&v=1.16.1&c=atticweb&f=json`
  const parts  = []
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${k}=${encodeURIComponent(item)}`)
    } else {
      parts.push(`${k}=${encodeURIComponent(v)}`)
    }
  }
  return `${base}/rest/${endpoint}?${auth}${parts.length ? '&' + parts.join('&') : ''}`
}

export function coverUrl(id, size = 200) {
  return buildUrl('getCoverArt', { id, size })
}

export function streamUrl(id) {
  return buildUrl('stream', { id, format: 'raw' })
}

function ensureArray(val) {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

async function request(endpoint, params = {}) {
  const res  = await fetch(buildUrl(endpoint, params), { cache: 'no-store' })
  const json = await res.json()
  const data = json['subsonic-response']
  if (data.status !== 'ok') throw new Error(data.error?.message || 'API error')
  return data
}

export async function ping() {
  return request('ping')
}

export async function getIndexes() {
  const data    = await request('getIndexes')
  const indexes = ensureArray(data.indexes?.index)
  const items   = []
  for (const idx of indexes) {
    for (const a of ensureArray(idx.artist)) {
      items.push({ id: a.id, name: a.name, isDir: true })
    }
  }
  return items
}

export async function getDirectory(id) {
  const data = await request('getMusicDirectory', { id })
  return ensureArray(data.directory?.child)
}

const ARTICLES = /^(the|a|an|los|las|le|les|el|la|die|das|der|gli|il)\s+/i

function sortableName(name) {
  return name.replace(ARTICLES, '').trim()
}

export async function getArtists() {
  const data = await request('getArtists')
  const all = []
  for (const g of ensureArray(data.artists?.index)) {
    for (const a of ensureArray(g.artist)) all.push(a)
  }
  all.sort((a, b) =>
    sortableName(a.name).localeCompare(sortableName(b.name), undefined, { sensitivity: 'base' })
  )
  const map = new Map()
  for (const artist of all) {
    const ch = sortableName(artist.name)[0]?.toUpperCase() || '#'
    const key = /[A-Z]/.test(ch) ? ch.toLowerCase() : '#'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(artist)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))
    .map(([name, artist]) => ({ name, artist }))
}

// Returns { artistId: coverArtId } using the first album found per artist.
// Paginates until all albums are fetched.
export async function getArtistCoverMap() {
  const map = {}
  let offset = 0
  const size = 500
  while (true) {
    let albums
    try {
      const data = await request('getAlbumList2', { type: 'alphabeticalByName', size, offset })
      albums = ensureArray(data.albumList2?.album)
    } catch {
      break
    }
    for (const album of albums) {
      if (album.artistId && album.coverArt && !map[album.artistId]) {
        map[album.artistId] = album.coverArt
      }
    }
    if (albums.length < size) break
    offset += size
  }
  return map
}

// Returns { artistId: { genres: string[], years: number[] } } by scanning all albums.
export async function getArtistGenreMap() {
  const map = {}
  let offset = 0
  const size = 500
  while (true) {
    let albums
    try {
      const data = await request('getAlbumList2', { type: 'alphabeticalByName', size, offset })
      albums = ensureArray(data.albumList2?.album)
    } catch { break }
    for (const album of albums) {
      if (!album.artistId) continue
      if (!map[album.artistId]) map[album.artistId] = { genres: [], years: [] }
      if (album.genre && !map[album.artistId].genres.includes(album.genre)) map[album.artistId].genres.push(album.genre)
      if (album.year  && !map[album.artistId].years.includes(album.year))   map[album.artistId].years.push(album.year)
    }
    if (albums.length < size) break
    offset += size
  }
  return map
}

export async function getArtist(id) {
  const data = await request('getArtist', { id })
  return {
    info:   data.artist,
    albums: ensureArray(data.artist?.album),
  }
}

export async function getAlbum(id) {
  const data = await request('getAlbum', { id })
  return {
    info:   data.album,
    tracks: ensureArray(data.album?.song),
  }
}

export async function getAlbumPage(size = 100, offset = 0) {
  const data = await request('getAlbumList2', { type: 'alphabeticalByName', size, offset })
  return ensureArray(data.albumList2?.album)
}

export async function getNewestAlbums(size = 12) {
  const data = await request('getAlbumList2', { type: 'newest', size })
  return ensureArray(data.albumList2?.album)
}

export async function getRandomAlbums(size = 20) {
  const data = await request('getAlbumList2', { type: 'random', size })
  return ensureArray(data.albumList2?.album)
}

export async function getPlaylists() {
  const data = await request('getPlaylists')
  return ensureArray(data.playlists?.playlist)
}

export async function getPlaylist(id) {
  const data = await request('getPlaylist', { id })
  return {
    info:   data.playlist,
    tracks: ensureArray(data.playlist?.entry),
  }
}

export async function createPlaylist(name, songIds = []) {
  return request('createPlaylist', { name, songId: songIds })
}

export async function updatePlaylist(id, { name, songIdsToAdd = [], songIndexesToRemove = [] } = {}) {
  const params = { playlistId: id }
  if (name)                     params.name              = name
  if (songIdsToAdd.length)      params.songIdToAdd       = songIdsToAdd
  if (songIndexesToRemove.length) params.songIndexToRemove = songIndexesToRemove
  return request('updatePlaylist', params)
}

export async function deletePlaylist(id) {
  return request('deletePlaylist', { id })
}


export async function getArtistInfo(id) {
  const data = await request('getArtistInfo2', { id })
  return data.artistInfo2 || {}
}

export async function scrobble(id, submission = true) {
  const params = { id, submission }
  if (submission) params.time = Date.now()
  await request('scrobble', params)
}

export async function startScan() {
  return request('startScan')
}

export async function getScanStatus() {
  return request('getScanStatus')
}

export async function search(query) {
  const data = await request('search3', { query, artistCount: 5, albumCount: 8, songCount: 8 })
  return {
    artists: ensureArray(data.searchResult3?.artist),
    albums:  ensureArray(data.searchResult3?.album),
    songs:   ensureArray(data.searchResult3?.song),
  }
}