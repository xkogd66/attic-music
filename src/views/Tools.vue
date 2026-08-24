<template>
  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">

    <div class="px-4 md:px-6 py-3 md:py-6 border-b border-stone-200 bg-white flex-shrink-0">
      <div class="flex items-center justify-between">
        <h1 class="font-serif text-3xl font-semibold">Library Tools</h1>
        <button
          class="text-xs border border-stone-200 rounded-full px-3 py-1.5 text-stone-600 hover:border-amber-700 hover:text-amber-700 transition-colors disabled:opacity-50"
          :disabled="scanning"
          @click="rescan"
        >
          {{ scanning ? 'Scanning…' : '↻ Rescan library' }}
        </button>
      </div>
      <p class="text-sm text-stone-500 mt-1">
        The musiclib maintenance workflows (audit · cleanup · artwork · convert · enrich) now live in the browser.
      </p>
    </div>

    <div class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">

      <!-- RUNNING JOBS (ops are async: POST starts a job, poll shows progress) -->
      <section v-if="activeJobs.length" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Running jobs</h2>
        <div v-for="job in activeJobs" :key="job.id" class="py-2 border-b border-stone-100 last:border-b-0">
          <div class="flex items-center justify-between gap-2 text-sm">
            <span class="font-medium truncate">{{ job.label }}</span>
            <span class="text-xs text-stone-500 flex-shrink-0">{{ job.status }}</span>
          </div>
          <div class="text-xs text-stone-500 truncate">{{ job.message }}</div>
          <div class="mt-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div
              v-if="job.total"
              class="h-full bg-amber-700 transition-all"
              :style="{ width: Math.min(100, Math.round(job.progress / job.total * 100)) + '%' }"
            ></div>
            <div v-else class="h-full w-1/3 bg-amber-700 animate-pulse"></div>
          </div>
        </div>
      </section>

      <!-- ALBUM PICKER -->
      <section class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Album</h2>
        <p class="text-xs text-stone-500 mb-3">
          Most operations run on a single album — pick one, or use the audit section to scan the whole library.
        </p>

        <div v-if="!selected" class="relative">
          <input
            v-model="albumQuery"
            type="search"
            placeholder="Search albums…"
            class="w-full text-sm bg-stone-100 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-amber-700"
            @input="onAlbumInput"
          />
          <div
            v-if="results && results.albums.length"
            class="absolute left-0 right-0 z-50 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
          >
            <button
              v-for="a in results.albums"
              :key="a.id"
              class="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 transition-colors"
              @click="pickAlbum(a)"
            >
              <div class="truncate">{{ a.name }}</div>
              <div class="text-xs text-stone-600 truncate">{{ a.artist }}</div>
            </button>
          </div>
          <div
            v-else-if="albumQuery && results && !results.albums.length"
            class="absolute left-0 right-0 z-50 mt-1 bg-white border border-stone-200 rounded-lg shadow px-3 py-2 text-xs text-stone-600"
          >No matching albums</div>
        </div>

        <div v-else class="flex items-center gap-3">
          <img
            v-if="selected.coverArt"
            :src="coverUrl(selected.coverArt, 60)"
            class="w-12 h-12 rounded object-cover"
            loading="lazy"
          />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ selected.name }}</div>
            <div class="text-xs text-stone-600 truncate">{{ selected.artist }}</div>
          </div>
          <button class="text-xs text-stone-500 hover:text-amber-700" @click="clearAlbum">✕ Clear</button>
        </div>
      </section>

      <!-- AUDIT -->
      <section class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Audit (read-only)</h2>
        <div class="flex gap-2 flex-wrap">
          <button class="btn" :disabled="!selected || busy" @click="doAuditAlbum">Audit this album</button>
          <button class="btn" :disabled="busy" @click="doAuditLibrary">Audit whole library</button>
        </div>
        <p class="text-xs text-stone-500 mt-2">
          Reports junk tags (outside the golden set) and cross-track conflicts on album / album artist / year.
        </p>
      </section>

      <!-- CLEANUP -->
      <section v-if="selected" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Tag cleanup</h2>
        <div class="divide-y divide-stone-100">
          <div v-for="c in CLEANUPS" :key="c.op" class="py-2.5 flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">{{ c.title }}</div>
              <div class="text-xs text-stone-500">{{ c.desc }}</div>
            </div>
            <button class="btn btn-ghost" :disabled="busy" @click="cleanupPreview(c.op)">Preview</button>
            <button class="btn btn-danger" :disabled="busy" @click="cleanupApply(c.op)">Apply</button>
          </div>
        </div>
      </section>

      <!-- ARTWORK -->
      <section v-if="selected" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Artwork</h2>
        <div class="flex gap-2 flex-wrap">
          <button class="btn" :disabled="busy" @click="doNormalize">Normalize cover.jpg</button>
          <button class="btn" :disabled="busy" @click="doReEmbed">Re-embed cover into tracks</button>
        </div>
        <p class="text-xs text-stone-500 mt-2">
          Normalize re-encodes the folder art as a real JPEG gonic can read; re-embed writes it into every mp3's APIC frame.
        </p>
      </section>

      <!-- CONVERT -->
      <section v-if="selected" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Convert</h2>
        <div class="flex items-center gap-2 flex-wrap">
          <select v-model="convTo" class="text-sm border border-stone-200 rounded px-2 py-1.5">
            <option value="mp3">FLAC / M4A / MP4 → MP3 320kbps</option>
            <option value="flac">WAV → FLAC (lossless)</option>
          </select>
          <input
            v-if="convTo === 'mp3'"
            v-model="convBitrate"
            class="text-sm border border-stone-200 rounded px-2 py-1.5 w-24"
            placeholder="320k"
          />
          <label class="text-xs text-stone-600 flex items-center gap-1.5 cursor-pointer">
            <input v-model="convDelete" type="checkbox" class="accent-amber-700" />
            delete originals
          </label>
        </div>
        <div class="mt-3 flex gap-2 flex-wrap">
          <button class="btn" :disabled="busy" @click="convertPreview">Preview</button>
          <button class="btn btn-danger" :disabled="busy" @click="convertApply">Convert album</button>
        </div>
        <p class="text-xs text-stone-500 mt-2">Needs ffmpeg in the sidecar container; runs on the NFS share.</p>
      </section>

      <!-- ENRICH -->
      <section v-if="selected" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Enrich</h2>
        <div class="space-y-2">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">Genre + year</div>
              <div class="text-xs text-stone-500">MusicBrainz, Last.fm fallback — only fills missing values</div>
            </div>
            <button class="btn btn-ghost" :disabled="busy" @click="enrichPreview">Preview</button>
            <button class="btn" :disabled="busy" @click="enrichApply">Apply</button>
          </div>
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">Lyrics</div>
              <div class="text-xs text-stone-500">LRCLIB → embeds USLT + writes a .lrc sidecar</div>
            </div>
            <button class="btn btn-ghost" :disabled="busy" @click="lyricsPreview">Preview</button>
            <button class="btn" :disabled="busy" @click="lyricsApply">Apply</button>
          </div>
        </div>
      </section>


      <!-- RESULT -->
      <section v-if="result" class="bg-white rounded-xl border border-stone-200 p-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600">Result</h2>
          <button class="text-xs text-stone-400 hover:text-stone-600" @click="result = null">✕</button>
        </div>

        <div v-if="!result.ok" class="text-sm text-red-600 whitespace-pre-wrap">{{ result.error }}</div>

        <template v-else>
          <!-- whole-library audit -->
          <template v-if="result.data.problems">
            <div class="text-sm text-stone-600 mb-2">
              Scanned <span class="font-medium">{{ result.data.scanned }}</span> albums —
              <span class="font-medium">{{ result.data.problems.length }}</span> with issues.
            </div>
            <div v-if="!result.data.problems.length" class="text-sm text-emerald-700">All clean ✓</div>
            <div v-else class="space-y-3 max-h-96 overflow-y-auto pr-1">
              <div v-for="p in result.data.problems" :key="p.folder" class="border border-stone-200 rounded-lg p-3">
                <div class="text-sm font-medium">{{ p.folder }} <span class="text-xs text-stone-500">({{ p.trackCount }} tracks)</span></div>
                <div v-if="p.missing.length" class="text-xs text-amber-700 mt-1">missing: {{ p.missing.join(', ') }}</div>
                <div v-if="p.junkTags.length" class="text-xs text-stone-600 mt-1">junk tags: {{ p.junkTags.join(', ') }}</div>
                <div v-for="(vmap, label) in p.conflicts" :key="label" class="mt-1">
                  <div class="text-xs font-medium text-red-600">conflict — {{ label }}:</div>
                  <div v-for="(files, value) in vmap" :key="value" class="text-xs text-stone-600 pl-3">
                    “{{ value }}” · {{ files.length }} track{{ files.length !== 1 ? 's' : '' }}
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- single-album audit -->
          <template v-else-if="result.data.album">
            <div class="border border-stone-200 rounded-lg p-3">
              <div class="text-sm font-medium">
                {{ result.data.album.folder }}
                <span class="text-xs text-stone-500">({{ result.data.album.trackCount }} tracks)</span>
              </div>
              <div
                v-if="!result.data.album.missing.length && !result.data.album.junkTags.length && !Object.keys(result.data.album.conflicts).length"
                class="text-sm text-emerald-700 mt-1"
              >All clean ✓</div>
              <div v-if="result.data.album.missing.length" class="text-xs text-amber-700 mt-1">
                missing: {{ result.data.album.missing.join(', ') }}
              </div>
              <div v-if="result.data.album.junkTags.length" class="text-xs text-stone-600 mt-1">
                junk tags: {{ result.data.album.junkTags.join(', ') }}
              </div>
              <div v-for="(vmap, label) in result.data.album.conflicts" :key="label" class="mt-1">
                <div class="text-xs font-medium text-red-600">conflict — {{ label }}:</div>
                <div v-for="(files, value) in vmap" :key="value" class="text-xs text-stone-600 pl-3">
                  “{{ value }}” · {{ files.length }} track{{ files.length !== 1 ? 's' : '' }}
                </div>
              </div>
            </div>
          </template>

          <!-- changes (cleanup / artwork / convert / enrich) -->
          <template v-else-if="result.data.changes !== undefined">
            <div class="flex items-center gap-2 mb-2">
              <span
                class="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full"
                :class="result.data.applied !== false ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600'"
              >{{ result.data.applied !== false ? 'applied' : 'preview' }}</span>
              <span v-if="result.data.op" class="text-xs text-stone-500">{{ result.data.op }}</span>
              <span v-if="result.data.to" class="text-xs text-stone-500">→ {{ result.data.to }}</span>
            </div>
            <div v-if="!result.data.changes.length" class="text-sm text-stone-500">Nothing to change.</div>
            <div v-else class="max-h-96 overflow-y-auto pr-1 space-y-1">
              <div v-for="(ch, i) in result.data.changes" :key="i" class="text-xs font-mono text-stone-700 border-b border-stone-100 pb-1">
                <span class="text-stone-400">{{ ch.file }}</span> — {{ ch.detail }}
              </div>
            </div>
          </template>
        </template>
      </section>

      <p class="text-[11px] text-stone-400 px-1">
        Tag changes are written straight to the mp3s on the NFS share — hit “↻ Rescan library” afterwards so gonic re-indexes them.
      </p>
    </div>
  </div>
