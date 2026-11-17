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

// Subsonic `download` serves the original file (a song id) or, for an album id,
// whatever gonic returns for it (expected: a zip). Triggered via a throwaway
// anchor so the browser streams it straight to disk instead of buffering in JS.
export function downloadUrl(id) {
  return buildUrl('download', { id })
}

export function download(id) {
  const a = document.createElement('a')
  a.href = downloadUrl(id)
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Songs are fetched as a blob and saved under a real filename: a plain
// `<a download>` is ignored (the browser just plays the file) when the server
// doesn't send Content-Disposition: attachment.
export async function downloadTrack(track) {
  const res = await fetch(downloadUrl(track.id))
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = `${track.artist ? track.artist + ' - ' : ''}${track.title}.${track.suffix || 'mp3'}`.replace(/[\\/:*?"<>|]/g, '_')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

const safeName = n => n.replace(/[\\/:*?"<>|]/g, '_')

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// Minimal store-only (no compression) zip writer; audio is already compressed.
function makeZip(files) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  for (const { name, data } of files) {
    const nameBytes = enc.encode(name)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    parts.push(local.buffer, nameBytes, data)
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true)
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint16(8, 0x0800, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, data.length, true)
    cen.setUint32(24, data.length, true)
    cen.setUint16(28, nameBytes.length, true)
    cen.setUint32(42, offset, true)
    central.push(cen.buffer, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const cenSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cenSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}

// Fetch the tracks and save them as one `<name>.zip`. A single track is saved
// as a plain file instead.
export async function downloadZip(tracks, name) {
  if (tracks.length === 1) return downloadTrack(tracks[0])
  const files = []
  for (const [i, t] of tracks.entries()) {
    const res = await fetch(downloadUrl(t.id))
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    files.push({
      name: safeName(`${String(t.track || i + 1).padStart(2, '0')} - ${t.title}.${t.suffix || 'mp3'}`),
      data: new Uint8Array(await res.arrayBuffer()),
    })
  }
  const url = URL.createObjectURL(makeZip(files))
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName(name || 'download')}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
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
// Pages the whole album list, so the result is cached for the session and shared
// by concurrent callers; a failed run is dropped so the next call retries.
// ponytail: never invalidated — a reload refreshes it. Add a bust if tag edits
// need the filters to update immediately.
let genreMapPromise = null
const BATCH = 6 // album-list pages requested at once (see fetchArtistGenreMap)
export function getArtistGenreMap() {
  genreMapPromise ??= fetchArtistGenreMap().catch(e => { genreMapPromise = null; throw e })
  return genreMapPromise
}

async function fetchArtistGenreMap() {
  const map = {}
  const size = 500

  const page = async (offset) => {
    const data   = await request('getAlbumList2', { type: 'alphabeticalByName', size, offset })
    return ensureArray(data.albumList2?.album)
  }

  const add = (albums) => {
    for (const album of albums) {
      if (!album.artistId) continue
      if (!map[album.artistId]) map[album.artistId] = { genres: [], years: [] }
      if (album.genre && !map[album.artistId].genres.includes(album.genre)) map[album.artistId].genres.push(album.genre)
      if (album.year  && !map[album.artistId].years.includes(album.year))   map[album.artistId].years.push(album.year)
    }
  }

  // First page tells us whether there is more to fetch. It is the only
  // sequential step: a library of N albums costs 1 + ceil((N-1)/size) requests
  // but they all fly at once, instead of ~1.6s each down a serial loop (which
  // left the filters blank for ~27s on a large library).
  const first = await page(0)
  add(first)
  if (first.length < size) return map

  let offset = size
  while (true) {
    const batch = Array.from({ length: BATCH }, (_, i) => offset + i * size)
    const pages = await Promise.all(batch.map(page))
    for (const albums of pages) add(albums)
    // A short page is the last one: anything past it is past the end.
    if (pages.some(albums => albums.length < size)) break
    offset += BATCH * size
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

// Single song by id — used to turn a text-only reference (a Last.fm scrobble,
// which carries no Subsonic id) back into a playable library track.
export async function getSong(id) {
  const data = await request('getSong', { id })
  return data.song || null
}

export async function getAlbumPage(size = 100, offset = 0, type = 'alphabeticalByName') {
  const data = await request('getAlbumList2', { type, size, offset })
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