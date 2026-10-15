export async function fetchProviders() {
  const res = await fetch('/chat-api/providers')
  if (!res.ok) return []
  return res.json()
}

export async function askAI(message, provider) {
  const res = await fetch('/chat-api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, provider }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `chat request failed (${res.status})`)
  return res.json()
}

// ── Discogs album ratings (stored server-side in chat-server) ───
// Mirrors ratingKey in chat-server/index.js — keep the two identical.
export const ratingKey = (artist, album) =>
  [artist, album]
    .map(s => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .join('|')

// Every stored rating, keyed by ratingKey(). Empty on any failure — ratings
// are decoration, never a reason to break the album view.
export async function fetchRatings() {
  try {
    const res = await fetch('/chat-api/ratings')
    return res.ok ? await res.json() : {}
  } catch { return {} }
}

// Fetches from Discogs only if the album isn't stored yet (or force is set).
export async function fetchRating(artist, album, force = false) {
  const qs = new URLSearchParams({ artist, album, ...(force ? { force: '1' } : {}) })
  const res = await fetch(`/chat-api/ratings?${qs}`, { method: 'POST' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `rating request failed (${res.status})`)
  return body
}