</template>


<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useConfigStore } from '../stores/config'
import { search, coverUrl, startScan, getScanStatus } from '../api/subsonic'
import {
  getJob,
  startAudit, startCleanup, startNormalizeCover, startReEmbedCover,
  startConvert, startEnrich, startEnrichLyrics,
} from '../api/maintenance'

const config = useConfigStore()

// ── album picker ──────────────────────────────────────────────
const albumQuery = ref('')
const results    = ref(null)
const selected   = ref(null)   // a subsonic album: { id, name, artist, albumArtist, coverArt }
let debounce     = null

function onAlbumInput() {
  clearTimeout(debounce)
  const q = albumQuery.value.trim()
  if (!q) { results.value = null; return }
  debounce = setTimeout(async () => {
    try { results.value = await search(q) } catch { results.value = null }
  }, 300)
}

function pickAlbum(a) {
  selected.value = a
  albumQuery.value = ''
  results.value = null
  result.value = null
}

function clearAlbum() {
  selected.value = null
  result.value = null
}

// The on-disk identity the sidecar resolves the folder by — same convention as
// the tag-save UI: albumArtist || artist, plus the album name.
function disk() {
  const a = selected.value
  if (!a) return null
  return { artist: a.albumArtist || a.artist || '', album: a.name || '' }
}

