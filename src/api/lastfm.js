import { useConfigStore } from '../stores/config'
import { search } from './subsonic'

function timeAgo(uts) {
  if (!uts) return ''
  const diff = Math.floor(Date.now() / 1000 - parseInt(uts))
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function ensureArray(val) {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

export async function getRecentTracks(limit = 5) {
  const config = useConfigStore()
  if (!config.lastfmUser || !config.lastfmKey) return []

  const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks`
    + `&user=${encodeURIComponent(config.lastfmUser)}`
    + `&api_key=${encodeURIComponent(config.lastfmKey)}`
    + `&limit=${limit}&format=json`

  const res  = await fetch(url)
  const json = await res.json()

  if (json.error) {
    console.error('Last.fm API Error:', json.message)
    const permanent = json.error === 26 || json.error === 10 || res.status === 403
    throw Object.assign(new Error(json.message), { permanent })
  }

  const tracks = ensureArray(json?.recenttracks?.track)
  return tracks.slice(0, limit).map(t => ({
    track:      t.name,
    artist:     t.artist?.['#text'] || t.artist,
    album:      t.album?.['#text']  || '',
    nowplaying: t['@attr']?.nowplaying === 'true',
    when:       t.date ? timeAgo(t.date.uts) : '',
  }))
}

// ── LIBRARY MATCHING ──────────────────────────────────
// A scrobble is just text (artist/track/album) — it carries no Subsonic id.
// search3 matches loosely, so prefer an album whose name AND artist match;
// fall back to a name-only match (a compilation's album artist differs from
// the scrobbled track artist). Never a merely loose first hit.

const norm = s => (s || '').trim().toLowerCase()

// `${artist}\n${album}` -> Promise<album | null>. Kept for the session so
// repeat clicks don't re-search.
const resolved = new Map()

export function findLibraryAlbum({ artist, album }) {
  const key = `${norm(artist)}\n${norm(album)}`
  if (!resolved.has(key)) {
    resolved.set(key, (async () => {
      try {
        const { albums } = await search(album)
        const named = albums.filter(a => norm(a.name) === norm(album))
        return named.find(a => norm(a.artist) === norm(artist)) || named[0] || null
      } catch (e) {
        // Don't cache failures — the next click (or poll) should retry.
        resolved.delete(key)
        throw e
      }
    })())
  }
  return resolved.get(key)
}
