// Library maintenance — the musiclib CLI (scripts/musiclib.py) folded into the
// web app. All calls go to the artist-images sidecar, the only component that
// can read/write the NFS share (ID3 tags, cover art, conversions).
//
// artist/album are the album's ON-DISK identity — the same (albumArtist ||
// artist, name) pair the tag-save calls in tags.js use. The sidecar resolves
// them through its own normalize() index, so case/underscores don't matter.
//
// EVERY operation is asynchronous: starting one POSTs a job and returns
// { id } (HTTP 202); poll getJob(id) until status is 'done' | 'error'.
// Jobs touching the same album are serialized server-side; different albums
// run in parallel. Job state shape:
//   { id, op, applied, status, message, progress, total, error, changes, data }

async function start(url, params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const res = await fetch(`/artist-images${url}?${qs}`, { method: 'POST', cache: 'no-store' })
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
  return res.json() // { id }
}

export function getJob(id) {
  return fetch(`/artist-images/job?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`job ${id}: HTTP ${res.status}`))))
}

export function getRecentJobs() {
  return fetch('/artist-images/jobs', { cache: 'no-store' })
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`jobs: HTTP ${res.status}`))))
}

// ── Audit (read-only) ───────────────────────────────────────────
// scope: 'all' → whole-library report { scanned, problems }
// artist+album → single-album report { album: { folder, trackCount, conflicts, junkTags, missing } }
export function startAudit({ scope, artist, album } = {}) {
  return start('/audit', { scope, artist, album })
}

// ── Tag cleanup ─────────────────────────────────────────────────
// op: 'sort-tags' | 'golden-set' | 'lowercase' | 'from-filename'
// apply=false → preview (job.data.changes is the plan); apply=true → commit.
export function startCleanup(artist, album, op, { apply = false } = {}) {
  return start('/cleanup', { artist, album, op, apply: apply ? '1' : '' })
}

// ── Artwork ─────────────────────────────────────────────────────
export function startNormalizeCover(artist, album) {
  return start('/normalize-cover', { artist, album })
}
export function startReEmbedCover(artist, album) {
  return start('/re-embed-cover', { artist, album })
}

// ── Convert (needs ffmpeg in the sidecar image) ─────────────────
// to: 'mp3' (from flac/m4a/mp4) | 'flac' (from wav). Reports per-file progress.
export function startConvert(artist, album, { to = 'mp3', bitrate = '320k', deleteOriginal = false, apply = false } = {}) {
  return start('/convert', {
    artist, album, to, bitrate,
    deleteOriginal: deleteOriginal ? '1' : '',
    apply: apply ? '1' : '',
  })
}

// ── Enrich ──────────────────────────────────────────────────────
// fields: comma list, e.g. 'genre,year'. lastfmKey is passed through so the
// sidecar can use Last.fm as a genre fallback without storing the key itself.
export function startEnrich(artist, album, { fields = 'genre,year', lastfmKey = '', apply = false } = {}) {
  return start('/enrich', { artist, album, fields, lastfmKey, apply: apply ? '1' : '' })
}
// LRCLIB → USLT (+ .lrc sidecar) per track. Reports per-track progress.
export function startEnrichLyrics(artist, album, { apply = false } = {}) {
  return start('/enrich-lyrics', { artist, album, apply: apply ? '1' : '' })
}
