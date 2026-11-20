import { startScan } from './subsonic'

// A hung upstream must not hold the picker open forever.
const FETCH_TIMEOUT_MS = 8000

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'

async function wikipediaGet(params) {
  const url = `${WIKIPEDIA_API}?${new URLSearchParams({ ...params, format: 'json', origin: '*' })}`
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
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
async function wikipediaArtistImages(name, onResult) {
  const out = []
  const seen = new Set()
  const push = url => {
    if (!url || seen.has(url)) return
    seen.add(url)
    const c = { url, source: 'Wikipedia' }
    out.push(c)
    onResult?.([c])
  }

  try {
    const title = await wikipediaPageTitle(name)
    if (!title) return out

    // Lead photo and the embedded-image list are independent — fetch together,
    // so the lead shows up as soon as it's ready.
    const leadP = wikipediaGet({ action: 'query', titles: title, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: 800 })
      .then(lead => push(firstPage(lead)?.thumbnail?.source))
    const embeddedP = (async () => {
      const imagesRes = await wikipediaGet({ action: 'query', titles: title, prop: 'images', imlimit: 30 })
      const files = (firstPage(imagesRes)?.images || [])
        .map(i => i.title)
        .filter(t => !NOISE_FILENAME.test(t))
        .slice(0, 15)
      if (!files.length) return
      const info = await wikipediaGet({ action: 'query', titles: files.join('|'), prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: 1000 })
      for (const p of Object.values(info?.query?.pages || {})) {
        const ii = p.imageinfo?.[0]
        // thumburl: a 1000px render, not the (often multi-MB) original
        if (ii?.width >= 200) push(ii.thumburl || ii.url)
      }
    })()
    await Promise.allSettled([leadP, embeddedP])
  } catch (_) {}
  return out
}

// Aggregate image candidates for an artist — [{ url, source }].
export async function searchArtistImages(name, onResult) {
  return wikipediaArtistImages(name, onResult)
}

// Albums whose cover was replaced this session, id → cache-buster. Reopening
// an album otherwise rebuilds its cover from gonic's getCoverArt URL, which
// still serves the old image (cached by the browser and by gonic until rescan).
const replacedCovers = new Map()

// The sidecar embeds the cover into the mp3s in the background after its 202
// (~2s for a typical album), and gonic only sees embedded art on a scan.
// ponytail: fixed delay, not a handshake — a huge album could still be
// mid-embed; the manual rescan in the sidebar covers that.
const EMBED_SETTLE_MS = 6000

export function sidecarAlbumCover(artist, album, id, dir) {
  const t = Date.now()
  if (id) replacedCovers.set(id, t)
  setTimeout(() => startScan().catch(() => {}), EMBED_SETTLE_MS)
  return `/artist-images/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&dir=${encodeURIComponent(dir)}&t=${t}`
}

// The detail-page cover: the freshly uploaded one if there is one, else gonic's.
export function detailCoverSrc(album, gonicUrl, dir) {
  const t = replacedCovers.get(album.id)
  if (!t) return gonicUrl
  const artist = album.albumArtist || album.artist
  return `/artist-images/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album.name)}&dir=${encodeURIComponent(dir)}&t=${t}`
}
