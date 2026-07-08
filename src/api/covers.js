import { useConfigStore } from '../stores/config'

// Last.fm's "no image" placeholder — the same grey star is returned for every
// album it has no art for, so we drop any URL containing this hash.
const LASTFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f'

const LASTFM_SIZE_RANK = { small: 1, medium: 2, large: 3, extralarge: 4, mega: 5, '': 0 }

function ensureArray(val) {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

// Pick the largest usable URL from a Last.fm image[] array.
function bestLastfmImage(images) {
  let best = null, rank = -1
  for (const img of ensureArray(images)) {
    const url = img['#text']
    if (!url || url.includes(LASTFM_PLACEHOLDER)) continue
    const r = LASTFM_SIZE_RANK[img.size] ?? 0
    if (r > rank) { rank = r; best = url }
  }
  return best
}

// Last.fm: the exact album (album.getInfo) plus broader name matches
// (album.search), each contributing its largest cover.
async function lastfmCovers(artist, album) {
  const config = useConfigStore()
  if (!config.lastfmKey) return []

  const out = []
  const seen = new Set()
  const push = url => { if (url && !seen.has(url)) { seen.add(url); out.push({ url, source: 'Last.fm' }) } }
  const base = `https://ws.audioscrobbler.com/2.0/?api_key=${encodeURIComponent(config.lastfmKey)}&format=json`

  try {
    const res  = await fetch(`${base}&method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`)
    const json = await res.json()
    push(bestLastfmImage(json?.album?.image))
  } catch (_) {}

  try {
    const res  = await fetch(`${base}&method=album.search&album=${encodeURIComponent(album)}&limit=10`)
    const json = await res.json()
    for (const m of ensureArray(json?.results?.albummatches?.album)) push(bestLastfmImage(m.image))
  } catch (_) {}

  return out
}

// Deezer (backup): album search via the existing proxy, largest cover per hit.
async function deezerCovers(artist, album) {
  try {
    const res  = await fetch(`/deezer-api/search/album?q=${encodeURIComponent(`${artist} ${album}`)}&limit=10`)
    const json = await res.json()
    const out = []
    const seen = new Set()
    for (const a of ensureArray(json?.data)) {
      const url = a.cover_xl || a.cover_big || a.cover_medium || a.cover
      if (url && !seen.has(url)) { seen.add(url); out.push({ url, source: 'Deezer' }) }
    }
    return out
  } catch (_) {
    return []
  }
}

// Aggregate cover candidates for an album — Last.fm first, Deezer as backup.
// Returns [{ url, source }]. Both CDNs send Access-Control-Allow-Origin: *, so
// the caller can fetch the chosen URL's bytes to re-upload as cover.jpg.
export async function searchAlbumCovers(artist, album) {
  const [lf, dz] = await Promise.all([
    lastfmCovers(artist, album),
    deezerCovers(artist, album),
  ])
  return [...lf, ...dz]
}