// ── shared job plumbing ────────────────────────────────────────
// Every operation is asynchronous: POST starts a job on the sidecar and we
// poll getJob(id) until it finishes. Multiple jobs can run in parallel;
// same-album jobs are serialized server-side.
const activeJobs = ref([])   // running jobs: { id, label, status, message, progress, total, … }
const result     = ref(null) // latest finished job → { ok, data } | { ok: false, error }
let pollTimer    = null

// Computed named `busy` so the template's :disabled="busy" bindings still work.
const busy = computed(() => activeJobs.value.some(j => j.status === 'running'))

function launchJob(startFn, label) {
  startFn()
    .then(({ id }) => {
      activeJobs.value.push({ id, label, status: 'running', message: 'queued…', progress: 0, total: 0 })
      ensurePolling()
    })
    .catch(e => {
      result.value = { ok: false, error: e.message || String(e) }
    })
}

function ensurePolling() {
  if (pollTimer) return
  pollTimer = setInterval(pollJobs, 1500)
}

async function pollJobs() {
  const running = activeJobs.value.filter(j => j.status === 'running')
  if (!running.length) { stopPolling(); return }
  const states = await Promise.all(running.map(j => getJob(j.id).catch(() => null)))
  for (const job of activeJobs.value) {
    const st = states.find(s => s && s.id === job.id)
    if (st) Object.assign(job, st)   // label is preserved — server state has none
  }
  const finished = activeJobs.value.filter(j => j.status !== 'running')
  if (finished.length) {
    result.value = jobToResult(finished[finished.length - 1])
  }
  activeJobs.value = activeJobs.value.filter(j => j.status === 'running')
  if (!activeJobs.value.length) stopPolling()
}

