import { startScan, getAlbum } from './subsonic'

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

// Album cover candidates: MusicBrainz release search → Cover Art Archive front
// image per release. No key; both (and archive.org behind CAA's redirect) send
// Access-Control-Allow-Origin: *, so the picker can fetch and re-upload the bytes.
// Releases without art 404 — the modal already hides candidates that fail to load.
export async function searchAlbumCovers(artist, album, onResult) {
  const q = s => `"${s.replace(/["\\]/g, '')}"`
  const url = `https://musicbrainz.org/ws/2/release/?fmt=json&limit=15&query=${encodeURIComponent(`release:${q(album)} AND artist:${q(artist)}`)}`
  try {
    // MusicBrainz answers 503 "server is currently busy" on a fair share of
    // requests (rate limit, ~1 req/s per IP), so retry a few times.
    let res
    for (let i = 0; i < 3; i++) {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (res.status !== 503) break
      await new Promise(r => setTimeout(r, 1500))
    }
    const json = await res.json()
    const out  = (json.releases || [])
      .filter(r => r.score >= 80)
      .map(r => ({ url: `https://coverartarchive.org/release/${r.id}/front-1200`, source: 'Cover Art Archive' }))
    onResult?.(out)
    return out
  } catch (_) {
    return []
  }
}

// Aggregate image candidates for an artist — [{ url, source }].
export async function searchArtistImages(name, onResult) {
  return wikipediaArtistImages(name, onResult)
}

// Album covers come from the album folder's cover.jpg via the sidecar, not from
// gonic: gonic only notices new art on a scan and caches stale thumbnails. The
// sidecar stats the file per request and sends no-cache, so a replaced cover
// shows at once. `dir` (folder path) makes the lookup exact; without it the
// sidecar matches artist|album against its index of tag names and folder names.
export function albumCover(album, dir) {
  const artist = album.albumArtist || album.artist
  const q = new URLSearchParams({ artist, album: album.name })
  if (dir) q.set('dir', dir)
  return `/artist-images/album?${q}`
}

// <img @error> for album tiles: the name lookup missed, so get the album's real
// folder from its first track's path (what the album page does) and retry the
// same cover.jpg with an exact dir. Second miss = no cover.jpg → placeholder.
export async function onAlbumCoverError(e, album) {
  const img = e.target
  if (img.dataset.dir) { img.style.display = 'none'; return }
  img.dataset.dir = '1'
  try {
    const { tracks } = await getAlbum(album.id)
    const dir = tracks[0]?.path?.split('/').slice(0, -1).join('/')
    if (!dir) throw new Error('no path')
    img.src = albumCover(album, dir)
  } catch (_) {
    img.style.display = 'none'
  }
}

// The playing track's album cover — same cover.jpg, folder taken from its path.
export function trackCover(track) {
  const dir = track.path ? track.path.split('/').slice(0, -1).join('/') : ''
  return albumCover({ albumArtist: track.albumArtist, artist: track.artist, name: track.album }, dir)
}

// The sidecar embeds the cover into the mp3s in the background after its 202
// (~2s for a typical album), and gonic only sees embedded art on a scan.
// ponytail: fixed delay, not a handshake — a huge album could still be
// mid-embed; the manual rescan in the sidebar covers that.
const EMBED_SETTLE_MS = 6000

// After an upload: same URL plus a cache-buster so the open page swaps the
// image, and a gonic scan so players (which use gonic's embedded art) catch up.
export function sidecarAlbumCover(artist, album, id, dir) {
  setTimeout(() => startScan().catch(() => {}), EMBED_SETTLE_MS)
  return `/artist-images/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&dir=${encodeURIComponent(dir)}&t=${Date.now()}`
}
