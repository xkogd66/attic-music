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

// Aggregate cover candidates for an album — Last.fm only.
// Returns [{ url, source }]. The CDN sends Access-Control-Allow-Origin: *, so
// the caller can fetch the chosen URL's bytes to re-upload as cover.jpg.
export async function searchAlbumCovers(artist, album) {
  return lastfmCovers(artist, album)
}

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'

async function wikipediaGet(params) {
  const url = `${WIKIPEDIA_API}?${new URLSearchParams({ ...params, format: 'json', origin: '*' })}`
  const res = await fetch(url)
  return res.json()
}

function firstPage(json) {
  return Object.values(json?.query?.pages || {})[0]
}

// File names that are (almost) never a usable portrait: logos, signatures,
// flags, category icons — Wikipedia articles embed plenty of these.
const NOISE_FILENAME = /logo|icon|signature|flag|symbol|\.svg$/i

// Resolve the artist name to a Wikipedia article title: the exact title if it
// exists and isn't a disambiguation page, otherwise the top full-text search hit.
async function wikipediaPageTitle(name) {
  const direct = await wikipediaGet({ action: 'query', titles: name, prop: 'pageprops' })
  const page = firstPage(direct)
  if (page && !page.missing && !page.pageprops?.disambiguation) return page.title

  const search = await wikipediaGet({ action: 'query', list: 'search', srsearch: name, srnamespace: 0, srlimit: 1 })
  return search?.query?.search?.[0]?.title || null
}

// Wikipedia article images for an artist: the infobox lead photo plus every
// other embedded photo, largest size available. No aspect-ratio filtering —
// the avatar UI already center-crops to a circle regardless of source shape.
async function wikipediaArtistImages(name) {
  const out = []
  const seen = new Set()
  const push = url => { if (url && !seen.has(url)) { seen.add(url); out.push({ url, source: 'Wikipedia' }) } }

  const title = await wikipediaPageTitle(name)
  if (!title) return out

  const lead = await wikipediaGet({ action: 'query', titles: title, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: 800 })
  push(firstPage(lead)?.thumbnail?.source)

  const imagesRes = await wikipediaGet({ action: 'query', titles: title, prop: 'images', imlimit: 30 })
  const files = (firstPage(imagesRes)?.images || [])
    .map(i => i.title)
    .filter(t => !NOISE_FILENAME.test(t))
    .slice(0, 15)

  if (files.length) {
    const info = await wikipediaGet({ action: 'query', titles: files.join('|'), prop: 'imageinfo', iiprop: 'url|size' })
    for (const p of Object.values(info?.query?.pages || {})) {
      const ii = p.imageinfo?.[0]
      if (ii?.width >= 200) push(ii.url)
    }
  }

  return out
}

// Aggregate image candidates for an artist — same shape as searchAlbumCovers.
export async function searchArtistImages(name) {
  return wikipediaArtistImages(name)
}
