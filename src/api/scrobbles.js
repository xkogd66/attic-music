import { search, authHeaders } from './subsonic'

// The app's own scrobbler — chat-server stores plays in ClickHouse
// (music.scrobbles). Replaces Last.fm.

function timeAgo(uts) {
  if (!uts) return ''
  const diff = Math.floor(Date.now() / 1000 - uts)
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export async function scrobble(track) {
  const res = await fetch('/chat-api/scrobbles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ artist: track.artist, album: track.album || '', track: track.title }),
  })
  if (!res.ok) throw new Error(`scrobble failed (${res.status})`)
}

export async function getRecentScrobbles(limit = 5) {
  const res = await fetch(`/chat-api/scrobbles?limit=${limit}`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) throw new Error(`recent scrobbles failed (${res.status})`)
  return (await res.json()).map(s => ({
    track:  s.track,
    artist: s.artist,
    album:  s.album,
    when:   timeAgo(s.uts),
  }))
}

// Play counts: by = 'artist' | 'album' | 'track' | 'year'; optional year, artist, limit.
// Rows: { artist, album?, track?, year?, plays }.
export async function getScrobbleStats({ by = 'artist', year, artist, limit } = {}) {
  const qs = new URLSearchParams({ by })
  if (year)   qs.set('year', year)
  if (artist) qs.set('artist', artist)
  if (limit)  qs.set('limit', limit)
  const res = await fetch(`/chat-api/scrobbles/stats?${qs}`, { cache: 'no-store', headers: authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `stats failed (${res.status})`)
  return res.json()
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
        // search3 matches loosely: a short name ("cola") has many partial hits, so
        // the default 8 can miss the exact one.
        const { albums } = await search(album, 200)
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