function stopPolling() {
  clearInterval(pollTimer)
  pollTimer = null
}

// Map a finished job onto the shape the result panel renders.
function jobToResult(job) {
  if (job.status === 'error') return { ok: false, error: job.error || 'job failed' }
  if (job.data && (job.data.problems || job.data.album)) return { ok: true, data: job.data }
  return { ok: true, data: { changes: job.changes || [], applied: job.applied, op: job.op } }
}

// ── audit ────────────────────────────────────────────────────
function doAuditAlbum() {
  const a = disk(); if (!a) return
  launchJob(() => startAudit({ artist: a.artist, album: a.album }), `Audit ${a.album}`)
}
function doAuditLibrary() {
  launchJob(() => startAudit({ scope: 'all' }), 'Audit whole library')
}

// ── tag cleanup ──────────────────────────────────────────────
const CLEANUPS = [
  { op: 'sort-tags',     title: 'Delete sort tags',        desc: 'Removes TSOP, TSO2, TSOA, TSOT, TSOS, TSOC, TSOO, XSOP' },
  { op: 'golden-set',    title: 'Sanitize to golden set',  desc: 'Wipes every non-golden frame, then aligns grouping tags (album, album artist, year, disc, compilation) to the first track' },
  { op: 'lowercase',     title: 'Lowercase all text tags', desc: 'Lowercases every text frame value — nuclear, only for a fresh-ripped library' },
  { op: 'from-filename', title: 'Tag from filename',       desc: 'Parses "Artist - Title" / "NN - Title" into TIT2/TPE1' },
]

