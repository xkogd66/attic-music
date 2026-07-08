const cache = new Map()
const MANUAL_PREFIX = 'attic_lyrics_'

export function saveManualLyrics(trackId, text) {
  const trimmed = text.trim()
  if (trimmed) localStorage.setItem(MANUAL_PREFIX + trackId, trimmed)
  else         localStorage.removeItem(MANUAL_PREFIX + trackId)
  cache.delete(trackId)
}

function loadManualLyrics(trackId) {
  try {
    const raw = localStorage.getItem(MANUAL_PREFIX + trackId)
    return raw ? { plain: raw, synced: null } : null
  } catch { return null }
}

export async function fetchLyrics(track) {
  const key = track.id
  const manual = loadManualLyrics(key)
  if (manual) return manual
  if (cache.has(key)) return cache.get(key)

  const params = new URLSearchParams({
    artist_name: track.artist || '',
    track_name:  track.title  || '',
    album_name:  track.album  || '',
    duration:    String(Math.round(track.duration || 0)),
  })
  let result = null
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`)
    if (res.ok) {
      const data = await res.json()
      result = {
        plain:  data.plainLyrics  || null,
        synced: parseLrc(data.syncedLyrics || ''),
      }
    }
  } catch (_) {}
  cache.set(key, result)
  return result
}

function parseLrc(lrc) {
  if (!lrc) return null
  const lines = lrc.split('\n')
    .map(line => {
      const m = line.match(/^\[(\d+):(\d+\.\d+)\](.*)/)
      if (!m) return null
      return { time: parseInt(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() }
    })
    .filter(l => l && l.text)
  return lines.length ? lines : null
}