function cleanupPreview(op) {
  const a = disk(); if (!a) return
  launchJob(() => startCleanup(a.artist, a.album, op), `Preview ${op}`)
}
function cleanupApply(op) {
  if (!window.confirm(`Apply “${op}”? This rewrites ID3 tags on the NFS share.`)) return
  const a = disk(); if (!a) return
  launchJob(() => startCleanup(a.artist, a.album, op, { apply: true }), `Apply ${op}`)
}

// ── artwork ──────────────────────────────────────────────────
function doNormalize() {
  const a = disk(); if (!a) return
  launchJob(() => startNormalizeCover(a.artist, a.album), 'Normalize cover')
}
function doReEmbed() {
  if (!window.confirm('Re-embed the folder cover into every track? This rewrites all mp3 files in the album.')) return
  const a = disk(); if (!a) return
  launchJob(() => startReEmbedCover(a.artist, a.album), 'Re-embed cover')
}

// ── convert ──────────────────────────────────────────────────
const convTo      = ref('mp3')
const convBitrate = ref('320k')
const convDelete  = ref(true)

function convertPreview() {
  const a = disk(); if (!a) return
  launchJob(() => startConvert(a.artist, a.album, { to: convTo.value, bitrate: convBitrate.value, deleteOriginal: convDelete.value }), 'Preview conversion')
}
function convertApply() {
  const del = convDelete.value ? ' Original files will be DELETED after a successful conversion.' : ''
  if (!window.confirm(`Convert this album to ${convTo.value.toUpperCase()}?${del}`)) return
  const a = disk(); if (!a) return
  launchJob(() => startConvert(a.artist, a.album, { to: convTo.value, bitrate: convBitrate.value, deleteOriginal: convDelete.value, apply: true }), `Convert to ${convTo.value.toUpperCase()}`)
}

// ── enrich ───────────────────────────────────────────────────
function enrichPreview() {
  const a = disk(); if (!a) return
  launchJob(() => startEnrich(a.artist, a.album, { fields: 'genre,year', lastfmKey: config.lastfmKey }), 'Preview enrich')
}
function enrichApply() {
  if (!window.confirm('Fill missing genre + year (MusicBrainz, Last.fm fallback)?')) return
  const a = disk(); if (!a) return
  launchJob(() => startEnrich(a.artist, a.album, { fields: 'genre,year', lastfmKey: config.lastfmKey, apply: true }), 'Enrich genre + year')
}
function lyricsPreview() {
  const a = disk(); if (!a) return
  launchJob(() => startEnrichLyrics(a.artist, a.album), 'Preview lyrics')
}
function lyricsApply() {
  if (!window.confirm('Embed lyrics from LRCLIB into every track (USLT + .lrc sidecar)?')) return
  const a = disk(); if (!a) return
  launchJob(() => startEnrichLyrics(a.artist, a.album, { apply: true }), 'Embed lyrics')
}

// ── library rescan (same poll pattern as the sidebar) ────────
const scanning = ref(false)
let scanPoll   = null

async function rescan() {
  if (scanning.value) return
  scanning.value = true
  try {
    await startScan()
    scanPoll = setInterval(async () => {
      try {
        const data = await getScanStatus()
        if (!data.scanStatus?.scanning) {
          clearInterval(scanPoll)
          scanPoll = null
          scanning.value = false
        }
      } catch (_) {
        clearInterval(scanPoll)
        scanPoll = null
        scanning.value = false
      }
    }, 30000)
  } catch (_) {
    scanning.value = false
  }
}

onUnmounted(() => { stopPolling(); if (scanPoll) clearInterval(scanPoll) })
</script>


<style scoped>
@reference "../style.css";

.btn {
  @apply text-xs font-medium px-3 py-1.5 rounded-full border border-stone-200 text-stone-700 bg-white hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-40 disabled:pointer-events-none;
}
.btn-ghost {
  @apply border-transparent text-stone-500 hover:bg-amber-50;
}
.btn-danger {
  @apply border-red-200 text-red-600 hover:border-red-500 hover:bg-red-50 hover:text-red-700;
}
</style>

